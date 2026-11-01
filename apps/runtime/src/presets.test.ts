import { describe, expect, it } from "vitest";
import { defaultPresets, MAX_PRESETS, parsePresets, validatePresets } from "./presets.js";

const D = defaultPresets("/bin/sh");

describe("presets (#56)", () => {
  it("padrões: shell usa o shell padrão; claude leva a dica do MessAI; todos habilitados", () => {
    expect(D[0]).toMatchObject({ id: "shell", command: "/bin/sh", enabled: true, target: "terminal", theme: "system" });
    expect(D.find((p) => p.id === "claude")!.args[0]).toBe("--append-system-prompt");
    expect(D.find((p) => p.id === "antigravity")!.command).toBe("agy");
  });
  it("validatePresets: id duplicado, comando vazio e excesso são inválidos", () => {
    expect(validatePresets(D).ok).toBe(true);
    expect(validatePresets([D[0]!, { ...D[1]!, id: "shell" }]).ok).toBe(false);
    expect(validatePresets([{ ...D[0]!, command: "   " }]).ok).toBe(false);
    expect(validatePresets(Array.from({ length: MAX_PRESETS + 1 }, (_, i) => ({ ...D[0]!, id: `p${i}` }))).ok).toBe(false);
    expect(validatePresets([]).ok).toBe(true); // lista vazia é permitida (Restaurar padrões resolve)
  });
  it("parsePresets: ausente/lixo/parcialmente inválido → padrões; válido → o que foi salvo", () => {
    expect(parsePresets(undefined, D)).toBe(D);
    expect(parsePresets("{nope", D)).toBe(D);
    expect(parsePresets(JSON.stringify({ a: 1 }), D)).toBe(D);
    expect(parsePresets(JSON.stringify([D[0], { id: "x" }]), D)).toBe(D); // um item sem os campos obrigatórios invalida tudo
    const custom = [{ ...D[0]!, id: "meu", label: "Meu shell", color: "#ef5350", icon: "rocket" }];
    expect(parsePresets(JSON.stringify(custom), D)).toEqual(custom);
    expect(parsePresets(JSON.stringify([D[0], { ...D[1], id: "shell" }]), D)).toBe(D); // duplicado salvo à mão: padrões
  });
});
