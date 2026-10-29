import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";
import { NodeToolbar, Position } from "@xyflow/react";
import { Paperclip, SendHorizontal, SquareTerminal, StickyNote, FileText, Folder } from "lucide-react";
import type { FileEntry } from "@messyai/contracts";
import type { Api, Stream } from "./api.js";

export type MentionTarget = { id: string; kind: "terminal" | "note"; title: string; connected: boolean };
export type ComposerProps = {
  open: boolean; nodeId: string; workspaceId: string; sessionId: string; title: string;
  targets: MentionTarget[]; api: Api; stream: Stream; onClose: () => void;
  chatThread?: number; // definido quando a camada de chat está aberta: registra o balão do usuário e marca o prompt
};
type Pill = { n: number; text: string };
const KEYS: Record<string, string> = { ArrowUp: "\x1b[A", ArrowDown: "\x1b[B", ArrowRight: "\x1b[C", ArrowLeft: "\x1b[D", Enter: "\r", Tab: "\t" };
const toBase64 = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] ?? ""); r.onerror = rej; r.readAsDataURL(f); });

/** Compositor flutuante abaixo do terminal: @ menciona nós, # insere arquivo, clipe/colar anexa, colagem longa vira pill, rascunho por terminal. */
export function Composer(p: ComposerProps) {
  const key = `messy.draft.${p.nodeId}`;
  const [text, setText] = useState(() => { try { return localStorage.getItem(key) ?? ""; } catch { return ""; } });
  const [pills, setPills] = useState<Pill[]>([]);
  const [pop, setPop] = useState<{ kind: "@" | "#"; at: number; q: string } | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [sel, setSel] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const fileIn = useRef<HTMLInputElement>(null);
  useEffect(() => { try { if (text) localStorage.setItem(key, text); else localStorage.removeItem(key); } catch { /* sem storage */ } }, [text, key]);
  useEffect(() => { if (p.open) setTimeout(() => ta.current?.focus(), 30); }, [p.open]);
  useEffect(() => { if (pop?.kind !== "#") return; const t = setTimeout(() => void p.api.files(p.nodeId, pop.q).then(setFiles).catch(() => setFiles([])), 120); return () => clearTimeout(t); }, [pop?.kind, pop?.q, p.api, p.nodeId]);

  const mentions = useMemo(() => {
    const q = pop?.kind === "@" ? pop.q.toLowerCase() : "";
    return [...p.targets].sort((a, b) => Number(b.connected) - Number(a.connected)).filter((t) => t.title.toLowerCase().includes(q)).slice(0, 8);
  }, [p.targets, pop]);
  const items: { label: string; icon: React.ReactNode; insert: string }[] = pop?.kind === "@"
    ? mentions.map((m) => ({ label: `${m.title}${m.connected ? "" : " (não conectado)"}`, icon: m.kind === "terminal" ? <SquareTerminal size={13} /> : <StickyNote size={13} />, insert: `@${m.title.replace(/\s+/g, "_")} ` }))
    : files.slice(0, 8).map((f) => ({ label: f.path, icon: f.dir ? <Folder size={13} /> : <FileText size={13} />, insert: `${f.path} ` }));

  const change = (v: string, caret: number) => {
    setText(v);
    const before = v.slice(0, caret); const m = /(^|\s)([@#])([^\s]*)$/.exec(before);
    if (m) { setPop({ kind: m[2] as "@" | "#", at: before.length - m[3]!.length - 1, q: m[3]! }); setSel(0); } else setPop(null);
  };
  const pick = (i: number) => {
    const it = items[i]; if (!it || !pop) return;
    const el = ta.current!; const caret = el.selectionStart;
    const next = text.slice(0, pop.at) + it.insert + text.slice(caret);
    setText(next); setPop(null);
    setTimeout(() => { el.focus(); el.setSelectionRange(pop.at + it.insert.length, pop.at + it.insert.length); }, 0);
  };
  const attach = async (f: File) => {
    setBusy(`enviando ${f.name}…`);
    try { const a = await p.api.attach(p.workspaceId, { name: f.name, dataBase64: await toBase64(f) }); setText((t) => `${t}${t && !t.endsWith(" ") ? " " : ""}${a.path} `); }
    catch (e) { setBusy(String(e)); setTimeout(() => setBusy(null), 2500); return; }
    setBusy(null);
  };
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const img = [...e.clipboardData.items].find((i) => i.type.startsWith("image/"))?.getAsFile();
    if (img) { e.preventDefault(); void attach(new File([img], `colagem-${Date.now()}.png`, { type: img.type })); return; }
    const t = e.clipboardData.getData("text/plain");
    if (t.length > 800 || t.split("\n").length > 2) {
      e.preventDefault(); const n = pills.length + 1; setPills([...pills, { n, text: t }]);
      const el = ta.current!; const tok = `[colagem ${n}] `; const next = text.slice(0, el.selectionStart) + tok + text.slice(el.selectionEnd); setText(next);
    }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const p = e.dataTransfer.getData("text/messy-path") || (e.dataTransfer.files.length ? "" : e.dataTransfer.getData("text/plain"));
    if (p) { setText((t) => `${t}${t && !t.endsWith(" ") ? " " : ""}${p} `); return; }
    for (const f of [...e.dataTransfer.files]) void attach(f);
  };
  const expand = (t: string) => {
    let out = t;
    for (const pl of pills) out = out.replace(`[colagem ${pl.n}]`, pl.text);
    const refs: string[] = [];
    for (const m of p.targets) { const tag = `@${m.title.replace(/\s+/g, "_")}`; if (out.includes(tag)) refs.push(m.kind === "note" ? `${tag} = nota "${m.title}" (ler: messy note read ${m.id.slice(0, 8)})` : `${tag} = terminal "${m.title}" (falar: messy ask ${m.id.slice(0, 8)} "…")`); }
    return refs.length ? `${out}\n[MessyAI] Referências: ${refs.join("; ")}` : out;
  };
  const send = () => {
    const t = text.trim(); if (!t) return;
    const body = expand(t);
    if (p.chatThread) void p.api.say(p.nodeId, { text: t, thread: p.chatThread, role: "user" }).catch(() => {});
    p.stream.send({ type: "acquireLease", sessionId: p.sessionId });
    p.stream.send({ type: "input", sessionId: p.sessionId, data: (p.chatThread ? `[MessyAI chat t${p.chatThread}] ` : "") + body + "\r" });
    setText(""); setPills([]); setPop(null);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (pop && items.length) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => (s + 1) % items.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => (s - 1 + items.length) % items.length); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pick(sel); return; }
      if (e.key === "Escape") { e.preventDefault(); setPop(null); return; }
    }
    if (e.key === "Escape") { e.preventDefault(); p.onClose(); return; }
    if (text === "" && KEYS[e.key] && !e.shiftKey) { e.preventDefault(); p.stream.send({ type: "acquireLease", sessionId: p.sessionId }); p.stream.send({ type: "input", sessionId: p.sessionId, data: KEYS[e.key]! }); return; }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };
  return (
    <NodeToolbar isVisible={p.open} position={Position.Bottom} offset={8} className="composer nodrag nowheel" align="center">
      <div className="cp-box" onDrop={onDrop} onDragOver={(e) => e.preventDefault()} onMouseDown={(e) => e.stopPropagation()} data-testid="composer">
        {pop && items.length > 0 && (
          <div className="cp-pop">
            {items.map((it, i) => <div key={it.label} className={`mi ${i === sel ? "on" : ""}`} onMouseDown={(e) => { e.preventDefault(); pick(i); }}>{it.icon}<span>{it.label}</span></div>)}
          </div>
        )}
        <textarea ref={ta} value={text} rows={Math.min(6, Math.max(1, text.split("\n").length))} placeholder={`Mensagem para ${p.title}. @ menciona · # arquivo · Esc fecha`}
          onChange={(e) => change(e.target.value, e.target.selectionStart)} onKeyDown={onKey} onPaste={onPaste} />
        <div className="cp-row">
          {pills.length > 0 && <span className="mut">{pills.length} colagem(ns)</span>}
          {busy && <span className="mut">{busy}</span>}
          <span className="sp" />
          <button className="tb" title="Anexar arquivo" onClick={() => fileIn.current?.click()}><Paperclip size={15} /></button>
          <input ref={fileIn} type="file" multiple hidden onChange={(e) => { for (const f of [...(e.target.files ?? [])]) void attach(f); e.target.value = ""; }} />
          <button className="tb pri" title="Enviar (Enter)" data-testid="cp-send" onClick={send}><SendHorizontal size={15} /></button>
        </div>
      </div>
    </NodeToolbar>
  );
}
