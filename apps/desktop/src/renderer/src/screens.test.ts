import { describe, expect, it } from "vitest";
import { fitViewport, homeSeg, paneTarget, segAt, zoneInsets, type Seg } from "./screens.js";

// dois monitores de 1920 lado a lado; o principal é o da direita
const L: Seg = { x: 0, y: 0, width: 1920, height: 1040 };
const R: Seg = { x: 1920, y: 0, width: 1920, height: 1040, primary: true };
const pane = { x: 240, y: 32, w: 3600, h: 1008 }; // painel do canvas (descontada a barra lateral e a de título)

describe("telas da janela esticada", () => {
  it("um monitor só: sem segmento, painel inteiro", () => {
    expect(homeSeg([L], "left")).toBeNull();
    expect(segAt([L], { x: 10, y: 10 })).toBeNull();
    expect(paneTarget(pane, null)).toEqual({ x: 0, y: 0, w: 3600, h: 1008 });
  });
  it("controles: esquerdo por padrão, principal quando pedido", () => {
    expect(homeSeg([R, L], "left")).toBe(L);
    expect(homeSeg([L, R], "primary")).toBe(R);
    expect(homeSeg([L, { ...R, primary: false }], "primary")).toBe(L); // principal fora da janela: volta ao esquerdo
  });
  it("monitor sob o ponto, ou o mais próximo", () => {
    expect(segAt([L, R], { x: 2500, y: 300 })).toBe(R);
    expect(segAt([L, R], { x: 100, y: 300 })).toBe(L);
    expect(segAt([L, R], { x: 4000, y: 300 })).toBe(R);
  });
  it("recorte do painel no monitor e recuos dos controles", () => {
    expect(paneTarget(pane, L)).toEqual({ x: 0, y: 0, w: 1680, h: 1008 });
    expect(paneTarget(pane, R)).toEqual({ x: 1680, y: 0, w: 1920, h: 1008 });
    expect(zoneInsets(pane, L)).toEqual({ l: 0, r: 1920 });
    expect(zoneInsets(pane, R)).toEqual({ l: 1680, r: 0 });
  });
  it("enquadra o nó no centro do retângulo alvo", () => {
    const v = fitViewport({ x: 100, y: 100, w: 400, h: 200 }, { x: 1680, y: 0, w: 1920, h: 1008 }, 0, 0.1, 2);
    expect(v.zoom).toBe(2); // limitado pelo máximo
    expect(300 * v.zoom + v.x).toBe(1680 + 960); // centro do nó cai no centro do monitor direito
    expect(200 * v.zoom + v.y).toBe(504);
  });
});
