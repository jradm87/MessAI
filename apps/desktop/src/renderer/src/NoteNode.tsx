import { useEffect, useRef, useState, memo } from "react";
import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";
import { Eye, Pencil, Lock, Unlock, Palette, FolderInput, FileText, KeyRound } from "lucide-react";
import { EditableTitle } from "./EditableTitle.js";
import type { NodeExtras } from "./TerminalNode.js";
import { renderMarkdown, useMermaid } from "./md.js";
import { countRender } from "./perf.js";
import { WS_COLORS } from "./wsicons.js";

export type NoteData = {
  title: string; content: string; locked: boolean; color?: string; filePath?: string;
  secret?: boolean; secretEnv?: string;
  onChange: (content: string) => void; onDelete: () => void; onRename: (t: string) => void;
  onLock: (locked: boolean) => void; onColor: (color: string | null) => void; onMove: () => void; editSignal?: number;
  onSecret: (secret: boolean, envName?: string) => void; onReveal: () => Promise<string>;
} & NodeExtras;

/** Nota Markdown: modos Formatada/Raw, Mermaid, bloqueio para agentes, cor, arquivo .md real (Mover para…). */
function NoteNodeImpl({ id, data, selected }: NodeProps & { data: NoteData }) {
  countRender(id);
  const [text, setText] = useState(data.content);
  const [raw, setRaw] = useState(data.content === "");
  const [colors, setColors] = useState(false);
  const [envName, setEnvName] = useState(data.secretEnv ?? "");
  const [revealed, setRevealed] = useState<string | null>(null);
  useEffect(() => setEnvName(data.secretEnv ?? ""), [data.secretEnv]);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => setText(data.content), [data.content]);
  useEffect(() => {
    if (text === data.content) return;
    const t = setTimeout(() => data.onChange(text), 600);
    return () => clearTimeout(t);
  }, [text]);
  useMermaid(body, [data.content, raw]);
  const tint = data.color ? { background: `color-mix(in srgb, ${data.color} 14%, var(--note))` } : undefined;
  return (
    <div className={`node note ${selected ? "sel" : ""} ${data.locked ? "locked" : ""} ${data.secret ? "secret" : ""}`} style={tint}>
      <NodeResizer minWidth={160} minHeight={100} isVisible={selected} />
      <div className="bar" style={data.color ? { background: `color-mix(in srgb, ${data.color} 28%, var(--note-bar))` } : undefined}>
        <EditableTitle value={data.title} onSave={data.onRename} editSignal={data.editSignal ?? 0} />
        {data.locked && <Lock size={12} className="mut" />}
        {data.secret && <KeyRound size={12} className="mut" />}
        <span className="sp" />
        {!data.secret && <button className="ib nodrag" title={raw ? "Ver formatada" : "Editar (raw)"} data-testid="note-mode" onClick={() => setRaw((v) => !v)}>{raw ? <Eye size={13} /> : <Pencil size={13} />}</button>}
        <button className={`ib nodrag ${data.secret ? "on" : ""}`} title={data.secret ? "Nota secreta (clique para tornar normal)" : "Tornar secreta: valor mascarado e injetado como env no agente ligado"} data-testid="note-secret" onClick={() => data.onSecret(!data.secret, envName)}><KeyRound size={13} /></button>
        {!data.secret && <button className="ib nodrag" title={data.locked ? "Desbloquear: agentes voltam a escrever" : "Bloquear: agentes só leem"} data-testid="note-lock" onClick={() => data.onLock(!data.locked)}>{data.locked ? <Unlock size={13} /> : <Lock size={13} />}</button>}
        <button className="ib nodrag" title="Cor" onClick={() => setColors((v) => !v)}><Palette size={13} /></button>
        <button className="ib nodrag" title={data.filePath ? `Arquivo: ${data.filePath}\nMover para…` : "Mover para…"} onClick={data.onMove}>{data.filePath ? <FileText size={13} /> : <FolderInput size={13} />}</button>
        <button className="ib nodrag" title="Remover" onClick={data.onDelete}>✕</button>
        {colors && (
          <div className="menu color-menu nodrag" onMouseLeave={() => setColors(false)}>
            <button className={`sw ${!data.color ? "on" : ""}`} style={{ background: "var(--note-bar)" }} title="padrão" onClick={() => { setColors(false); data.onColor(null); }} />
            {WS_COLORS.map((c) => <button key={c} className={`sw ${data.color === c ? "on" : ""}`} style={{ background: c }} title={c} onClick={() => { setColors(false); data.onColor(c); }} />)}
          </div>
        )}
      </div>
      {data.secret
        ? <div className="note-secret nodrag nowheel" data-testid="note-secret-body">
            <label className="ns-row">env:
              <input className="ns-env" value={envName} placeholder="SENHA" spellCheck={false} onChange={(e) => setEnvName(e.target.value.replace(/[^A-Za-z0-9_]/g, ""))} onBlur={() => { if ((envName || "") !== (data.secretEnv ?? "")) data.onSecret(true, envName); }} />
            </label>
            {revealed === null
              ? <button className="ns-reveal" data-testid="note-secret-reveal" onClick={() => { void data.onReveal().then(setRevealed).catch(() => setRevealed("")); }}><Eye size={13} /> Revelar / editar</button>
              : <><textarea className="ns-val nodrag nowheel" data-testid="note-secret-value" value={revealed} spellCheck={false} placeholder="valor secreto (ex.: a senha)" onChange={(e) => setRevealed(e.target.value)} autoFocus />
                 <div className="ns-actions"><button className="pri" onClick={() => { data.onChange(revealed ?? ""); setRevealed(null); }}>Salvar</button><button onClick={() => setRevealed(null)}>Ocultar</button></div></>}
            <div className="ns-hint mut">Injetada no agente ligado como <b>${envName || "ENV"}</b> — ele usa por referência, nunca vê o valor.</div>
          </div>
        : raw
        ? <textarea className="nodrag nowheel" value={text} onChange={(e) => setText(e.target.value)} placeholder="Escreva em Markdown… (```mermaid para diagramas)" onBlur={() => { if (text.trim()) setRaw(false); }} autoFocus={data.content !== ""} />
        : <div ref={body} className="md note-md nodrag nowheel" data-testid="note-md" onDoubleClick={() => setRaw(true)} dangerouslySetInnerHTML={{ __html: renderMarkdown(data.content) }} />}
      <Handle type="source" position={Position.Right} /><Handle type="target" position={Position.Left} />
    </div>
  );
}

/** #42: memo — o wrapper do React Flow re-renderiza o nó em eventos que não mexem nas props dele (viewport, nós vizinhos). */
export const NoteNode = memo(NoteNodeImpl);
