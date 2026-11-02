import { describe, expect, it } from "vitest";
import { connectionsWithin, placeGeometries } from "./index.js";

describe("partituras (#71)", () => {
  it("placeGeometries move o arranjo para o ponto preservando posições relativas", () => {
    const m = placeGeometries([{ key: "a", geometry: { x: 100, y: 50, w: 200, h: 100 } }, { key: "b", geometry: { x: 400, y: 80, w: 200, h: 100 } }], { x: 10, y: 20 });
    expect(m.get("a")).toMatchObject({ x: 10, y: 20 }); expect(m.get("b")).toMatchObject({ x: 310, y: 50 });
    expect(placeGeometries([], { x: 0, y: 0 }).size).toBe(0);
  });
  it("connectionsWithin só mantém conexões com as duas pontas no conjunto", () => {
    const c = [{ sourceNodeId: "a", targetNodeId: "b" }, { sourceNodeId: "b", targetNodeId: "z" }];
    expect(connectionsWithin(c, new Set(["a", "b"]))).toEqual([c[0]]);
  });
});
