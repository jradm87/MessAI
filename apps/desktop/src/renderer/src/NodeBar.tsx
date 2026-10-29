import { NodeToolbar, Position } from "@xyflow/react";
import { Pencil, MessageSquare, ArrowUpToLine, GitBranch, RotateCw, Trash2 } from "lucide-react";

export type NodeBarProps = {
  visible: boolean;
  onEdit: () => void;
  onChat?: () => void;
  onRaise?: () => void;
  onLink: () => void;
  linkCount: number;
  onReload?: () => void;
  onDelete: () => void;
};

/** Barra contextual acima do nó selecionado (mesma ordem do Maestri): editar, chat, elevar/acoplar, conectar, recarregar, excluir. */
export function NodeBar(p: NodeBarProps) {
  return (
    <NodeToolbar isVisible={p.visible} position={Position.Top} offset={8} className="nodebar">
      <button className="tb" title="Editar nome" onClick={p.onEdit}><Pencil size={14} /></button>
      <button className="tb" title="Mostrar chat (Ctrl+J)" onClick={p.onChat} disabled={!p.onChat}><MessageSquare size={14} /></button>
      <button className="tb" title="Elevar / acoplar" onClick={p.onRaise} disabled={!p.onRaise}><ArrowUpToLine size={14} /></button>
      <button className="tb link" title="Conectar a… (Ctrl+L)" data-testid="nb-link" onClick={p.onLink}><GitBranch size={14} />{p.linkCount > 0 && <span className="nb-badge">{p.linkCount}</span>}</button>
      {p.onReload && <button className="tb" title="Recarregar (reinicia o processo)" onClick={p.onReload}><RotateCw size={14} /></button>}
      <button className="tb danger" title="Excluir" onClick={p.onDelete}><Trash2 size={14} /></button>
    </NodeToolbar>
  );
}
