import { describe, expect, it } from "vitest";
import type { Band } from "@messai/contracts";
import { bandColor, bandsOfNode, BAND_COLORS } from "./bands.js";

const mk = (id: string, name: string, nodeIds: string[], extra: Partial<Band> = {}): Band => ({ bandId: id, workspaceId: "w", name, color: "", nodeIds, asking: [], createdAt: "", ...extra });

describe("bandas (#70)", () => {
  it("cor escolhida vence; senão paleta pela posição, com volta", () => {
    expect(bandColor({ color: "#123456" }, 3)).toBe("#123456");
    expect(bandColor({ color: "" }, 1)).toBe(BAND_COLORS[1]);
    expect(bandColor({ color: "" }, BAND_COLORS.length)).toBe(BAND_COLORS[0]);
  });
  it("bandas de um nó: só as dele, com cor e estado 'perguntando'", () => {
    const bs = [mk("b1", "Dev", ["a", "b"]), mk("b2", "Rev", ["b"], { asking: ["b"], color: "#fff" })];
    expect(bandsOfNode(bs, "a")).toEqual([{ id: "b1", name: "Dev", color: BAND_COLORS[0], asking: false }]);
    expect(bandsOfNode(bs, "b")).toEqual([{ id: "b1", name: "Dev", color: BAND_COLORS[0], asking: false }, { id: "b2", name: "Rev", color: "#fff", asking: true }]);
    expect(bandsOfNode(bs, "zzz")).toEqual([]);
    expect(bandsOfNode(undefined, "a")).toEqual([]);
  });
});
