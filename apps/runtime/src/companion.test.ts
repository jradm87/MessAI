import { describe, expect, it } from "vitest";
import { buildSummaryPrompt, parseSummary, screenTail } from "./companion.js";

describe("companheiro (#66) — funções puras", () => {
  it("parseSummary: JSON puro", () => {
    expect(parseSummary('{"summary":"Gerou o relatório.","nextStep":"Revisar os números."}')).toEqual({ summary: "Gerou o relatório.", nextStep: "Revisar os números." });
  });
  it("parseSummary: JSON em cerca de código e com lixo em volta", () => {
    expect(parseSummary('Claro! ```json\n{"summary":"Rodou os testes.","nextStep":"Corrigir 2 falhas."}\n```')).toEqual({ summary: "Rodou os testes.", nextStep: "Corrigir 2 falhas." });
    expect(parseSummary('blá {"summary": "Fez X", "nextStep": "Faça Y"} tchau')).toEqual({ summary: "Fez X", nextStep: "Faça Y" });
  });
  it("parseSummary: aceita chaves alternativas e normaliza espaços", () => {
    expect(parseSummary('{"resumo":"  a   b ","next_step":"c\\n d"}')).toEqual({ summary: "a b", nextStep: "c d" });
  });
  it("parseSummary: texto solto vira (1ª linha, 2ª linha); vazio/lixo vira null", () => {
    expect(parseSummary("- Terminou a migração\n- Agora rode o deploy")).toEqual({ summary: "Terminou a migração", nextStep: "Agora rode o deploy" });
    expect(parseSummary("")).toBeNull();
    expect(parseSummary("   \n  ")).toBeNull();
  });
  it("parseSummary: JSON sem summary não vale (cai no fallback de linhas, que ainda precisa de texto)", () => {
    expect(parseSummary('{"nextStep":"só isso"}')).toEqual({ summary: '{"nextStep":"só isso"}', nextStep: "" }); // fallback honesto: primeira linha
  });
  it("screenTail: corta para as últimas linhas, colapsa vazias e limita tamanho", () => {
    const many = Array.from({ length: 200 }, (_, i) => `linha ${i}`).join("\n\n\n");
    const t = screenTail(many);
    expect(t.split("\n").length).toBeLessThanOrEqual(60);
    expect(t.endsWith("linha 199")).toBe(true);
    expect(screenTail("x".repeat(10_000)).length).toBeLessThanOrEqual(6000);
  });
  it("buildSummaryPrompt: pede JSON pt-BR e inclui a tela recortada e o tipo do agente", () => {
    const p = buildSummaryPrompt({ agentType: "claudeCode", screen: "pronto: resultado-final-42\n" });
    expect(p).toContain("claudeCode"); expect(p).toContain("resultado-final-42"); expect(p).toContain('"summary"'); expect(p).toContain('"nextStep"'); expect(p).toContain("pt-BR");
  });
});
