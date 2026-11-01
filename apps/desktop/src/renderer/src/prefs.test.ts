import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetPrefsForTests, DEFAULTS, getPref, onPrefs, parsePrefs, PREFS_KEY, setPref } from "./prefs.js";

// localStorage mínimo para o ambiente node do vitest.
function fakeStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, String(v)); }, removeItem: (k: string) => { m.delete(k); }, clear: () => m.clear(), key: () => null, get length() { return m.size; } } as unknown as Storage;
}

describe("parsePrefs (#64)", () => {
  it("vazio/lixo/array → padrões", () => {
    expect(parsePrefs(null)).toEqual(DEFAULTS);
    expect(parsePrefs("")).toEqual(DEFAULTS);
    expect(parsePrefs("{não é json")).toEqual(DEFAULTS);
    expect(parsePrefs("[1,2]")).toEqual(DEFAULTS);
    expect(parsePrefs("42")).toEqual(DEFAULTS);
  });
  it("mescla com padrões; descarta chave desconhecida e tipo errado", () => {
    const p = parsePrefs(JSON.stringify({ prefsTab: "terminal", chaveVelha: true, outra: 1 }));
    expect(p.prefsTab).toBe("terminal");
    expect("chaveVelha" in p).toBe(false);
    expect(parsePrefs(JSON.stringify({ prefsTab: 7 })).prefsTab).toBe(DEFAULTS.prefsTab); // número onde é string: padrão
  });
});

describe("store de preferências", () => {
  beforeEach(() => { vi.stubGlobal("localStorage", fakeStorage()); _resetPrefsForTests(); });
  afterEach(() => { vi.unstubAllGlobals(); _resetPrefsForTests(); });
  it("setPref persiste no localStorage, notifica ouvintes e sobrevive a um reload (cache zerado)", () => {
    let n = 0; const off = onPrefs(() => { n++; });
    expect(getPref("prefsTab")).toBe("general");
    setPref("prefsTab", "about");
    expect(n).toBe(1);
    expect(JSON.parse(localStorage.getItem(PREFS_KEY)!)).toEqual({ ...DEFAULTS, prefsTab: "about" });
    _resetPrefsForTests(); // "reload": relê do storage
    expect(getPref("prefsTab")).toBe("about");
    off(); setPref("prefsTab", "data"); expect(n).toBe(1); // ouvinte removido não é chamado
  });
  it("sem localStorage (lança) continua funcionando só em memória", () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } });
    _resetPrefsForTests();
    expect(getPref("prefsTab")).toBe("general");
    setPref("prefsTab", "agents");
    expect(getPref("prefsTab")).toBe("agents");
  });
});
