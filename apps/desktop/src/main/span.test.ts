import { describe, expect, it } from "vitest";
import { nearRect, uncoveredArea, unionRect } from "./span.js";

describe("esticar em todas as telas", () => {
  it("dois monitores lado a lado: une as áreas úteis", () => {
    const a = { x: 0, y: 0, width: 1920, height: 1040 };
    const b = { x: 1920, y: 0, width: 1920, height: 1040 };
    expect(unionRect([a, b])).toEqual({ x: 0, y: 0, width: 3840, height: 1040 });
    expect(uncoveredArea([a, b])).toBe(0);
  });

  it("monitor secundário à esquerda (x negativo) e mais alto: cobre tudo e acusa a sobra", () => {
    const main = { x: 0, y: 0, width: 1920, height: 1040 };
    const left = { x: -1280, y: -200, width: 1280, height: 1024 };
    expect(unionRect([main, left])).toEqual({ x: -1280, y: -200, width: 3200, height: 1240 });
    expect(uncoveredArea([main, left])).toBeGreaterThan(0);
  });

  it("um monitor ou nenhum", () => {
    const one = { x: 0, y: 0, width: 1920, height: 1040 };
    expect(unionRect([one])).toEqual(one);
    expect(unionRect([])).toBeNull();
    expect(uncoveredArea([])).toBe(0);
  });

  it("compara com tolerância de arredondamento de DPI", () => {
    const r = { x: 0, y: 0, width: 3840, height: 1040 };
    expect(nearRect({ x: -7, y: 0, width: 3854, height: 1047 }, r)).toBe(true);
    expect(nearRect({ x: 0, y: 0, width: 1920, height: 1040 }, r)).toBe(false);
  });
});
