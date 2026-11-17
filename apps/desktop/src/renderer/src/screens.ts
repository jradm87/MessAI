import { atom } from "jotai";

/**
 * Janela esticada em vários monitores: cada monitor é um "segmento" da janela (coordenadas do cliente, px CSS).
 * O zoom/centralizar acontece no monitor onde o item está, e os controles flutuantes (paleta de cima, barra de baixo,
 * minimapa, barra de seleção) ficam num monitor só, nunca atravessando a divisa entre as telas.
 */
export type Seg = { x: number; y: number; width: number; height: number; primary?: boolean };
export type Box = { x: number; y: number; w: number; h: number };
export type UiScreen = "left" | "primary";

const KEY = "mess.uiScreen";
const load = (): UiScreen => { try { return localStorage.getItem(KEY) === "primary" ? "primary" : "left"; } catch { return "left"; } };
const base = atom<UiScreen>(load());
/** Monitor dos controles: esquerdo (padrão) ou o principal do Windows. Lembrado só nesta máquina. */
export const uiScreenAtom = atom((g) => g(base), (_g, s, v: UiScreen) => { s(base, v); try { localStorage.setItem(KEY, v); } catch { /* sem storage */ } });
/** Monitores que a janela cobre (vem do processo principal junto com o estado da janela). */
export const segsAtom = atom<Seg[]>([]);

/** Monitor que recebe os controles: o mais à esquerda, ou o principal se pedido (e se a janela estiver nele). */
export function homeSeg(segs: Seg[], pref: UiScreen): Seg | null {
  if (segs.length < 2) return null;
  if (pref === "primary") { const p = segs.find((s) => s.primary); if (p) return p; }
  return [...segs].sort((a, b) => a.x - b.x || a.y - b.y)[0]!;
}

/** Monitor sob o ponto; fora de todos, o mais próximo. */
export function segAt(segs: Seg[], pt: { x: number; y: number }): Seg | null {
  if (segs.length < 2) return null;
  const dist = (s: Seg) => Math.hypot(Math.max(s.x - pt.x, 0, pt.x - (s.x + s.width)), Math.max(s.y - pt.y, 0, pt.y - (s.y + s.height)));
  return [...segs].sort((a, b) => dist(a) - dist(b))[0]!;
}

/** Parte do painel (retângulo do cliente) que cai no monitor, em coordenadas locais do painel. Sem monitor: o painel todo. */
export function paneTarget(pane: Box, seg: Seg | null): Box {
  if (!seg) return { x: 0, y: 0, w: pane.w, h: pane.h };
  const x0 = Math.max(pane.x, seg.x), y0 = Math.max(pane.y, seg.y);
  const x1 = Math.min(pane.x + pane.w, seg.x + seg.width), y1 = Math.min(pane.y + pane.h, seg.y + seg.height);
  if (x1 - x0 < 50 || y1 - y0 < 50) return { x: 0, y: 0, w: pane.w, h: pane.h };
  return { x: x0 - pane.x, y: y0 - pane.y, w: x1 - x0, h: y1 - y0 };
}

/** Recuo esquerdo/direito (px) do painel para os controles ficarem só no monitor escolhido. */
export function zoneInsets(pane: Box, seg: Seg | null): { l: number; r: number } {
  const t = paneTarget(pane, seg);
  return { l: Math.round(t.x), r: Math.round(pane.w - t.x - t.w) };
}

/** Viewport que enquadra `b` (coordenadas do fluxo) no retângulo `t` do painel, com folga `pad` (fração). */
export function fitViewport(b: Box, t: Box, pad: number, minZoom: number, maxZoom: number): { x: number; y: number; zoom: number } {
  const w = Math.max(b.w, 1) * (1 + 2 * pad), h = Math.max(b.h, 1) * (1 + 2 * pad);
  const zoom = Math.min(maxZoom, Math.max(minZoom, Math.min(t.w / w, t.h / h)));
  return { x: t.x + t.w / 2 - (b.x + b.w / 2) * zoom, y: t.y + t.h / 2 - (b.y + b.h / 2) * zoom, zoom };
}
