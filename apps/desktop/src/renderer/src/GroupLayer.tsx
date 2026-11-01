import { useState, type CSSProperties } from "react";
import { ViewportPortal, type Node as FlowNode } from "@xyflow/react";
import { Ungroup, X } from "lucide-react";
import type { NodeGroup } from "@messai/contracts";
import { groupBounds } from "@messai/domain";
import { WS_COLORS } from "./wsicons.js";

/**
 * #78 — contêineres de grupo desenhados atrás dos nós (coordenadas do canvas) + linhas-guia do encaixe magnético.
 * A caixa acompanha as posições VIVAS do flow (durante o arrasto também). Só o rótulo/botões recebem o mouse.
 */
export type Guides = { vertical: number[]; horizontal: number[] };
type Props = {
  groups: NodeGroup[]; flow: FlowNode[]; guides: Guides;
  onSelect: (groupId: string) => void; onRename: (groupId: string, label: string) => void; onColor: (groupId: string, color: string) => void; onUngroup: (groupId: string) => void;
};
const geomOf = (n: FlowNode) => ({ x: n.position.x, y: n.position.y, w: Number((n.style as { width?: number } | undefined)?.width ?? n.measured?.width ?? 200), h: Number((n.style as { height?: number } | undefined)?.height ?? n.measured?.height ?? 120) });

export function GroupLayer({ groups, flow, guides, onSelect, onRename, onColor, onUngroup }: Props) {
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  const [colors, setColors] = useState<string | null>(null);
  return (
    <ViewportPortal>
      <div className="ngroups" style={{ position: "absolute", left: 0, top: 0, width: 1, height: 1, pointerEvents: "none", zIndex: -1 }}>
        {groups.map((g) => {
          const members = flow.filter((n) => (n.data as { groupId?: string }).groupId === g.groupId);
          const b = groupBounds(members.map(geomOf), 18); if (!b) return null;
          const color = g.color || "var(--acc)";
          return (
            <div key={g.groupId} className="ngroup" data-testid="ngroup" style={{ left: b.x, top: b.y, width: b.w, height: b.h, "--g": color } as CSSProperties}>
              <div className="ngroup-label nodrag nopan" style={{ pointerEvents: "auto" }} onMouseDown={(e) => e.stopPropagation()} onClick={() => onSelect(g.groupId)} onDoubleClick={(e) => { e.stopPropagation(); setEditing({ id: g.groupId, value: g.label }); }} title="Clique: selecionar o grupo · duplo clique: renomear">
                {editing?.id === g.groupId
                  ? <input autoFocus value={editing.value} data-testid="ngroup-rename" onChange={(e) => setEditing({ id: g.groupId, value: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") { onRename(g.groupId, editing.value.trim()); setEditing(null); } if (e.key === "Escape") setEditing(null); }} onBlur={() => { onRename(g.groupId, editing.value.trim()); setEditing(null); }} />
                  : <span className="ngroup-name" data-testid="ngroup-name">{g.label || "Grupo"} <span className="mut">· {members.length}</span></span>}
                <button className="sw" style={{ background: color }} title="Cor do grupo" data-testid="ngroup-color" onClick={(e) => { e.stopPropagation(); setColors(colors === g.groupId ? null : g.groupId); }} />
                <button className="tb" title="Desagrupar (Ctrl+Shift+G)" data-testid="ngroup-ungroup" onClick={(e) => { e.stopPropagation(); onUngroup(g.groupId); }}><Ungroup size={12} /></button>
                {colors === g.groupId && (
                  <div className="menu color-menu ngroup-colors" onMouseLeave={() => setColors(null)}>
                    <button className={`sw ${!g.color ? "on" : ""}`} style={{ background: "var(--acc)" }} title="padrão" onClick={() => { setColors(null); onColor(g.groupId, ""); }} />
                    {WS_COLORS.map((c) => <button key={c} className={`sw ${g.color === c ? "on" : ""}`} style={{ background: c }} title={c} onClick={() => { setColors(null); onColor(g.groupId, c); }} />)}
                    <button className="tb" title="fechar" onClick={() => setColors(null)}><X size={11} /></button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {guides.vertical.map((x) => <div key={`v${x}`} className="snap-guide v" style={{ left: x }} />)}
        {guides.horizontal.map((y) => <div key={`h${y}`} className="snap-guide h" style={{ top: y }} />)}
      </div>
    </ViewportPortal>
  );
}
