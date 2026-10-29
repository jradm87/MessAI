import { MousePointer2, SquareTerminal, StickyNote, Paperclip, Folder, Globe, Type, Pencil, Eraser, MoveUpRight, Minus, Square, Plus, ChevronUp, Hand } from "lucide-react";

export type Tool = "select" | "pan" | "terminal" | "note" | "text" | "tree" | "draw";
export type DrawKind = "pen" | "erase" | "line" | "arrow" | "rect";
export type DrawStyle = { kind: DrawKind; color: string; width: number };
export const COLORS = ["#e0453a", "#f2a93b", "#4cc38a", "#3b82f6", "#a855f7", "#f472b6", "#e5e7eb", "#111827"];

export function Toolbar({ tool, setTool, style, setStyle, onFileTree, onPortal }: { tool: Tool; setTool: (t: Tool) => void; style: DrawStyle; setStyle: (s: DrawStyle) => void; onFileTree: () => void; onPortal: () => void }) {
  const B = ({ t, title, children }: { t: Tool; title: string; children: React.ReactNode }) => (
    <button className={`tb ${tool === t ? "on" : ""}`} title={title} onClick={() => setTool(t)}>{children}</button>
  );
  return (
    <div className="tools-wrap">
      <div className="tools">
        <B t="select" title="Selecionar (V)"><MousePointer2 size={16} /></B>
        <B t="terminal" title="Terminal (T) — arraste para desenhar o tamanho"><SquareTerminal size={16} /></B>
        <B t="note" title="Nota (N)"><StickyNote size={16} /></B>
        <button className="tb off" title="Anexo (em breve)"><Paperclip size={16} /></button>
        <button className={`tb ${tool === "tree" ? "on" : ""}`} title="Árvore de arquivos (F): clique ou arraste no canvas" data-testid="tool-tree" onClick={() => { onFileTree(); setTool("tree"); }}><Folder size={16} /></button>
        <button className="tb off" title="Portal (P) — em breve" onClick={onPortal}><Globe size={16} /></button>
        <B t="text" title="Texto (L)"><Type size={16} /></B>
        <B t="draw" title="Desenhar (B)"><Pencil size={16} /></B>
        <B t="pan" title="Mover (H)"><Hand size={16} /></B>
      </div>
      {tool === "draw" && (
        <div className="tools sub">
          {([["pen", <Pencil size={15} />, "Lápis"], ["erase", <Eraser size={15} />, "Borracha"], ["arrow", <MoveUpRight size={15} />, "Seta"], ["line", <Minus size={15} />, "Linha"], ["rect", <Square size={15} />, "Retângulo (B)"]] as const).map(([k, ic, tt]) => (
            <button key={k} className={`tb ${style.kind === k ? "on" : ""}`} title={tt} onClick={() => setStyle({ ...style, kind: k })}>{ic}</button>
          ))}
          <span className="sep" />
          {COLORS.map((c) => <button key={c} className={`sw ${style.color === c ? "on" : ""}`} style={{ background: c }} title={c} onClick={() => setStyle({ ...style, color: c })} />)}
          <span className="sep" />
          <button className="tb" title="Mais fino ([)" onClick={() => setStyle({ ...style, width: Math.max(1, style.width - 1) })}><Minus size={14} /></button>
          <span className="pt">{style.width}pt</span>
          <button className="tb" title="Mais grosso (])" onClick={() => setStyle({ ...style, width: Math.min(24, style.width + 1) })}><Plus size={14} /></button>
          <span className="sep" />
          <button className="tb" title="Recolher" onClick={() => setTool("select")}><ChevronUp size={14} /></button>
        </div>
      )}
    </div>
  );
}
