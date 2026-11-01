import { describe, expect, it } from "vitest";
import { clampFontSize, clampPad, clampScrollback, DARK_PALETTE, DEFAULT_CUSTOM, DEFAULT_FONT_STACK, effectiveScrollback, fontStack, LIGHT_PALETTE, parseCustomPalette, resolveTermTheme, SCROLLBACK_UNLIMITED } from "./term-theme.js";

const SYS = { background: "#111111", foreground: "#EEEEEE", cursor: "#00FF00", selectionBackground: "rgba(0,255,0,.3)" };

describe("tema do terminal (#56)", () => {
  it("resolveTermTheme: nó vence o global; system usa os tokens do app; custom traz brights", () => {
    expect(resolveTermTheme(undefined, "system", DEFAULT_CUSTOM, SYS)).toBe(SYS);
    expect(resolveTermTheme("system", "dark", DEFAULT_CUSTOM, SYS)).toBe(DARK_PALETTE); // "system" no nó = herda o global
    expect(resolveTermTheme("light", "dark", DEFAULT_CUSTOM, SYS)).toBe(LIGHT_PALETTE); // nó vence
    expect(resolveTermTheme(undefined, "light", DEFAULT_CUSTOM, SYS)).toBe(LIGHT_PALETTE);
    const c = resolveTermTheme("custom", "system", DEFAULT_CUSTOM, SYS) as Record<string, string>;
    expect(c["background"]).toBe(DEFAULT_CUSTOM.background); expect(c["brightRed"]).toBe(DEFAULT_CUSTOM.red);
  });
  it("parseCustomPalette: tolerante — lixo e cores inválidas caem no padrão, válidas entram", () => {
    expect(parseCustomPalette(null)).toEqual(DEFAULT_CUSTOM);
    expect(parseCustomPalette("{nope")).toEqual(DEFAULT_CUSTOM);
    expect(parseCustomPalette("[1]")).toEqual(DEFAULT_CUSTOM);
    const p = parseCustomPalette(JSON.stringify({ background: "#000000", red: "vermelho", cursor: " rgba(1,2,3,.5) ", extra: "#FFFFFF" }));
    expect(p.background).toBe("#000000"); expect(p.red).toBe(DEFAULT_CUSTOM.red); expect(p.cursor).toBe("rgba(1,2,3,.5)");
    expect("extra" in p).toBe(false);
  });
  it("fontStack e limites", () => {
    expect(fontStack("")).toBe(DEFAULT_FONT_STACK);
    expect(fontStack(' Fira "Code" ')).toBe(`"Fira Code", ${DEFAULT_FONT_STACK}`);
    expect(clampFontSize(3)).toBe(9); expect(clampFontSize(99)).toBe(28); expect(clampFontSize(Number.NaN)).toBe(14); expect(clampFontSize(13.6)).toBe(14);
    expect(clampPad(-5)).toBe(0); expect(clampPad(100)).toBe(32);
    expect(clampScrollback(10)).toBe(200); expect(clampScrollback(1e9)).toBe(100_000);
    expect(effectiveScrollback(true, 3000)).toBe(3000); expect(effectiveScrollback(false, 3000)).toBe(SCROLLBACK_UNLIMITED);
  });
});
