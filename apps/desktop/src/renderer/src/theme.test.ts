import { describe, expect, it } from "vitest";
import { nextTheme, parseThemePref, resolveTheme, THEME_KEY } from "./theme.js";

describe("tema (#54) — lógica pura", () => {
  it("resolve: Sistema segue o SO; Claro/Escuro ignoram o SO", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
  it("ciclo do botão: Sistema → Claro → Escuro → Sistema", () => {
    expect(nextTheme("system")).toBe("light");
    expect(nextTheme("light")).toBe("dark");
    expect(nextTheme("dark")).toBe("system");
  });
  it("valor salvo inválido/ausente vira Sistema (nunca quebra o boot)", () => {
    expect(parseThemePref(null)).toBe("system");
    expect(parseThemePref(undefined)).toBe("system");
    expect(parseThemePref("neon")).toBe("system");
    expect(parseThemePref(42)).toBe("system");
    expect(parseThemePref("light")).toBe("light");
    expect(parseThemePref("dark")).toBe("dark");
  });
  it("chave de storage é estável (migrações dependem dela)", () => {
    expect(THEME_KEY).toBe("mess.theme");
  });
});
