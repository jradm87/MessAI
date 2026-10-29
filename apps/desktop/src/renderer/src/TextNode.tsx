import { useEffect, useState } from "react";
import { NodeResizer, type NodeProps } from "@xyflow/react";

export type TextData = { content: string; onChange: (c: string) => void; onDelete: () => void; onRaise: () => void; editSignal?: number };

/** Bloco de texto solto no canvas, sem cabeçalho. Duplo clique edita. */
export function TextNode({ data, selected }: NodeProps & { data: TextData }) {
  const [text, setText] = useState(data.content);
  const [edit, setEdit] = useState(data.content === "");
  useEffect(() => { if ((data.editSignal ?? 0) > 0) setEdit(true); }, [data.editSignal]);
  useEffect(() => setText(data.content), [data.content]);
  useEffect(() => { if (text === data.content) return; const t = setTimeout(() => data.onChange(text), 500); return () => clearTimeout(t); }, [text]);
  return (
    <div className={`node textblock ${selected ? "sel" : ""}`} onDoubleClick={() => setEdit(true)}>
      <NodeResizer minWidth={80} minHeight={32} isVisible={selected} />
      {edit ? <textarea className="nodrag nowheel" autoFocus value={text} onChange={(e) => setText(e.target.value)} onBlur={() => setEdit(false)} placeholder="Texto" />
            : <div className="txt">{text || <span className="mut">Texto</span>}</div>}
    </div>
  );
}
