import { useEffect, useState } from "react";

/** Duplo clique edita; Enter salva; Esc cancela. */
export function EditableTitle({ value, onSave, editSignal = 0 }: { value: string; onSave: (v: string) => void; editSignal?: number }) {
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (editSignal > 0) setEditing(true); }, [editSignal]);
  const [draft, setDraft] = useState(value);
  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);
  if (!editing) return <span className="title" title="duplo clique para renomear" onDoubleClick={() => setEditing(true)}>{value}</span>;
  const commit = () => { setEditing(false); const v = draft.trim(); if (v && v !== value) onSave(v); };
  return (
    <input className="title-edit nodrag" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
      onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setDraft(value); setEditing(false); } }}
      onMouseDown={(e) => e.stopPropagation()} />
  );
}
