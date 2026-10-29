import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";
import { ArrowLeft, ArrowRight, ArrowUp, Folder, FolderOpen, FileText, File as FileIcon, FileCode2, Image as ImageIcon, LayoutList, LayoutGrid, RefreshCw, FolderPlus, FilePlus, Search, Home } from "lucide-react";
import type { TreeEntry, SearchHit } from "@messai/contracts";
import type { Api } from "./api.js";
import type { NodeExtras } from "./TerminalNode.js";
import { EditableTitle } from "./EditableTitle.js";
import { askText } from "./ask.js";

export type TreeState = { root: string; mode: "list" | "grid" };
export type TreeData = {
  title: string; content: string; workspaceId: string; api: Api;
  onChange: (content: string) => void; onDelete: () => void; onRename: (t: string) => void;
  onOpenNote: (relPath: string) => void; onPreview: (relPath: string) => void; toast: (m: string) => void; editSignal?: number;
} & NodeExtras;

const parse = (c: string): TreeState => { try { const j = JSON.parse(c) as Partial<TreeState>; return { root: j.root ?? "", mode: j.mode === "grid" ? "grid" : "list" }; } catch { return { root: "", mode: "list" }; } };
const iconFor = (e: TreeEntry, open: boolean) => e.dir ? (open ? <FolderOpen size={14} /> : <Folder size={14} />) : /\.(md|markdown|txt)$/i.test(e.name) ? <FileText size={14} /> : /\.(png|jpe?g|gif|svg|webp)$/i.test(e.name) ? <ImageIcon size={14} /> : /\.(ts|tsx|js|jsx|py|go|rs|sh|json|yml|yaml|toml|css|html)$/i.test(e.name) ? <FileCode2 size={14} /> : <FileIcon size={14} />;
const GIT_TITLE: Record<string, string> = { M: "modificado", A: "adicionado", D: "apagado", R: "renomeado", "??": "não rastreado", "•": "contém alterações" };

