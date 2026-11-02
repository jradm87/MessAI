import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, Bot, FileText, Layers, MessageSquare, Search, SquareTerminal, Zap, FolderOpen } from "lucide-react";
import type { AttentionItem, FindHit, Workspace } from "@messai/contracts";
import type { Api } from "./api.js";
import { groupItems, rankItems, type PaletteItem } from "./palette.js";
import { relTime } from "./hud-model.js";

/**
 * #69 — paleta global (Ctrl+K): busca por cima de tudo. Pula para espaços, andares e nós; lista quem espera você
 * (atenção em todos os espaços); busca conteúdo de notas/chats (FTS5, #41); ações rápidas.
 */
export type PaletteAction = { id: string; label: string; detail?: string; keywords?: string };
type Props = {
  api: Api; workspaces: Workspace[]; currentId: string | null; currentNodes: { nodeId: string; kind: string; title: string }[];
  actions: PaletteAction[]; onClose: () => void;
  onPick: (it: PaletteItem) => void;
};
const ICON: Record<PaletteItem["kind"], typeof Search> = { attention: Bell, action: Zap, node: SquareTerminal, workspace: FolderOpen, floor: Layers, content: FileText };

export function Palette({ api, workspaces, currentId, currentNodes, actions, onClose, onPick }: Props) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [attention, setAttention] = useState<AttentionItem[]>([]);
  const [hits, setHits] = useState<FindHit[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const wsName = (id: string) => workspaces.find((w) => w.workspaceId === id)?.name ?? "";
  useEffect(() => { api.attentionList().then(setAttention).catch(() => setAttention([])); }, [api]);
  // Conteúdo e nós de outros espaços: busca no runtime com debounce (a partir de 2 caracteres).
  useEffect(() => {
    const term = q.trim(); if (term.length < 2) { setHits([]); return; }
    const t = setTimeout(() => { api.find(term).then(setHits).catch(() => setHits([])); }, 120);
    return () => clearTimeout(t);
  }, [q, api]);
  const items = useMemo<PaletteItem[]>(() => {
    const out: PaletteItem[] = [];
    for (const a of attention) out.push({ id: `att:${a.kind}:${a.nodeId}`, kind: "attention", nodeId: a.nodeId, workspaceId: a.workspaceId, boost: 30, label: a.title, keywords: `${a.workspaceName} ${a.kind}`,
      detail: a.kind === "finished" ? `concluiu${a.at ? ` ${relTime(a.at, Date.now())}` : ""} · ${a.workspaceName}` : a.kind === "unread" ? `${a.count ?? 1} mensagem(ns) não lida(s) · ${a.workspaceName}` : `${a.kind === "exited" ? "processo encerrado" : "sessão perdida"} · ${a.workspaceName}` });
    for (const ac of actions) out.push({ id: `act:${ac.id}`, kind: "action", action: ac.id, label: ac.label, boost: 10, ...(ac.detail ? { detail: ac.detail } : {}), ...(ac.keywords ? { keywords: ac.keywords } : {}) });
    for (const n of currentNodes) out.push({ id: `node:${n.nodeId}`, kind: "node", nodeId: n.nodeId, ...(currentId ? { workspaceId: currentId } : {}), label: n.title, detail: `${n.kind} · neste espaço`, boost: 5 });
    for (const w of workspaces) {
      if (w.parentId) { const g = workspaces.find((x) => x.workspaceId === w.parentId); out.push({ id: `floor:${w.workspaceId}`, kind: "floor", workspaceId: w.workspaceId, label: w.name, detail: `andar de ${g?.name ?? "?"}${w.branch ? ` · ${w.branch}` : ""}`, keywords: g?.name ?? "" }); }
      else out.push({ id: `ws:${w.workspaceId}`, kind: "workspace", workspaceId: w.workspaceId, label: w.name, detail: w.cwd, ...(w.workspaceId === currentId ? { boost: 2 } : {}) });
    }
    const seen = new Set(out.map((x) => x.nodeId).filter(Boolean));
    for (const h of hits) {
      if (h.kind === "node") { if (seen.has(h.nodeId)) continue; out.push({ id: `fnode:${h.nodeId}`, kind: "node", nodeId: h.nodeId, workspaceId: h.workspaceId, label: h.title, detail: h.snippet }); }
      else out.push({ id: `c:${h.refId}`, kind: "content", nodeId: h.nodeId, workspaceId: h.workspaceId, label: h.kind === "chat" ? `chat · ${h.nodeTitle}` : h.nodeTitle, detail: h.snippet.replace(/[[\]]/g, ""), keywords: h.snippet, boost: 1 });
    }
    return out;
  }, [attention, actions, currentNodes, workspaces, currentId, hits]);
  const ranked = useMemo(() => rankItems(items, q, 40), [items, q]);
  const groups = useMemo(() => groupItems(ranked), [ranked]);
  useEffect(() => setSel(0), [q, ranked.length]);
  const pick = (it: PaletteItem) => { onPick(it); onClose(); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((i) => Math.min(ranked.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); const it = ranked[sel]; if (it) pick(it); }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
  };
  useEffect(() => { input.current?.focus(); }, []);
  let idx = -1;
  return (
    <div className="modal-backdrop palette-backdrop" onMouseDown={onClose}>
      <div className="palette" data-testid="palette" onMouseDown={(e) => e.stopPropagation()}>
        <label className="palette-input"><Search size={16} /><input ref={input} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="Ir para espaço, andar ou nó · buscar em notas e chats · ações" data-testid="palette-input" /><kbd>Esc</kbd></label>
        <div className="palette-list" data-testid="palette-list">
          {groups.map((g) => (
            <div key={g.kind} className="palette-group">
              <div className="palette-title">{g.title}</div>
              {g.items.map((it) => { idx++; const i = idx; const I = it.kind === "content" && it.label.startsWith("chat ·") ? MessageSquare : it.kind === "node" && it.detail?.startsWith("terminal") ? Bot : ICON[it.kind];
                return <div key={it.id} className={`palette-item ${i === sel ? "on" : ""}`} data-testid={`palette-item-${it.kind}`} onMouseEnter={() => setSel(i)} onClick={() => pick(it)}><I size={14} /><span className="pl"><span className="pt">{it.label}</span>{it.detail && <small>{it.detail}</small>}</span>{i === sel && <kbd>↵</kbd>}</div>; })}
            </div>
          ))}
          {ranked.length === 0 && <div className="mut palette-empty">{q.trim() ? "Nada encontrado." : "Nenhum item."}</div>}
        </div>
        <div className="palette-foot mut">↑↓ navega · ↵ abre · {attention.length ? `${attention.length} esperando você` : "ninguém esperando você"}</div>
      </div>
    </div>
  );
}
