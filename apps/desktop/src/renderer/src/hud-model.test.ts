import { describe, expect, it } from "vitest";
import { awaitingSummary, EMPTY_HUD, HUD_MAX, hudReduce, relTime, screenTail, type HudState } from "./hud-model.js";

const fin = (nodeId: string, at = "2026-11-01T12:00:00.000Z", workspaceId = "ws1") =>
  ({ type: "finished" as const, event: { sessionId: `s-${nodeId}`, nodeId, workspaceId, agentType: "claudeCode", at, screen: `tela de ${nodeId}` } });
const sum = (nodeId: string, summary = "fez X", nextStep = "faça Y") =>
  ({ type: "summary" as const, summary: { sessionId: `s-${nodeId}`, nodeId, workspaceId: "ws1", at: "2026-11-01T12:00:05.000Z", model: "gemma3:4b", summary, nextStep } });

describe("hudReduce (#67)", () => {
  it("taskFinished cria cartão; mais novo primeiro; um turno novo do mesmo nó substitui o antigo", () => {
    let s: HudState = hudReduce(EMPTY_HUD, fin("a", "2026-11-01T12:00:00Z"));
    s = hudReduce(s, fin("b", "2026-11-01T12:01:00Z"));
    expect(s.cards.map((c) => c.nodeId)).toEqual(["b", "a"]);
    s = hudReduce(s, sum("a"));
    s = hudReduce(s, { type: "label", nodeId: "a", title: "Claude", workspace: "Projeto" });
    s = hudReduce(s, fin("a", "2026-11-01T12:02:00Z")); // novo turno do "a"
    expect(s.cards.map((c) => c.nodeId)).toEqual(["a", "b"]);
    expect(s.cards).toHaveLength(2);
    const a = s.cards[0]!;
    expect(a.summary).toBeUndefined(); // resumo era do turno anterior: não vaza para o novo
    expect(a.title).toBe("Claude"); expect(a.workspace).toBe("Projeto"); // rótulos (nome do nó/espaço) continuam valendo
    expect(a.screen).toBe("tela de a");
  });

  it("taskSummary enriquece o cartão; depois de dispensado não ressuscita; label em nó desconhecido é no-op", () => {
    let s = hudReduce(EMPTY_HUD, fin("a"));
    s = hudReduce(s, sum("a", "criou relatorio.md", "rodar os testes"));
    expect(s.cards[0]).toMatchObject({ summary: "criou relatorio.md", nextStep: "rodar os testes", model: "gemma3:4b" });
    s = hudReduce(s, { type: "dismiss", nodeId: "a" });
    expect(s.cards).toHaveLength(0);
    const after = hudReduce(s, sum("a"));
    expect(after).toBe(s); // mesma referência: nada mudou
    expect(hudReduce(s, { type: "label", nodeId: "zzz", title: "x" })).toBe(s);
    expect(hudReduce(s, { type: "dismiss", nodeId: "zzz" })).toBe(s);
  });

  it("workspaceGone remove só os cartões daquele espaço; clear zera; limite HUD_MAX", () => {
    let s = hudReduce(EMPTY_HUD, fin("a", undefined, "ws1"));
    s = hudReduce(s, fin("b", undefined, "ws2"));
    s = hudReduce(s, { type: "workspaceGone", workspaceId: "ws1" });
    expect(s.cards.map((c) => c.nodeId)).toEqual(["b"]);
    expect(hudReduce(s, { type: "clear" }).cards).toEqual([]);
    expect(hudReduce(EMPTY_HUD, { type: "clear" })).toBe(EMPTY_HUD);
    let big: HudState = EMPTY_HUD;
    for (let i = 0; i < HUD_MAX + 10; i++) big = hudReduce(big, fin(`n${i}`, new Date(1_700_000_000_000 + i * 1000).toISOString()));
    expect(big.cards).toHaveLength(HUD_MAX);
    expect(big.cards[0]!.nodeId).toBe(`n${HUD_MAX + 9}`); // os mais antigos caem
  });
});

describe("helpers do HUD", () => {
  it("screenTail pega as últimas linhas não vazias, sem \\r e sem espaço à direita", () => {
    const tail = screenTail("  \r\nlinha1   \r\n\r\nlinha2\n\n\nlinha3\n   \n", 2);
    expect(tail).toBe("linha2\nlinha3");
    expect(screenTail("", 3)).toBe("");
  });
  it("relTime em pt-BR", () => {
    const now = Date.parse("2026-11-01T12:00:00Z");
    expect(relTime("2026-11-01T11:59:50Z", now)).toBe("agora");
    expect(relTime("2026-11-01T11:57:00Z", now)).toBe("há 3 min");
    expect(relTime("2026-11-01T09:30:00Z", now)).toBe("há 3 h"); // 2,5 h arredonda para 3
    expect(relTime("2026-10-29T12:00:00Z", now)).toBe("há 3 d");
    expect(relTime("lixo", now)).toBe("");
  });
  it("awaitingSummary: só com companheiro disponível, sem resumo e turno recente", () => {
    const now = Date.parse("2026-11-01T12:00:00Z");
    const card = { nodeId: "a", workspaceId: "w", agentType: "codex", at: "2026-11-01T11:59:30Z", screen: "" };
    expect(awaitingSummary(card, true, now)).toBe(true);
    expect(awaitingSummary(card, false, now)).toBe(false);
    expect(awaitingSummary({ ...card, summary: "ok" }, true, now)).toBe(false);
    expect(awaitingSummary({ ...card, at: "2026-11-01T11:00:00Z" }, true, now)).toBe(false); // velho demais: Ollama não vai responder mais
  });
});
