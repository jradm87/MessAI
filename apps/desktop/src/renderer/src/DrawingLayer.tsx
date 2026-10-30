import { useEffect, useRef, useState } from "react";
import { ViewportPortal, useReactFlow, useStore } from "@xyflow/react";
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
  // pointer capture no hit da caixa: o React Flow (que também ouve o ponteiro no pane) não rouba o arrasto.
  const dragRef = useRef<{ startX: number; startY: number; orig: Map<string, Pt[]> } | null>(null);
  const [off, setOff] = useState<Pt>([0, 0]);
  // override otimista: ao soltar, mostra os pontos novos na hora; some quando o snapshot chega (sem piscar).
  const [override, setOverride] = useState<Map<string, Pt[]> | null>(null);
  useEffect(() => { setOverride(null); }, [drawings]);
  const hitDown = (e: React.PointerEvent, id: string) => {
    if (!selectMode || e.button !== 0) return;
    e.stopPropagation();
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* sem captura */ }
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    const dd = drawings.find((x) => x.drawingId === id); // grupo inteiro move junto
    const grp = dd?.groupId ? drawings.filter((x) => x.groupId === dd.groupId).map((x) => x.drawingId) : [id];
    if (!selected.has(id) || additive) onSelect(id, additive);
    const ids = additive ? [...new Set([...selected, ...grp])] : selected.has(id) ? [...selected] : grp;
    const orig = new Map<string, Pt[]>();
    for (const did of ids) { const dd = drawings.find((x) => x.drawingId === did); if (dd) orig.set(did, override?.get(did) ?? dd.points); }
    const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    dragRef.current = { startX: p.x, startY: p.y, orig }; setOff([0, 0]);
  };
  const hitMove = (e: React.PointerEvent) => { const d = dragRef.current; if (!d) return; const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }); setOff([p.x - d.startX, p.y - d.startY]); };
  const hitUp = (e: React.PointerEvent) => {
    const d = dragRef.current; if (!d) return; dragRef.current = null;
    const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const dx = p.x - d.startX, dy = p.y - d.startY;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) { setOff([0, 0]); return; } // só clique, não moveu
    const moved = new Map<string, Pt[]>();
    for (const [id, pts] of d.orig) moved.set(id, pts.map(([x, y]) => [x + dx, y + dy] as Pt));
    setOverride(moved); setOff([0, 0]); // pontos novos já na tela; o patch confirma e o snapshot limpa o override
    for (const [id, pts] of moved) onMovePoints(id, pts);
  };
  const eraseDown = (e: React.MouseEvent, id: string) => { e.stopPropagation(); onErase(id); };

  const eff = (d: Drawing): Drawing => { const p = override?.get(d.drawingId); return p ? { ...d, points: p } : d; };
  const box = selected.size ? boundingBox(drawings.filter((d) => selected.has(d.drawingId)).map(eff)) : null;

  // redimensionar por alças: escala os pontos dos selecionados dentro da caixa.
  const zoom = useStore((s) => s.transform[2]);
  const resizeRef = useRef<{ h: string; box: { x: number; y: number; w: number; h: number }; orig: Map<string, Pt[]> } | null>(null);
  const handleDown = (e: React.PointerEvent, h: string) => {
    if (!box) return; e.stopPropagation();
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* sem captura */ }
    const orig = new Map<string, Pt[]>();
    for (const d of drawings) if (selected.has(d.drawingId)) orig.set(d.drawingId, eff(d).points);
    resizeRef.current = { h, box, orig };
  };
  const handleMove = (e: React.PointerEvent) => { const r = resizeRef.current; if (!r) return; setOverride(scalePoints(r.box, r.h, rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }), r.orig)); };
  const handleUp = (e: React.PointerEvent) => {
    const r = resizeRef.current; if (!r) return; resizeRef.current = null;
    const scaled = scalePoints(r.box, r.h, rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }), r.orig);
    setOverride(scaled);
    for (const [id, pts] of scaled) onMovePoints(id, pts);
  };
  // alças (8): cantos + bordas, com tamanho constante na tela (hs) e cursor por direção.
  const hs = 9 / zoom;
  const handleDefs = box ? [
    ["nw", box.x, box.y, "nwse-resize"], ["n", box.x + box.w / 2, box.y, "ns-resize"], ["ne", box.x + box.w, box.y, "nesw-resize"],
    ["e", box.x + box.w, box.y + box.h / 2, "ew-resize"], ["se", box.x + box.w, box.y + box.h, "nwse-resize"],
    ["s", box.x + box.w / 2, box.y + box.h, "ns-resize"], ["sw", box.x, box.y + box.h, "nesw-resize"], ["w", box.x, box.y + box.h / 2, "ew-resize"],
  ] as const : [];
  const showHandles = selectMode && box && off[0] === 0 && off[1] === 0; // esconde durante o arrasto de mover

  return (
    <>
      <ViewportPortal>
        <svg className="drawings" style={{ overflow: "visible", position: "absolute", left: 0, top: 0, width: 1, height: 1, pointerEvents: "none" }}>
          <defs><marker id="arrowhead" markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L4,2 L0,4 z" fill="context-stroke" /></marker></defs>
          {drawings.map((d0) => {
            const d = eff(d0);
            const sel = selected.has(d.drawingId);
            const tf = sel && (off[0] !== 0 || off[1] !== 0) ? `translate(${off[0]} ${off[1]})` : undefined;
            const hit = selectMode ? boundingBox([d]) : null; // área clicável = a caixa inteira do objeto
            return (
              <g key={d.drawingId} transform={tf}>
                {sel && <Stroke d={d} highlight />}
                <Stroke d={d} {...(erasable ? { onDown: (e) => eraseDown(e, d.drawingId), cursor: "cell" } : {})} />
                {hit && <rect x={hit.x} y={hit.y} width={hit.w} height={hit.h} fill="transparent" style={{ pointerEvents: "all", cursor: "move" }}
                  onPointerDown={(e) => hitDown(e, d.drawingId)} onPointerMove={hitMove} onPointerUp={hitUp} />}
              </g>
            );
          })}
          {box && <rect x={box.x + off[0]} y={box.y + off[1]} width={box.w} height={box.h} fill="none" stroke="#5aa9ff" strokeDasharray="5 4" strokeWidth={1} vectorEffect="non-scaling-stroke" pointerEvents="none" />}
          {showHandles && handleDefs.map(([h, cx, cy, cur]) => (
            <rect key={h} x={cx - hs / 2} y={cy - hs / 2} width={hs} height={hs} fill="#0a0a0b" stroke="#5aa9ff" strokeWidth={1} vectorEffect="non-scaling-stroke"
              style={{ pointerEvents: "all", cursor: cur }} onPointerDown={(e) => handleDown(e, h)} onPointerMove={handleMove} onPointerUp={handleUp} />
          ))}
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

/** Escala os pontos dos desenhos conforme a alça arrastada, ancorando no lado oposto. */
function scalePoints(box: { x: number; y: number; w: number; h: number }, handle: string, p: { x: number; y: number }, orig: Map<string, Pt[]>): Map<string, Pt[]> {
  const { x, w, y, h } = box; const minX = x, minY = y, maxX = x + w, maxY = y + h;
  let sx = 1, sy = 1, ax = minX, ay = minY;
  if (handle.includes("e")) { ax = minX; sx = w > 0 ? (p.x - minX) / w : 1; }
  else if (handle.includes("w")) { ax = maxX; sx = w > 0 ? (maxX - p.x) / w : 1; }
  if (handle.includes("s")) { ay = minY; sy = h > 0 ? (p.y - minY) / h : 1; }
  else if (handle.includes("n")) { ay = maxY; sy = h > 0 ? (maxY - p.y) / h : 1; }
  sx = Math.max(sx, 0.02); sy = Math.max(sy, 0.02); // não inverter nem sumir
  const out = new Map<string, Pt[]>();
  for (const [id, pts] of orig) out.set(id, pts.map(([px, py]) => [ax + (px - ax) * sx, ay + (py - ay) * sy] as Pt));
  return out;
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
