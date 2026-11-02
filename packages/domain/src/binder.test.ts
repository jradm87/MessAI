import { describe, expect, it } from "vitest";
import { binderAddPage, binderBringToFront, binderPatchPage, binderRemovePage, binderSetActive, emptyBinder, parseBinder, serializeBinder } from "./index.js";

describe("fichário (#74)", () => {
  it("parseBinder tolera lixo, garante ≥1 página e active válido", () => {
    expect(parseBinder("{nope")).toEqual(emptyBinder());
    expect(parseBinder(JSON.stringify({ pages: [] }))).toEqual(emptyBinder());
    expect(parseBinder(null)).toEqual(emptyBinder());
    const b = parseBinder(JSON.stringify({ pages: [{ id: "a", title: "A", content: "x" }, { id: 1 }, { id: "b", title: "B", content: "" }], active: "zzz", color: "#ef5350" }));
    expect(b.pages.map((p) => p.id)).toEqual(["a", "b"]); expect(b.active).toBe("a"); expect(b.color).toBe("#ef5350");
    expect(parseBinder(serializeBinder(b))).toEqual(b);
  });
  it("adicionar página ativa a nova e gera ids únicos; setActive ignora id inexistente; patch muda só a página", () => {
    let b = emptyBinder();
    b = binderAddPage(b, { title: "Ideias", content: "oi" }); b = binderAddPage(b);
    expect(b.pages.map((p) => p.title)).toEqual(["Página 1", "Ideias", "Página 3"]); expect(b.active).toBe(b.pages[2]!.id);
    expect(new Set(b.pages.map((p) => p.id)).size).toBe(3);
    expect(binderSetActive(b, "nada")).toBe(b);
    const c = binderPatchPage(b, b.pages[1]!.id, { content: "novo" }); expect(c.pages[1]!.content).toBe("novo"); expect(c.pages[0]!.content).toBe("");
  });
  it("tirar página: devolve a página e ajusta a ativa; com uma só não tira; trazer para frente reordena", () => {
    let b = binderAddPage(binderAddPage(emptyBinder(), { title: "B" }), { title: "C" });
    const r = binderRemovePage(b, b.pages[2]!.id)!; // remove a ativa (C)
    expect(r.page.title).toBe("C"); expect(r.binder.pages).toHaveLength(2); expect(r.binder.active).toBe(r.binder.pages[1]!.id);
    expect(binderRemovePage(emptyBinder(), "p1")).toBeNull(); expect(binderRemovePage(b, "x")).toBeNull();
    const f = binderBringToFront(b, b.pages[2]!.id); expect(f.pages[0]!.title).toBe("C"); expect(f.active).toBe(f.pages[0]!.id);
  });
});
