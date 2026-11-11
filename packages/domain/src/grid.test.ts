import { describe, expect, it } from "vitest";
import { gridSpotNear } from "./index.js";

const A = { x: 100, y: 100, w: 400, h: 300 };
const place = (side: "below" | "right", n: number, size = { w: 200, h: 100 }) => {
  const nodes: { geometry: { x: number; y: number; w: number; h: number } }[] = [{ geometry: A }];
  for (let i = 0; i < n; i++) nodes.push({ geometry: gridSpotNear(A, nodes, size, { side }) });
  return nodes.slice(1).map((n) => [n.geometry.x, n.geometry.y]);
};

describe("gridSpotNear", () => {
  it("recrutas: 4 lado a lado abaixo do agente, o 5º na linha de baixo", () => {
    expect(place("below", 5)).toEqual([[100, 430], [330, 430], [560, 430], [790, 430], [100, 560]]);
  });
  it("notas: 4 lado a lado à direita do agente, depois a linha de baixo", () => {
    expect(place("right", 6)).toEqual([[530, 100], [760, 100], [990, 100], [1220, 100], [530, 230], [760, 230]]);
  });
  it("pula vagas ocupadas e usa a próxima livre perto", () => {
    const nodes = [{ geometry: A }, { geometry: { x: 300, y: 420, w: 300, h: 120 } }];
    expect(gridSpotNear(A, nodes, { w: 200, h: 100 }, { side: "below" })).toMatchObject({ x: 790, y: 430 });
  });
  it("nunca sobrepõe nada, mesmo com o canvas cheio", () => {
    const nodes = [{ geometry: A }];
    for (let i = 0; i < 30; i++) nodes.push({ geometry: { x: 80 + (i % 6) * 260, y: 380 + Math.floor(i / 6) * 150, w: 240, h: 130 } });
    const g = gridSpotNear(A, nodes, { w: 200, h: 100 }, { side: "below" });
    expect(nodes.some(({ geometry: o }) => g.x < o.x + o.w && g.x + g.w > o.x && g.y < o.y + o.h && g.y + g.h > o.y)).toBe(false);
  });
});