/** Nó Árvore de Arquivos: voltar/avançar/subir, nome da pasta, Lista/Grade, pastas recolhíveis com carga sob demanda, busca (`>` por conteúdo), criar/renomear/excluir, arrastar caminho. */
export function TreeNode({ id, data, selected }: NodeProps & { data: TreeData }) {
  const { api, workspaceId } = data;
  const [state, setState] = useState<TreeState>(() => parse(data.content));
  useEffect(() => setState(parse(data.content)), [data.content]);
  const commit = (next: TreeState) => { setState(next); data.onChange(JSON.stringify(next)); };
  const hist = useRef<{ back: string[]; fwd: string[] }>({ back: [], fwd: [] });
  const [dirs, setDirs] = useState<Record<string, TreeEntry[]>>({});
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [q, setQ] = useState(""); const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; e?: TreeEntry } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async (rel: string) => { try { const es = await api.tree(workspaceId, rel); setDirs((d) => ({ ...d, [rel]: es })); setErr(null); } catch (e) { setErr(String(e)); } }, [api, workspaceId]);
  useEffect(() => { void load(state.root); }, [state.root, load]);
  useEffect(() => { if (!q.trim()) { setHits(null); return; } const t = setTimeout(() => { const content = q.startsWith(">"); void api.search(workspaceId, content ? q.slice(1).trim() : q.trim(), content).then(setHits).catch(() => setHits([])); }, 180); return () => clearTimeout(t); }, [q, api, workspaceId]);
  const go = (rel: string, push = true) => { if (push) { hist.current.back.push(state.root); hist.current.fwd = []; } setOpen(new Set()); commit({ ...state, root: rel }); };
  const back = () => { const p = hist.current.back.pop(); if (p !== undefined) { hist.current.fwd.push(state.root); go(p, false); } };
  const fwd = () => { const p = hist.current.fwd.pop(); if (p !== undefined) { hist.current.back.push(state.root); go(p, false); } };
  const up = () => { if (state.root) go(state.root.includes("/") ? state.root.slice(0, state.root.lastIndexOf("/")) : ""); };
  const toggle = (e: TreeEntry) => { const n = new Set(open); if (n.has(e.path)) n.delete(e.path); else { n.add(e.path); if (!dirs[e.path]) void load(e.path); } setOpen(n); };
  const activate = (e: TreeEntry) => { if (e.dir) { state.mode === "grid" ? go(e.path) : toggle(e); return; } if (/\.(md|markdown|txt)$/i.test(e.name)) data.onOpenNote(e.path); else data.onPreview(e.path); };
  const refresh = () => { setDirs({}); void load(state.root); for (const d of open) void load(d); };
  const op = async (body: Parameters<Api["fsOp"]>[1]) => { try { await api.fsOp(workspaceId, body); refresh(); } catch (e) { data.toast(String(e)); } };
  const mk = (kind: "mkdir" | "touch", base: string) => void askText(kind === "mkdir" ? "Nome da pasta" : "Nome do arquivo", "", kind === "touch" ? "ex.: notas.md" : "").then((name) => { if (name) void op({ op: kind, path: base ? `${base}/${name}` : name }); });
  const rename = (e: TreeEntry) => void askText("Novo nome", e.name).then((name) => { if (name && name !== e.name) void op({ op: "rename", path: e.path, to: e.path.includes("/") ? `${e.path.slice(0, e.path.lastIndexOf("/"))}/${name}` : name }); });
  const del = (e: TreeEntry) => { if (confirm(`Excluir ${e.dir ? "a pasta" : "o arquivo"} "${e.path}"?`)) void op({ op: "delete", path: e.path }); };
  const dragStart = (ev: React.DragEvent, e: TreeEntry) => { ev.dataTransfer.setData("text/plain", e.path); ev.dataTransfer.setData("text/mess-path", e.path); ev.dataTransfer.effectAllowed = "copy"; };
  const title = state.root ? state.root.split("/").pop()! : (data.title || "Arquivos");

  const rows = (rel: string, depth: number): React.ReactNode[] => (dirs[rel] ?? []).flatMap((e) => [
    <div key={e.path} className={`tr-row ${e.dir ? "dir" : ""}`} style={{ paddingLeft: 6 + depth * 14 }} draggable onDragStart={(ev) => dragStart(ev, e)} onClick={() => activate(e)} onDoubleClick={() => e.dir && go(e.path)}
      onContextMenu={(ev) => { ev.preventDefault(); ev.stopPropagation(); setMenu({ x: ev.clientX, y: ev.clientY, e }); }} title={`${e.path}${e.git ? ` · ${GIT_TITLE[e.git] ?? e.git}` : ""}`} data-testid="tree-row">
      <span className="tr-ic">{iconFor(e, open.has(e.path))}</span><span className={`tr-nm ${e.git ? `git-${e.git === "??" ? "new" : e.git === "•" ? "dirty" : "mod"}` : ""}`}>{e.name}</span>
      {e.git && e.git !== "•" && <span className="tr-git">{e.git === "??" ? "U" : e.git}</span>}
    </div>,
    ...(e.dir && open.has(e.path) ? rows(e.path, depth + 1) : []),
  ]);

  return (
    <div className={`node tree ${selected ? "sel" : ""}`} onContextMenu={(ev) => { ev.preventDefault(); setMenu({ x: ev.clientX, y: ev.clientY }); }}>
      <NodeResizer minWidth={220} minHeight={180} isVisible={selected} />
      <div className="bar tree-bar">
        <button className="ib nodrag" title="Voltar" disabled={!hist.current.back.length} onClick={back}><ArrowLeft size={13} /></button>
        <button className="ib nodrag" title="Avançar" disabled={!hist.current.fwd.length} onClick={fwd}><ArrowRight size={13} /></button>
        <button className="ib nodrag" title="Subir" disabled={!state.root} onClick={up}><ArrowUp size={13} /></button>
        <button className="ib nodrag" title="Raiz do espaço" disabled={!state.root} onClick={() => go("")}><Home size={13} /></button>
        <span className="tr-title" title={state.root || "/"}><EditableTitle value={title} onSave={data.onRename} editSignal={data.editSignal ?? 0} /></span>
        <span className="sp" />
        <button className={`ib nodrag ${state.mode === "list" ? "on" : ""}`} title="Lista" onClick={() => commit({ ...state, mode: "list" })}><LayoutList size={13} /></button>
        <button className={`ib nodrag ${state.mode === "grid" ? "on" : ""}`} title="Grade de ícones" data-testid="tree-grid" onClick={() => commit({ ...state, mode: "grid" })}><LayoutGrid size={13} /></button>
        <button className="ib nodrag" title="Atualizar" onClick={refresh}><RefreshCw size={13} /></button>
        <button className="ib nodrag" title="Nova pasta aqui" onClick={() => mk("mkdir", state.root)}><FolderPlus size={13} /></button>
        <button className="ib nodrag" title="Novo arquivo aqui" onClick={() => mk("touch", state.root)}><FilePlus size={13} /></button>
        <button className="ib nodrag" title="Remover nó" onClick={data.onDelete}>✕</button>
      </div>
      {err && <div className="err">{err}</div>}
      <div className={`tr-body nodrag nowheel ${state.mode}`} data-testid="tree-body">
        {hits ? (hits.length ? hits.map((h, i) => (
          <div key={`${h.path}:${h.line ?? i}`} className="tr-row" draggable onDragStart={(ev) => { ev.dataTransfer.setData("text/plain", h.path); }} onClick={() => (/\.(md|markdown|txt)$/i.test(h.path) ? data.onOpenNote(h.path) : data.onPreview(h.path))} title={h.path}>
            <span className="tr-ic"><FileIcon size={14} /></span><span className="tr-nm">{h.path}{h.line ? <span className="mut">:{h.line}</span> : null}</span>{h.text && <span className="tr-snip mut">{h.text}</span>}
          </div>)) : <div className="mut tr-empty">Nada encontrado{q.startsWith(">") ? " no conteúdo" : ""}.</div>)
        : state.mode === "list" ? (rows(state.root, 0).length ? rows(state.root, 0) : <div className="mut tr-empty">Pasta vazia</div>)
        : (dirs[state.root] ?? []).map((e) => (
          <div key={e.path} className="tr-cell" draggable onDragStart={(ev) => dragStart(ev, e)} onClick={() => activate(e)} onContextMenu={(ev) => { ev.preventDefault(); ev.stopPropagation(); setMenu({ x: ev.clientX, y: ev.clientY, e }); }} title={e.path}>
            <span className="tr-big">{e.dir ? <Folder size={28} /> : iconFor(e, false)}</span><span className="tr-cap">{e.name}</span>
          </div>))}
      </div>
      <div className="tr-search nodrag"><Search size={12} className="mut" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar nome · > busca conteúdo" data-testid="tree-search" /></div>
      {menu && (
        <div className="menu-backdrop fixed" onMouseDown={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }}>
          <div className="menu" style={{ left: menu.x, top: menu.y, position: "fixed" }} onMouseDown={(e) => e.stopPropagation()} onClick={() => setMenu(null)}>
            {menu.e ? (<>
              {menu.e.dir && <div className="mi" onClick={() => go(menu.e!.path)}>Abrir como raiz</div>}
              {!menu.e.dir && /\.(md|markdown|txt)$/i.test(menu.e.name) && <div className="mi" onClick={() => data.onOpenNote(menu.e!.path)}>Abrir como nota</div>}
              {!menu.e.dir && <div className="mi" onClick={() => data.onPreview(menu.e!.path)}>Visualizar</div>}
              <div className="mi" onClick={() => void navigator.clipboard.writeText(menu.e!.path)}>Copiar caminho</div>
              {menu.e.dir && <><div className="mi" onClick={() => mk("mkdir", menu.e!.path)}>Nova pasta dentro</div><div className="mi" onClick={() => mk("touch", menu.e!.path)}>Novo arquivo dentro</div></>}
              <div className="mi" onClick={() => rename(menu.e!)}>Renomear…</div>
              <hr /><div className="mi" onClick={() => del(menu.e!)}>Excluir</div>
            </>) : (<>
              <div className="mi" onClick={() => mk("mkdir", state.root)}>Nova pasta</div>
              <div className="mi" onClick={() => mk("touch", state.root)}>Novo arquivo</div>
              <div className="mi" onClick={refresh}>Atualizar</div>
            </>)}
          </div>
        </div>
      )}
      <Handle type="source" position={Position.Right} /><Handle type="target" position={Position.Left} />
    </div>
  );
}
