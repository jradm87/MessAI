import { describe, expect, it } from "vitest";
import { ftsQuery, Store } from "./index.js";
import type { ChatMessage, Node, Workspace } from "@messai/contracts";

// #41 — FTS5 mantido por triggers: criar/editar/apagar notas e chats reflete na busca sem código extra.
const now = "2026-11-01T00:00:00.000Z";
const ws = (id: string): Workspace => ({ workspaceId: id, machineId: "m", name: id, cwd: "/tmp", icon: "x", color: "#000", sortOrder: 0, revision: 0, createdAt: now });
const note = (id: string, workspaceId: string, title: string, content: string, kind: Node["kind"] = "note"): Node => ({ nodeId: id, workspaceId, kind, title, geometry: { x: 0, y: 0, w: 1, h: 1 }, content, createdAt: now });
const chat = (id: string, workspaceId: string, nodeId: string, text: string, role: ChatMessage["role"] = "agent"): ChatMessage => ({ chatId: id, workspaceId, nodeId, thread: 1, role, text, createdAt: now });

describe("ftsQuery", () => {
  it("tokens viram frases com prefixo; operadores do usuário são neutralizados; vazio → null", () => {
    expect(ftsQuery("revisão código")).toBe('"revisão"* "código"*');
    expect(ftsQuery('  a "b" OR (c)* ')).toBe('"a"* "b"* "OR"* "c"*');
    expect(ftsQuery("   ")).toBeNull(); expect(ftsQuery('"""')).toBeNull();
  });
});

describe("Store.search (#41)", () => {
  const mk = () => { const s = new Store(":memory:"); s.insertWorkspace(ws("w1")); s.insertWorkspace(ws("w2")); return s; };
  it("acha nota por título e corpo, sem acento, por prefixo; snippet marca o termo; título pesa mais", () => {
    const s = mk();
    s.insertNode(note("n1", "w1", "Revisão de PRs", "Checklist para revisar código com rigor."));
    s.insertNode(note("n2", "w1", "Compras", "Nada a ver: lista de compras e revisar o mercado."));
    s.insertNode(note("t1", "w1", "Texto solto", "um bloco de texto sobre arquitetura", "text"));
    const r = s.search("revis");
    expect(r.map((x) => x.nodeId)).toEqual(["n1", "n2"]); // título casa → primeiro
    expect(r[0]!.kind).toBe("note"); expect(r[0]!.snippet).toContain("[revisar]");
    expect(s.search("REVISAO").map((x) => x.nodeId)).toEqual(["n1"]); // diacríticos/caixa não importam ("revisao" é prefixo de "revisão", não de "revisar")
    expect(s.search("arquitetura").map((x) => x.nodeId)).toEqual(["t1"]); // nós de texto também
    expect(s.search("revisar codigo").map((x) => x.nodeId)).toEqual(["n1"]); // AND implícito
    expect(s.search("inexistente")).toEqual([]);
  });
  it("edição re-indexa; apagar o nó some da busca; terminal não entra", () => {
    const s = mk();
    s.insertNode(note("n1", "w1", "Rascunho", "primeira versão"));
    s.insertNode({ ...note("term", "w1", "claude", ""), kind: "terminal" });
    expect(s.search("primeira")).toHaveLength(1);
    s.updateNode("n1", { content: "segunda versão, reescrita" });
    expect(s.search("primeira")).toEqual([]); expect(s.search("reescrita")).toHaveLength(1);
    s.updateNode("n1", { title: "Documento final" });
    expect(s.search("documento")[0]!.title).toBe("Documento final");
    expect(s.search("claude")).toEqual([]);
    s.deleteNode("n1");
    expect(s.search("reescrita")).toEqual([]);
  });
  it("chats: indexa mensagens (menos as de sistema), filtra por espaço e tipo, apaga ao limpar o chat ou apagar o nó", () => {
    const s = mk();
    s.insertNode({ ...note("term", "w1", "Agente", ""), kind: "terminal" });
    s.insertNode({ ...note("term2", "w2", "Outro", ""), kind: "terminal" });
    s.insertChat(chat("c1", "w1", "term", "o deploy falhou no passo de migração"));
    s.insertChat(chat("c2", "w2", "term2", "deploy ok no segundo espaço"));
    s.insertChat(chat("c3", "w1", "term", "__cleared__", "system"));
    s.insertNode(note("n1", "w1", "Deploy", "notas sobre o deploy"));
    expect(s.search("deploy").map((x) => x.refId).sort()).toEqual(["c1", "c2", "n1"]);
    expect(s.search("deploy", { workspaceId: "w1" }).map((x) => x.refId).sort()).toEqual(["c1", "n1"]);
    expect(s.search("deploy", { kinds: ["chat"] }).map((x) => x.refId).sort()).toEqual(["c1", "c2"]);
    expect(s.search("cleared")).toEqual([]);
    expect(s.search("migração")[0]).toMatchObject({ kind: "chat", nodeId: "term", refId: "c1" });
    s.clearChat("term", 1);
    expect(s.search("migração")).toEqual([]);
    s.deleteNode("term2");
    expect(s.search("segundo")).toEqual([]);
    expect(s.search("deploy", { limit: 1 })).toHaveLength(1);
  });
  it("apagar o espaço (cascade) limpa o índice; consulta só com lixo devolve []", () => {
    const s = mk();
    s.insertNode(note("n1", "w1", "Alfa", "beta gama"));
    expect(s.search("gama")).toHaveLength(1);
    s.db.prepare("DELETE FROM workspaces WHERE workspace_id='w1'").run();
    expect(s.search("gama")).toEqual([]);
    expect(s.search("()*\"")).toEqual([]);
  });
});
