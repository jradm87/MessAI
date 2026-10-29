import { useEffect, useRef, useState } from "react";
import { ViewportPortal, useReactFlow } from "@xyflow/react";
import type { Drawing } from "@messai/contracts";
import type { DrawStyle, Tool } from "./Toolbar.js";

type Pt = [number, number];
export type CreateRect = { x: number; y: number; w: number; h: number };

/**
 * Camada que (1) desenha os traços persistidos no espaço do canvas e
 * (2) captura o mouse quando a ferramenta não é seleção: desenhar traços ou arrastar retângulo para criar nó.
 */
export function DrawingLayer({ tool, style, drawings, onDraw, onErase, onCreateRect }: {
  tool: Tool; style: DrawStyle; drawings: Drawing[];
  onDraw: (d: { kind: Exclude<DrawStyle["kind"], "erase">; points: Pt[]; color: string; width: number }) => void;
  onErase: (drawingId: string) => void;
  onCreateRect: (kind: "terminal" | "note" | "text" | "tree", rect: CreateRect) => void;
}) {
  const rf = useReactFlow();
  const [live, setLive] = useState<Pt[] | null>(null);
  const [rect, setRect] = useState<CreateRect | null>(null);
  const start = useRef<Pt | null>(null);
  const capturing = tool === "draw" || tool === "terminal" || tool === "note" || tool === "text" || tool === "tree";

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

  return (
    <>
      <ViewportPortal>
        <svg className="drawings" style={{ overflow: "visible", position: "absolute", left: 0, top: 0, width: 1, height: 1, pointerEvents: "none" }}>
          <defs><marker id="arrowhead" markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L4,2 L0,4 z" fill="context-stroke" /></marker></defs>
          {drawings.map((d) => <Stroke key={d.drawingId} d={d} erasable={tool === "draw" && style.kind === "erase"} onErase={() => onErase(d.drawingId)} />)}
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

function Stroke({ d, erasable, onErase }: { d: Drawing; erasable?: boolean; onErase?: () => void }) {
  const common = { stroke: d.color, strokeWidth: d.width, fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const, style: { pointerEvents: erasable ? ("stroke" as const) : ("none" as const), cursor: erasable ? "cell" : undefined }, onMouseDown: erasable ? (e: React.MouseEvent) => { e.stopPropagation(); onErase?.(); } : undefined };
  const [a, b] = [d.points[0]!, d.points[d.points.length - 1]!];
  if (d.kind === "rect") return <rect x={Math.min(a[0], b[0])} y={Math.min(a[1], b[1])} width={Math.abs(b[0] - a[0])} height={Math.abs(b[1] - a[1])} rx={d.width} {...common} />;
  if (d.kind === "line" || d.kind === "arrow") return <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} markerEnd={d.kind === "arrow" ? "url(#arrowhead)" : undefined} {...common} />;
  return <path d={smooth(d.points)} {...common} />;
}

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function simplify(pts: Pt[], tol = 1.2): Pt[] { const out: Pt[] = [pts[0]!]; for (const p of pts) if (dist(out[out.length - 1]!, p) >= tol) out.push(p); return out; }
function smooth(p: Pt[]): string {
  if (p.length < 3) return `M${p[0]![0]},${p[0]![1]} L${p[p.length - 1]![0]},${p[p.length - 1]![1]}`;
  let d = `M${p[0]![0]},${p[0]![1]}`;
  for (let i = 1; i < p.length - 1; i++) { const m: Pt = [(p[i]![0] + p[i + 1]![0]) / 2, (p[i]![1] + p[i + 1]![1]) / 2]; d += ` Q${p[i]![0]},${p[i]![1]} ${m[0]},${m[1]}`; }
  d += ` L${p[p.length - 1]![0]},${p[p.length - 1]![1]}`; return d;
}
