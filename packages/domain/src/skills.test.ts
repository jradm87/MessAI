import { describe, expect, it } from "vitest";
import { applyRole, applySkills, roleText, skillsText } from "./index.js";

const S = [{ name: "Revisão", instructions: " Revise com rigor. " }, { name: "Testes", instructions: "Sempre rode os testes." }];

describe("skills (#57)", () => {
  it("skillsText: cabeçalho + uma seção por habilidade; vazio sem habilidades", () => {
    expect(skillsText([])).toBe("");
    const t = skillsText(S);
    expect(t.startsWith("Habilidades anexadas a este terminal:")).toBe(true);
    expect(t).toContain("## Revisão\nRevise com rigor.");
    expect(t).toContain("## Testes\nSempre rode os testes.");
  });
  it("applySkills: só claude; acumula no --append-system-prompt existente (depois do papel); outras CLIs intocadas", () => {
    expect(applySkills("codex", ["-m", "x"], S)).toEqual(["-m", "x"]);
    expect(applySkills("claude", ["a"], [])).toEqual(["a"]);
    expect(applySkills("/usr/bin/claude", [], S)).toEqual(["--append-system-prompt", skillsText(S)]);
    const role = { name: "Revisor", instructions: "Revise." };
    const out = applySkills("claude", applyRole("claude", ["--append-system-prompt", "base"], role), S);
    expect(out).toHaveLength(2);
    expect(out[1]).toBe(`base\n\n${roleText(role)}\n\n${skillsText(S)}`);
  });
});
