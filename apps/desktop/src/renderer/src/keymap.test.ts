import { describe, expect, it } from "vitest";
import { ACTIONS, comboFromEvent, conflicts, effectiveCombo, formatCombo, matchAction, normalizeKey, parseCombo, parseKeymap, sameCombo } from "./keymap.js";

const ev = (key: string, m: { c?: boolean; s?: boolean; a?: boolean; meta?: boolean } = {}) => ({ key, ctrlKey: !!m.c, metaKey: !!m.meta, shiftKey: !!m.s, altKey: !!m.a });

describe("keymap (#58)", () => {
  it("catálogo: ids únicos e sem conflito nos padrões", () => {
    expect(new Set(ACTIONS.map((a) => a.id)).size).toBe(ACTIONS.length);
    expect(conflicts({})).toEqual({});
  });
  it("normalizeKey/comboFromEvent: Shift não muda a identidade da tecla; Meta conta como Ctrl", () => {
    expect(normalizeKey("P")).toBe("p"); expect(normalizeKey("+")).toBe("="); expect(normalizeKey("|")).toBe("\\"); expect(normalizeKey("ArrowUp")).toBe("arrowup"); expect(normalizeKey(" ")).toBe("space");
    expect(comboFromEvent(ev("P", { c: true, s: true }))).toEqual({ key: "p", ctrl: true, shift: true, alt: false });
    expect(comboFromEvent(ev("=", { meta: true }))).toEqual({ key: "=", ctrl: true, shift: false, alt: false });
  });
  it("parseCombo/formatCombo são inversos nos casos usuais; inválidos dão null", () => {
    for (const s of ["Ctrl+Shift+P", "Ctrl+↑", "Ctrl+Alt+→", "V", "Ctrl+\\", "Ctrl+,", "Esc"]) expect(formatCombo(parseCombo(s))).toBe(s);
    expect(parseCombo("")).toBeNull(); expect(parseCombo("Ctrl+")).toBeNull(); expect(parseCombo("Ctrl+A+B")).toBeNull();
    expect(parseCombo("cmd+shift+n")).toEqual({ key: "n", ctrl: true, shift: true, alt: false });
  });
  it("matchAction: padrões; whileTyping filtra ao digitar; override e limpeza valem; modificador sozinho não casa", () => {
    expect(matchAction(ev("m", { c: true, s: true }), {}, false)).toBe("minimap.toggle");
    expect(matchAction(ev("M", { c: true, s: true }), {}, true)).toBe("minimap.toggle"); // vale digitando
    expect(matchAction(ev("b", { c: true }), {}, false)).toBe("sidebar.toggle");
    expect(matchAction(ev("b", { c: true }), {}, true)).toBeNull(); // no terminal, Ctrl+B é do tmux
    expect(matchAction(ev("t"), {}, false)).toBe("tool.terminal");
    expect(matchAction(ev("t"), {}, true)).toBeNull();
    expect(matchAction(ev("Control", { c: true }), {}, false)).toBeNull();
    const km = { "minimap.toggle": { key: "y", ctrl: true, shift: true, alt: false }, "zoom.in": null };
    expect(matchAction(ev("y", { c: true, s: true }), km, false)).toBe("minimap.toggle");
    expect(matchAction(ev("m", { c: true, s: true }), km, false)).toBeNull(); // o antigo deixou de valer
    expect(matchAction(ev("=", { c: true }), km, false)).toBeNull(); // limpo
    expect(effectiveCombo("zoom.out", km)).toEqual({ key: "-", ctrl: true, shift: false, alt: false });
  });
  it("parseKeymap tolerante: ids desconhecidos e valores inválidos caem; null preservado; conflitos detectados", () => {
    const km = parseKeymap(JSON.stringify({ "note.new": { key: "T", ctrl: true, shift: false, alt: false }, "zoom.in": null, "nao.existe": { key: "x", ctrl: true, shift: false, alt: false }, "zoom.out": { key: 1 } }));
    expect(Object.keys(km).sort()).toEqual(["note.new", "zoom.in"]);
    expect(km["note.new"]!.key).toBe("t");
    expect(parseKeymap("{lixo")).toEqual({}); expect(parseKeymap("[1]")).toEqual({}); expect(parseKeymap(null)).toEqual({});
    const c = conflicts(km); // note.new agora é Ctrl+T, igual a terminal.new
    expect(c["note.new"]).toEqual(["terminal.new"]); expect(c["terminal.new"]).toEqual(["note.new"]);
    expect(sameCombo(null, null)).toBe(false);
  });
});
