import { describe, expect, it } from "vitest";
import { groupBounds, snapGeometry } from "./index.js";

describe("grupos de nós e encaixe magnético (#78)", () => {
  it("groupBounds envolve tudo com folga; vazio → null", () => {
    expect(groupBounds([])).toBeNull();
    expect(groupBounds([{ x: 10, y: 20, w: 100, h: 50 }, { x: 200, y: 0, w: 50, h: 300 }], 10)).toEqual({ x: 0, y: -10, w: 260, h: 320 });
  });
  it("snapGeometry: encaixa borda esquerda com borda direita do vizinho, topo com topo, centro com centro; fora do limiar não mexe", () => {
    const other = { x: 100, y: 100, w: 200, h: 100 };
    // borda esquerda (x=305) perto da borda direita do vizinho (300) → x=300, guia vertical em 300
    expect(snapGeometry({ x: 305, y: 400, w: 50, h: 50 }, [other])).toMatchObject({ x: 300, y: 400, guides: { vertical: [300], horizontal: [] } });
    // topo (y=103) perto do topo do vizinho (100)
    expect(snapGeometry({ x: 500, y: 103, w: 50, h: 50 }, [other]).y).toBe(100);
    // centro vertical: vizinho centro y=150; movendo com h=50 em y=128 → centro 153 → 150 → y=125
    expect(snapGeometry({ x: 500, y: 128, w: 50, h: 50 }, [other]).y).toBe(125);
    // longe: nada
    expect(snapGeometry({ x: 700, y: 700, w: 50, h: 50 }, [other])).toMatchObject({ x: 700, y: 700, guides: { vertical: [], horizontal: [] } });
    // o candidato mais próximo vence
    expect(snapGeometry({ x: 102, y: 500, w: 50, h: 50 }, [other, { x: 95, y: 0, w: 10, h: 10 }]).x).toBe(100);
  });
  it("grade: sem vizinho perto, encaixa na grade quando pedido", () => {
    expect(snapGeometry({ x: 101, y: 46, w: 10, h: 10 }, [], { grid: 48 })).toMatchObject({ x: 96, y: 48 });
    expect(snapGeometry({ x: 120, y: 120, w: 10, h: 10 }, [], { grid: 48 })).toMatchObject({ x: 120, y: 120 }); // 120 está a 24 da grade: fora do limiar
    expect(snapGeometry({ x: 101, y: 46, w: 10, h: 10 }, [])).toMatchObject({ x: 101, y: 46 }); // sem grade e sem vizinhos: nada
  });
});
