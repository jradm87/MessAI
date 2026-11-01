import { describe, expect, it } from "vitest";
import { fold, groupItems, rankItems, scoreText, type PaletteItem } from "./palette.js";

const I = (id: string, kind: PaletteItem["kind"], label: string, extra: Partial<PaletteItem> = {}): PaletteItem => ({ id, kind, label, ...extra });

describe("paleta global (#69)", () => {
  it("fold tira acento e caixa; scoreText: prefixo > início de palavra > substring > subsequência curta; 0 quando não casa", () => {
    expect(fold("Revisão Código")).toBe("revisao codigo");
    expect(scoreText("Novo terminal", "novo")).toBe(100);
    expect(scoreText("Novo terminal", "term")).toBe(80);
    expect(scoreText("Novo terminal", "ermi")).toBe(50);
    expect(scoreText("Novo terminal", "nt")).toBe(20);
    expect(scoreText("Novo terminal", "xyz")).toBe(0);
    expect(scoreText("Revisão", "revisao")).toBe(100);
  });
  it("rankItems: sem consulta, ordem natural limitada; com consulta, melhor pontuação primeiro e desempate por tipo", () => {
    const items = [I("c", "content", "deploy quebrou", { detail: "chat · Agente" }), I("w", "workspace", "Deploy"), I("n", "node", "Agente deploy"), I("a", "attention", "Agente concluiu", { keywords: "deploy", boost: 30 })];
    expect(rankItems(items, "", 2).map((x) => x.id)).toEqual(["c", "w"]);
    const r = rankItems(items, "deploy").map((x) => x.id);
    expect(r[0]).toBe("a"); // atenção casa pela palavra-chave e o boost a põe na frente (quem espera você vem primeiro)
    expect(r[1]).toBe("w"); // depois o prefixo exato no rótulo
    expect(r).toContain("c"); expect(r).toContain("n"); expect(r).toContain("a");
    expect(rankItems(items, "nada").length).toBe(0);
    // empate de pontuação: atenção vence conteúdo
    const tie = [I("x", "content", "Backend"), I("y", "attention", "Backend")];
    expect(rankItems(tie, "back").map((x) => x.id)).toEqual(["y", "x"]);
  });
  it("groupItems mantém a ordem e titula as seções", () => {
    const g = groupItems([I("1", "attention", "a"), I("2", "workspace", "b"), I("3", "attention", "c")]);
    expect(g.map((x) => [x.kind, x.items.length])).toEqual([["attention", 2], ["workspace", 1]]);
    expect(g[0]!.title).toBe("Esperando você");
  });
});
