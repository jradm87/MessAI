import { describe, expect, it } from "vitest";
import { MESSAGES, resolveLocale, t } from "./i18n.js";

describe("i18n (#51)", () => {
  it("resolveLocale usa pt-BR para system/pt-BR e en-US para en-US", () => {
    expect(resolveLocale("system")).toBe("pt-BR");
    expect(resolveLocale("pt-BR")).toBe("pt-BR");
    expect(resolveLocale("en-US")).toBe("en-US");
    expect(resolveLocale(undefined)).toBe("pt-BR");
  });

  it("t() traduz chaves em pt-BR e en-US com paridade de dicionário", () => {
    expect(t("prefs.title", "pt-BR")).toBe("Preferências");
    expect(t("prefs.title", "en-US")).toBe("Preferences");
    expect(t("app.add", "pt-BR")).toBe("+ Adicionar");
    expect(t("app.add", "en-US")).toBe("+ Add");
    expect(Object.keys(MESSAGES["pt-BR"]).sort()).toEqual(Object.keys(MESSAGES["en-US"]).sort());
  });
});
