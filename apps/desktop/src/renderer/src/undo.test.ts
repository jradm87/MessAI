import { describe, expect, it } from "vitest";
import { COALESCE_MS, HISTORY_MAX, History, type Op } from "./undo.js";

/** Executor falso: registra as operações e devolve ids novos para criações. */
function fake() {
  const log: Op[] = []; let n = 0;
  const exec = async (op: Op) => { log.push(op); if (op.type === "createNode" || op.type === "createConnection" || op.type === "createDrawing") return `new${++n}`; };
  return { log, exec };
}
const g = { x: 0, y: 0, w: 10, h: 10 };

describe("History (#77)", () => {
  it("undo executa o inverso, redo o direto; nova ação apaga o redo; rótulos", async () => {
    const f = fake(); let t = 1000; const h = new History(f.exec, () => t);
    h.record({ label: "mover 1 nó", forward: [{ type: "layout", moves: [{ nodeId: "a", geometry: { ...g, x: 5 } }] }], inverse: [{ type: "layout", moves: [{ nodeId: "a", geometry: g }] }] });
    expect(h.canUndo).toBe(true); expect(h.undoLabel).toBe("mover 1 nó"); expect(h.canRedo).toBe(false);
    await h.undo(); expect(f.log.at(-1)).toMatchObject({ type: "layout", moves: [{ nodeId: "a", geometry: g }] }); expect(h.canRedo).toBe(true); expect(h.redoLabel).toBe("mover 1 nó");
    await h.redo(); expect(f.log.at(-1)).toMatchObject({ type: "layout", moves: [{ nodeId: "a", geometry: { ...g, x: 5 } }] });
    await h.undo(); t += 10;
    h.record({ label: "outra", forward: [{ type: "deleteNode", id: "b" }], inverse: [] });
    expect(h.canRedo).toBe(false); // nova ação limpa o redo
    expect(await h.redo()).toBeNull();
  });
  it("remap: desfazer uma exclusão recria com id novo e as entradas seguintes passam a apontar para ele", async () => {
    const f = fake(); const h = new History(f.exec);
    const spec = { kind: "note" as const, title: "N", geometry: g, content: "x" };
    h.record({ label: "criar nota", forward: [{ type: "createNode", ref: "n1", spec }], inverse: [{ type: "deleteNode", id: "n1" }] });
    h.record({ label: "renomear", forward: [{ type: "patchNode", id: "n1", patch: { title: "Nova" } }], inverse: [{ type: "patchNode", id: "n1", patch: { title: "N" } }] });
    h.record({ label: "conectar", forward: [{ type: "createConnection", ref: "c1", spec: { sourceNodeId: "n1", targetNodeId: "t1" } }], inverse: [{ type: "deleteConnection", id: "c1" }] });
    await h.undo(); await h.undo(); await h.undo(); // apaga conexão, volta nome, apaga nota
    expect(f.log.map((o) => o.type)).toEqual(["deleteConnection", "patchNode", "deleteNode"]);
    await h.redo(); // recria a nota → id new1
    expect(f.log.at(-1)).toMatchObject({ type: "createNode", ref: "n1" }); expect(h.resolve("n1")).toBe("new1");
    await h.redo(); expect(f.log.at(-1)).toMatchObject({ type: "patchNode", id: "new1", patch: { title: "Nova" } });
    await h.redo(); expect(f.log.at(-1)).toMatchObject({ type: "createConnection", spec: { sourceNodeId: "new1", targetNodeId: "t1" } }); expect(h.resolve("c1")).toBe("new2");
    await h.undo(); expect(f.log.at(-1)).toMatchObject({ type: "deleteConnection", id: "new2" });
  });
  it("coalescência por chave dentro da janela (digitação): um undo volta ao texto original; fora da janela, entradas separadas", async () => {
    const f = fake(); let t = 0; const h = new History(f.exec, () => t);
    const edit = (from: string, to: string) => h.record({ key: "content:n1", label: "editar nota", forward: [{ type: "patchNode", id: "n1", patch: { content: to } }], inverse: [{ type: "patchNode", id: "n1", patch: { content: from } }] });
    edit("", "a"); t += 200; edit("a", "ab"); t += 200; edit("ab", "abc");
    expect(h.size).toBe(1);
    await h.undo(); expect(f.log.at(-1)).toMatchObject({ type: "patchNode", patch: { content: "" } });
    await h.redo(); expect(f.log.at(-1)).toMatchObject({ type: "patchNode", patch: { content: "abc" } });
    t += COALESCE_MS + 1; edit("abc", "abcd");
    expect(h.size).toBe(2);
  });
  it("grupo: várias ações viram uma etapa, desfeita em ordem inversa; grupo vazio não entra; limite da pilha", async () => {
    const f = fake(); const h = new History(f.exec);
    h.beginGroup("excluir 2 nós");
    h.record({ label: "x", forward: [{ type: "deleteNode", id: "a" }], inverse: [{ type: "createNode", ref: "a", spec: { kind: "note", title: "A", geometry: g } }] });
    h.record({ label: "y", forward: [{ type: "deleteNode", id: "b" }], inverse: [{ type: "createNode", ref: "b", spec: { kind: "note", title: "B", geometry: g } }] });
    h.endGroup();
    expect(h.size).toBe(1); expect(h.undoLabel).toBe("excluir 2 nós");
    await h.undo();
    expect(f.log.map((o) => (o as { ref?: string }).ref)).toEqual(["b", "a"]); // inverso em ordem contrária
    h.beginGroup("vazio"); h.endGroup(); expect(h.size).toBe(0); // após o undo a pilha estava vazia; grupo vazio não entra
    for (let i = 0; i < HISTORY_MAX + 7; i++) h.record({ label: `m${i}`, forward: [], inverse: [] });
    expect(h.size).toBe(HISTORY_MAX); expect(h.undoLabel).toBe(`m${HISTORY_MAX + 6}`);
  });
  it("falha no executor devolve a entrada para a pilha (nada se perde) e propaga o erro", async () => {
    const h = new History(async (op) => { if (op.type === "deleteNode") throw new Error("409"); });
    h.record({ label: "criar", forward: [{ type: "createNode", ref: "n", spec: { kind: "note", title: "N", geometry: g } }], inverse: [{ type: "deleteNode", id: "n" }] });
    await expect(h.undo()).rejects.toThrow("409");
    expect(h.canUndo).toBe(true); expect(h.canRedo).toBe(false);
  });
});
