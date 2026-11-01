import { describe, expect, it } from "vitest";
import { parsePrompts, PROMPTS_MAX, promptTitle, upsertPrompt } from "./prompts.js";

describe("prompts salvos (#57)", () => {
  it("parsePrompts tolera lixo e descarta itens sem título/texto", () => {
    expect(parsePrompts(null)).toEqual([]);
    expect(parsePrompts("{x")).toEqual([]);
    expect(parsePrompts(JSON.stringify([{ title: "a", text: "b" }, { title: 1, text: "c" }, { title: "d", text: "  " }, "x"]))).toEqual([{ title: "a", text: "b" }]);
    expect(parsePrompts(JSON.stringify(Array.from({ length: PROMPTS_MAX + 5 }, (_, i) => ({ title: `t${i}`, text: `x${i}` }))))).toHaveLength(PROMPTS_MAX);
  });
  it("promptTitle e upsertPrompt (sem duplicar o mesmo texto; mais novo no topo)", () => {
    expect(promptTitle("  primeira linha\nsegunda")).toBe("primeira linha");
    expect(promptTitle("a".repeat(60))).toHaveLength(48);
    const l = upsertPrompt([{ title: "a", text: "A" }, { title: "b", text: "B" }], { title: "novo", text: "B" });
    expect(l.map((p) => p.title)).toEqual(["novo", "a"]);
  });
});
