import { useEffect, useRef, useState } from "react";
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, useInternalNode, useStore, type EdgeProps, type Position } from "@xyflow/react";
import { Spline, Workflow, Scissors, ArrowLeftToLine, ArrowRightToLine } from "lucide-react";
import { floatingEnds, borderSide, pushOutsideRect, type Rect } from "@messai/domain";

export type EdgeData = { style: "rope" | "circuit"; onStyle: (s: "rope" | "circuit") => void; onCut: () => void; onGo: (end: "source" | "target") => void };

type InternalNode = ReturnType<typeof useInternalNode>;
const nodeRect = (n: InternalNode): Rect | null => {
  const w = n?.measured?.width, h = n?.measured?.height, pos = n?.internals?.positionAbsolute;
  return (w && h && pos) ? { x: pos.x, y: pos.y, w, h } : null;
};
const POS: Record<string, Position> = { top: "top" as Position, bottom: "bottom" as Position, left: "left" as Position, right: "right" as Position };

/** Retângulos de todos os nós (menos as duas pontas) — obstáculos da corda. Re-renderiza só quando algum nó muda de posição/tamanho. */
function useObstacles(sourceId: string, targetId: string): Rect[] {
  return useStore(
    (s) => { const out: Rect[] = []; for (const [, n] of s.nodeLookup) { if (n.id === sourceId || n.id === targetId) continue; const w = n.measured?.width, h = n.measured?.height, p = n.internals?.positionAbsolute; if (w && h && p) out.push({ x: p.x, y: p.y, w, h }); } return out; },
    (a, b) => a.length === b.length && a.every((r, i) => r.x === b[i]!.x && r.y === b[i]!.y && r.w === b[i]!.w && r.h === b[i]!.h),
  );
}

/** Controles do cabo quando selecionado: estilo, ir à ponta, cortar. */
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

const N = 18; // pontos da corda
const ITER = 6; // iterações de restrição por quadro
type P = { x: number; y: number; px: number; py: number };

/** Caminho suave (Catmull-Rom → Bézier) passando por todos os pontos. */
function smoothPath(pts: P[]): string {
  if (pts.length < 2) return "";
  let d = `M ${pts[0]!.x.toFixed(1)} ${pts[0]!.y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!, p1 = pts[i]!, p2 = pts[i + 1]!, p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

/**
 * Corda física (Verlet): cadeia de pontos com gravidade e comprimento folgado que PENDURA entre os dois nós, encosta no ponto da borda mais
 * próximo e COLIDE com os demais nós — nunca passa por dentro deles, descansa/contorna a borda (como a corda do Maestri). Renderizada por cima.
 */
export function RopeEdge({ id, source, target, sourceX, sourceY, targetX, targetY, selected, data }: EdgeProps & { data?: EdgeData }) {
  const sR = nodeRect(useInternalNode(source)), tR = nodeRect(useInternalNode(target));
  let ax = sourceX, ay = sourceY, bx = targetX, by = targetY;
  if (sR && tR) { const e = floatingEnds(sR, tR); ax = e.sx; ay = e.sy; bx = e.tx; by = e.ty; }
  const obstacles = useObstacles(source, target);
  const endRef = useRef<{ s: Rect | null; t: Rect | null }>({ s: sR, t: tR }); endRef.current = { s: sR, t: tR }; // os próprios nós também são obstáculos (a corda contorna, não passa por cima)
  const pts = useRef<P[]>([]);
  const raf = useRef(0);
  const [, force] = useState(0);
  if (pts.current.length !== N) pts.current = Array.from({ length: N }, (_, i) => { const t = i / (N - 1); const x = ax + (bx - ax) * t, y = ay + (by - ay) * t; return { x, y, px: x, py: y }; });

  const dist = Math.hypot(bx - ax, by - ay);
  const rest = (Math.max(dist, 60) * 1.08) / (N - 1); // folga leve → barriga de corda (sem drapejar sobre os blocos)

  useEffect(() => {
    const step = () => {
      const p = pts.current; const grav = 0.65, damp = 0.92;
      p[0]!.x = ax; p[0]!.y = ay; p[N - 1]!.x = bx; p[N - 1]!.y = by;
      for (let i = 1; i < N - 1; i++) { const q = p[i]!; const vx = (q.x - q.px) * damp, vy = (q.y - q.py) * damp; q.px = q.x; q.py = q.y; q.x += vx; q.y += vy + grav; }
      for (let it = 0; it < ITER; it++) {
        p[0]!.x = ax; p[0]!.y = ay; p[N - 1]!.x = bx; p[N - 1]!.y = by;
        for (let i = 0; i < N - 1; i++) { const a = p[i]!, b = p[i + 1]!; const dx = b.x - a.x, dy = b.y - a.y; const d = Math.hypot(dx, dy) || 1; const k = ((d - rest) / d) * 0.5; const ox = dx * k, oy = dy * k; if (i !== 0) { a.x += ox; a.y += oy; } if (i + 1 !== N - 1) { b.x -= ox; b.y -= oy; } }
        const ends = endRef.current;
        for (let i = 1; i < N - 1; i++) {
          for (const r of obstacles) { const c = pushOutsideRect(p[i]!.x, p[i]!.y, r, 6); p[i]!.x = c.x; p[i]!.y = c.y; }
          // contorna os próprios nós de ponta (exceto os pontos colados às âncoras, pra não torcer na saída)
          if (ends.s && i > 1) { const c = pushOutsideRect(p[i]!.x, p[i]!.y, ends.s, 4); p[i]!.x = c.x; p[i]!.y = c.y; }
          if (ends.t && i < N - 2) { const c = pushOutsideRect(p[i]!.x, p[i]!.y, ends.t, 4); p[i]!.x = c.x; p[i]!.y = c.y; }
        }
      }
      p[0]!.x = ax; p[0]!.y = ay; p[N - 1]!.x = bx; p[N - 1]!.y = by;
      force((n) => (n + 1) % 1e6);
      const moving = p.some((q) => Math.abs(q.x - q.px) + Math.abs(q.y - q.py) > 0.08);
      raf.current = moving ? requestAnimationFrame(step) : 0;
    };
    if (!raf.current) raf.current = requestAnimationFrame(step);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); raf.current = 0; };
  }, [ax, ay, bx, by, rest, obstacles]);

  const path = smoothPath(pts.current);
  const mid = pts.current[Math.floor(N / 2)] ?? { x: (ax + bx) / 2, y: (ay + by) / 2 };
  return (<>
    <BaseEdge id={id} path={path} className={`rope ${selected ? "sel" : ""}`} interactionWidth={16} />
    {selected && data && <EdgeControls x={mid.x} y={mid.y - 28} data={data} />}
  </>);
}

/** Circuito: caminho ortogonal, pontas no ponto de borda mais próximo. */
export function CircuitEdge({ id, source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected, data }: EdgeProps & { data?: EdgeData }) {
  const sR = nodeRect(useInternalNode(source)), tR = nodeRect(useInternalNode(target));
  if (sR && tR) { const e = floatingEnds(sR, tR); sourceX = e.sx; sourceY = e.sy; targetX = e.tx; targetY = e.ty; sourcePosition = POS[borderSide(sR, e.sx, e.sy)]!; targetPosition = POS[borderSide(tR, e.tx, e.ty)]!; }
  const [path, lx, ly] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 10, offset: 24 });
  return (<>
    <BaseEdge id={id} path={path} className={`circuit ${selected ? "sel" : ""}`} interactionWidth={16} />
    {selected && data && <EdgeControls x={lx} y={ly - 28} data={data} />}
  </>);
}
