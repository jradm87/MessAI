import { Pencil, MessageSquare, ArrowUpToLine, GitBranch, RotateCw, Trash2, Copy } from "lucide-react";

export type NodeAction = {
  kind: "terminal" | "note" | "text" | "tree";
  onEdit: () => void;
  onChat?: () => void;
  onRaise: () => void;
  onDuplicate: () => void;
  onLink?: () => void;
  linkCount: number;
  onReload?: () => void;
  onDelete: () => void;
};

/** Barra de ações do nó selecionado, central no topo (abaixo da barra do canvas), como no Maestri. */
export function NodeActionBar({ a }: { a: NodeAction }) {
  return (
    <div className="nodebar center" data-testid="nodebar">
      <button className="tb" title="Renomear" onClick={a.onEdit}><Pencil size={15} /></button>
      {a.kind === "terminal" && <button className="tb" title="Mostrar chat (Ctrl+J)" onClick={a.onChat}><MessageSquare size={15} /></button>}
      <button className="tb" title="Elevar / acoplar" onClick={a.onRaise}><ArrowUpToLine size={15} /></button>
      <button className="tb" title="Duplicar (Ctrl+D)" data-testid="nb-dup" onClick={a.onDuplicate}><Copy size={15} /></button>
      {a.onLink && <button className="tb link" title="Conectar a… (Ctrl+L)" data-testid="nb-link" onClick={a.onLink}><GitBranch size={15} />{a.linkCount > 0 && <span className="nb-badge">{a.linkCount}</span>}</button>}
      {a.onReload && <button className="tb" title="Recarregar" onClick={a.onReload}><RotateCw size={15} /></button>}
      <button className="tb danger" title="Excluir (Delete)" data-testid="nb-del" onClick={a.onDelete}><Trash2 size={15} /></button>
    </div>
  );
}
