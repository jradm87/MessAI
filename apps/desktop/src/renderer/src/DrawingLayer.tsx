import { useEffect, useRef, useState } from "react";
import { ViewportPortal, useReactFlow } from "@xyflow/react";
import type { Drawing } from "@messai/contracts";
import type { DrawStyle, Tool } from "./Toolbar.js";

type Pt = [number, number];
export type CreateRect = { x: number; y: number; w: number; h: number };

/**
 * Camada que (1) desenha os traços persistidos no espaço do canvas, (2) captura o mouse quando a
 * ferramenta não é seleção (desenhar/arrastar retângulo) e (3) em modo seleção, deixa selecionar,
 * mover e destacar os desenhos (como os nós).
 */
export function DrawingLayer({ tool, style, drawings, selected, onSelect, onMovePoints, onDraw, onErase, onCreateRect }: {
  tool: Tool; style: DrawStyle; drawings: Drawing[];
  selected: Set<string>;
  onSelect: (id: string, additive: boolean) => void;
  onMovePoints: (id: string, points: Pt[]) => void;
  onDraw: (d: { kind: Exclude<DrawStyle["kind"], "erase">; points: Pt[]; color: string; width: number }) => void;
  onErase: (drawingId: string) => void;
  onCreateRect: (kind: "terminal" | "note" | "text" | "tree", rect: CreateRect) => void;
}) {
  const rf = useReactFlow();
  const [live, setLive] = useState<Pt[] | null>(null);
  const [rect, setRect] = useState<CreateRect | null>(null);
  const start = useRef<Pt | null>(null);
  const capturing = tool === "draw" || tool === "terminal" || tool === "note" || tool === "text" || tool === "tree";
  const selectMode = tool === "select";
  const erasable = tool === "draw" && style.kind === "erase";

  useEffect(() => { if (!capturing) { setLive(null); setRect(null); } }, [capturing]);

  const toFlow = (e: React.MouseEvent): Pt => { const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }); return [p.x, p.y]; };
  const onDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const p = toFlow(e); start.current = p;
    if (tool === "draw") { if (style.kind !== "erase") setLive([p]); }
    else setRect({ x: p[0], y: p[1], w: 0, h: 0 });
  };
  const onMove = (e: React.MouseEvent) => {
    if (!start.current) return;
    const p = toFlow(e); const s = start.current;
    if (tool === "draw") { if (style.kind === "pen") setLive((l) => (l ? [...l, p] : [p])); else if (style.kind !== "erase") setLive([s, p]); }
    else setRect({ x: Math.min(s[0], p[0]), y: Math.min(s[1], p[1]), w: Math.abs(p[0] - s[0]), h: Math.abs(p[1] - s[1]) });
  };
  const onUp = () => {
    const s = start.current; start.current = null;
    if (tool === "draw" && live && style.kind !== "erase") {
      const pts = style.kind === "pen" ? simplify(live) : live;
      if (pts.length >= 2 && dist(pts[0]!, pts[pts.length - 1]!) > 2) onDraw({ kind: style.kind, points: pts, color: style.color, width: style.width });
    }
    if (rect && s && (tool === "terminal" || tool === "note" || tool === "text" || tool === "tree")) {
      const r = rect.w < 20 && rect.h < 20
        ? { x: rect.x, y: rect.y, w: tool === "terminal" ? 640 : tool === "tree" ? 300 : 260, h: tool === "terminal" ? 380 : tool === "tree" ? 420 : 160 } // clique simples: tamanho padrão
        : rect;
      onCreateRect(tool, r);
    }
    setLive(null); setRect(null);
  };

  // ----- seleção / mover desenhos (modo seleção) -----
  const dragRef = useRef<{ startX: number; startY: number; orig: Map<string, Pt[]> } | null>(null);
  const [off, setOff] = useState<Pt>([0, 0]);
  const dragMove = (e: MouseEvent) => { const d = dragRef.current; if (!d) return; const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }); setOff([p.x - d.startX, p.y - d.startY]); };
  const dragUp = (e: MouseEvent) => {
    window.removeEventListener("mousemove", dragMove); window.removeEventListener("mouseup", dragUp);
    const d = dragRef.current; dragRef.current = null; setOff([0, 0]); if (!d) return;
    const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const dx = p.x - d.startX, dy = p.y - d.startY;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return; // só clique, não moveu
    for (const [id, pts] of d.orig) onMovePoints(id, pts.map(([x, y]) => [x + dx, y + dy] as Pt));
  };
  const strokeDown = (e: React.MouseEvent, id: string) => {
    if (erasable) { e.stopPropagation(); onErase(id); return; }
    if (!selectMode || e.button !== 0) return;
    e.stopPropagation();
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    if (!selected.has(id) || additive) onSelect(id, additive);
    const ids = additive ? [...new Set([...selected, id])] : selected.has(id) ? [...selected] : [id];
    const orig = new Map<string, Pt[]>();
    for (const did of ids) { const dd = drawings.find((x) => x.drawingId === did); if (dd) orig.set(did, dd.points); }
    const p = toFlow(e); dragRef.current = { startX: p[0], startY: p[1], orig }; setOff([0, 0]);
    window.addEventListener("mousemove", dragMove); window.addEventListener("mouseup", dragUp);
  };

  const interactive = selectMode || erasable;
  const bbox = selected.size ? boundingBox(drawings.filter((d) => selected.has(d.drawingId))) : null;

  return (
    <>
      <ViewportPortal>
        <svg className="drawings" style={{ overflow: "visible", position: "absolute", left: 0, top: 0, width: 1, height: 1, pointerEvents: "none" }}>
          <defs><marker id="arrowhead" markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L4,2 L0,4 z" fill="context-stroke" /></marker></defs>
          {drawings.map((d) => {
            const sel = selected.has(d.drawingId);
            const tf = sel && (off[0] !== 0 || off[1] !== 0) ? `translate(${off[0]} ${off[1]})` : undefined;
            return (
              <g key={d.drawingId} transform={tf}>
                {sel && <Stroke d={d} highlight />}
                <Stroke d={d} {...(interactive ? { onDown: (e) => strokeDown(e, d.drawingId), cursor: erasable ? "cell" : "move" } : {})} />
              </g>
            );
          })}
          {bbox && <rect x={bbox.x + off[0]} y={bbox.y + off[1]} width={bbox.w} height={bbox.h} fill="none" stroke="#5aa9ff" strokeDasharray="5 4" strokeWidth={1} vectorEffect="non-scaling-stroke" pointerEvents="none" />}
          {live && <Stroke d={{ drawingId: "live", workspaceId: "", kind: style.kind === "erase" ? "pen" : style.kind, points: live, color: style.color, width: style.width, createdAt: "" }} />}
          {rect && <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} fill="rgba(90,169,255,.08)" stroke="#5aa9ff" strokeDasharray="6 4" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}
        </svg>
      </ViewportPortal>
      {capturing && (
        <div className={`capture ${tool} ${style.kind}`} onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={() => start.current && onUp()} />
      )}
    </>
  );
}

