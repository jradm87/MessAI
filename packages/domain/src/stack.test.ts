import { describe, expect, it } from "vitest";
import { emptyStack, parseStack, serializeStack, stackRemoveChild, stackSetActive } from "./index.js";

describe("pilha / banda agrupada (#70)", () => {
  it("parseStack tolera lixo, remove duplicados e garante active válido", () => {
    expect(parseStack("{nope")).toEqual(emptyStack());
    expect(parseStack(null)).toEqual(emptyStack());
    const s = parseStack(JSON.stringify({ childIds: ["a", "b", "a", 3, "c"], active: "zzz", bandId: "bd1" }));
    expect(s.childIds).toEqual(["a", "b", "c"]); // sem duplicados, sem não-strings
    expect(s.active).toBe("a"); // active inexistente cai no primeiro
    expect(s.bandId).toBe("bd1");
    expect(parseStack(serializeStack(s))).toEqual(s);
  });
  it("active preservado quando existe; bandId omitido quando ausente", () => {
    const s = parseStack(JSON.stringify({ childIds: ["a", "b"], active: "b" }));
    expect(s.active).toBe("b");
    expect("bandId" in s).toBe(false);
  });
  it("stackSetActive só aceita membro existente", () => {
    const s = parseStack(JSON.stringify({ childIds: ["a", "b"], active: "a" }));
    expect(stackSetActive(s, "b").active).toBe("b");
    expect(stackSetActive(s, "x").active).toBe("a");
  });
  it("stackRemoveChild tira o membro e reescolhe o ativo se era ele", () => {
    const s = parseStack(JSON.stringify({ childIds: ["a", "b", "c"], active: "b" }));
    const r = stackRemoveChild(s, "b");
    expect(r.childIds).toEqual(["a", "c"]);
    expect(r.active).toBe("a"); // era o removido → vai pro primeiro restante
    const r2 = stackRemoveChild(s, "a");
    expect(r2.active).toBe("b"); // não era o ativo → mantém
    expect(stackRemoveChild(parseStack(JSON.stringify({ childIds: ["a"], active: "a" })), "a").active).toBe("");
  });
});
