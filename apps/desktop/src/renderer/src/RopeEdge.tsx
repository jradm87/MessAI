import { useEffect, useRef, useState } from "react";
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from "@xyflow/react";
import { Spline, Workflow, Scissors, ArrowLeftToLine, ArrowRightToLine } from "lucide-react";

export type EdgeData = { style: "rope" | "circuit"; onStyle: (s: "rope" | "circuit") => void; onCut: () => void; onGo: (end: "source" | "target") => void };

/** Controles do cabo quando selecionado: estilo Corda/Circuito, ir à ponta, cortar. */
function EdgeControls({ x, y, data }: { x: number; y: number; data: EdgeData }) {
  return (
    <EdgeLabelRenderer>
      <div className="edgebar nodrag nopan" style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` }} data-testid="edgebar" onMouseDown={(e) => e.stopPropagation()}>
        <button className="tb" title="Ir ao nó de origem" onClick={() => data.onGo("source")}><ArrowLeftToLine size={13} /></button>
        <button className={`tb ${data.style === "rope" ? "on" : ""}`} title="Estilo Corda" data-testid="eb-rope" onClick={() => data.onStyle("rope")}><Spline size={13} /></button>
        <button className={`tb ${data.style === "circuit" ? "on" : ""}`} title="Estilo Circuito" data-testid="eb-circuit" onClick={() => data.onStyle("circuit")}><Workflow size={13} /></button>
        <button className="tb" title="Ir ao nó de destino" onClick={() => data.onGo("target")}><ArrowRightToLine size={13} /></button>
        <button className="tb danger" title="Cortar conexão" data-testid="eb-cut" onClick={data.onCut}><Scissors size={13} /></button>
      </div>
    </EdgeLabelRenderer>
  );
}

/** Corda pendurada com física simples: balança quando uma ponta se move e amortece até parar. */
export function RopeEdge({ id, sourceX, sourceY, targetX, targetY, selected, data }: EdgeProps & { data?: EdgeData }) {
  const prev = useRef({ sx: sourceX, sy: sourceY, tx: targetX, ty: targetY });
  const phys = useRef({ x: 0, vx: 0, y: 0, vy: 0 }); // deslocamento da barriga (mola amortecida)
  const [, force] = useState(0);
  const raf = useRef(0);
  // impulso proporcional ao movimento das pontas
  const mdx = (sourceX - prev.current.sx + targetX - prev.current.tx) / 2, mdy = (sourceY - prev.current.sy + targetY - prev.current.ty) / 2;
  prev.current = { sx: sourceX, sy: sourceY, tx: targetX, ty: targetY };
  if (Math.abs(mdx) + Math.abs(mdy) > 0.01) { phys.current.vx -= mdx * 0.9; phys.current.vy -= mdy * 0.6; }
  useEffect(() => {
    const step = () => {
      const p = phys.current; const k = 0.08, damp = 0.86;
      p.vx = (p.vx - p.x * k) * damp; p.vy = (p.vy - p.y * k) * damp; p.x += p.vx; p.y += p.vy;
      const moving = Math.abs(p.vx) + Math.abs(p.vy) + Math.abs(p.x) + Math.abs(p.y) > 0.15;
      if (moving) { force((n) => n + 1); raf.current = requestAnimationFrame(step); } else { p.x = p.y = p.vx = p.vy = 0; raf.current = 0; force((n) => n + 1); }
    };
    if (!raf.current && (Math.abs(phys.current.vx) + Math.abs(phys.current.vy) > 0.01)) raf.current = requestAnimationFrame(step);
  });
  useEffect(() => () => { if (raf.current) cancelAnimationFrame(raf.current); }, []);
  const dx = targetX - sourceX, dy = targetY - sourceY, len = Math.hypot(dx, dy);
  const sag = Math.min(160, 40 + len * 0.18);
  const ox = Math.max(-120, Math.min(120, phys.current.x)), oy = Math.max(-80, Math.min(80, phys.current.y));
  const c1x = sourceX + dx * 0.25 + ox, c1y = sourceY + dy * 0.25 + sag + oy;
  const c2x = sourceX + dx * 0.75 + ox, c2y = sourceY + dy * 0.75 + sag + oy;
  const path = `M ${sourceX} ${sourceY} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${targetX} ${targetY}`;
  const mx = (sourceX + targetX) / 2 + ox * 0.75, my = (sourceY + targetY) / 2 + sag * 0.75 + oy * 0.75;
  return (<>
    <BaseEdge id={id} path={path} className={`rope ${selected ? "sel" : ""}`} interactionWidth={16} />
    {selected && data && <EdgeControls x={mx} y={my - 28} data={data} />}
  </>);
}

/** Circuito: caminho ortogonal com cantos arredondados. */
export function CircuitEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected, data }: EdgeProps & { data?: EdgeData }) {
  const [path, lx, ly] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 10, offset: 24 });
  return (<>
    <BaseEdge id={id} path={path} className={`circuit ${selected ? "sel" : ""}`} interactionWidth={16} />
    {selected && data && <EdgeControls x={lx} y={ly - 28} data={data} />}
  </>);
}