function Stroke({ d, highlight, onDown, cursor }: { d: Drawing; highlight?: boolean; onDown?: (e: React.MouseEvent) => void; cursor?: string }) {
  const common = {
    stroke: highlight ? "#5aa9ff" : d.color,
    strokeWidth: highlight ? d.width + 7 : d.width,
    fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
    ...(highlight ? { opacity: 0.35 } : {}),
    style: { pointerEvents: (onDown ? "stroke" : "none") as "stroke" | "none", ...(cursor ? { cursor } : {}) },
    ...(onDown ? { onMouseDown: onDown } : {}),
  };
  const [a, b] = [d.points[0]!, d.points[d.points.length - 1]!];
  if (d.kind === "rect") return <rect x={Math.min(a[0], b[0])} y={Math.min(a[1], b[1])} width={Math.abs(b[0] - a[0])} height={Math.abs(b[1] - a[1])} rx={d.width} {...common} />;
  if (d.kind === "line" || d.kind === "arrow") return <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} markerEnd={d.kind === "arrow" && !highlight ? "url(#arrowhead)" : undefined} {...common} />;
  return <path d={smooth(d.points)} {...common} />;
}

function boundingBox(ds: Drawing[]): { x: number; y: number; w: number; h: number } | null {
  if (!ds.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const d of ds) for (const [x, y] of d.points) { if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; }
  const pad = 6;
  return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
}

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function simplify(pts: Pt[], tol = 1.2): Pt[] { const out: Pt[] = [pts[0]!]; for (const p of pts) if (dist(out[out.length - 1]!, p) >= tol) out.push(p); return out; }
function smooth(p: Pt[]): string {
  if (p.length < 3) return `M${p[0]![0]},${p[0]![1]} L${p[p.length - 1]![0]},${p[p.length - 1]![1]}`;
  let d = `M${p[0]![0]},${p[0]![1]}`;
  for (let i = 1; i < p.length - 1; i++) { const m: Pt = [(p[i]![0] + p[i + 1]![0]) / 2, (p[i]![1] + p[i + 1]![1]) / 2]; d += ` Q${p[i]![0]},${p[i]![1]} ${m[0]},${m[1]}`; }
  d += ` L${p[p.length - 1]![0]},${p[p.length - 1]![1]}`; return d;
}
