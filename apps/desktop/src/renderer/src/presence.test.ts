import { describe, expect, it } from "vitest";
import { agentPresence, attentionByWorkspace, presenceTitle, signalTitle } from "./presence.js";
import type { AttentionItem } from "@messai/contracts";

const A = (kind: AttentionItem["kind"], workspaceId: string, extra: Partial<AttentionItem> = {}): AttentionItem => ({ kind, nodeId: `n-${Math.random()}`, workspaceId, workspaceName: workspaceId, title: "t", ...extra });
describe("presença (#47)", () => {
  it("atenção por espaço soma os andares no térreo e conta mensagens", () => {
    const r = attentionByWorkspace([A("finished", "floor1"), A("unread", "floor1", { count: 3 }), A("exited", "ground"), A("finished", "outro")], { floor1: "ground" });
    expect(r["floor1"]).toEqual({ total: 2, finished: 1, unread: 3, dead: 0 });
    expect(r["ground"]).toEqual({ total: 3, finished: 1, unread: 3, dead: 1 }); // térreo = o próprio + andar
    expect(r["outro"]).toEqual({ total: 1, finished: 1, unread: 0, dead: 0 });
    expect(attentionByWorkspace([])).toEqual({});
    expect(signalTitle(r["ground"]!)).toBe("1 agente(s) concluiu · 3 mensagem(ns) não lida(s) · 1 terminal(is) encerrado(s)");
  });
  it("agentPresence agrupa por tipo com o pior estado", () => {
    const nodes = [{ id: "a", kind: "claude" }, { id: "b", kind: "claude" }, { id: "c", kind: "codex" }, { id: "d", kind: "shell" }, { id: "e", kind: "shell" }];
    const r = agentPresence(nodes, { a: "running", b: "running", c: "exited", d: "running", e: "starting" }, (id) => id === "b");
    const by = Object.fromEntries(r.map((p) => [p.kind, p]));
    expect(by["claude"]).toMatchObject({ count: 2, state: "attention", attention: 1, running: 2 });
    expect(by["codex"]).toMatchObject({ count: 1, state: "dead" });
    expect(by["shell"]).toMatchObject({ count: 2, state: "running", running: 1 });
    expect(presenceTitle(by["claude"]!)).toBe("claude ×2 · 2 rodando · 1 esperando você");
    expect(agentPresence([{ id: "x", kind: "claude" }], {}, () => false)[0]!.state).toBe("idle");
    expect(agentPresence([{ id: "x", kind: "claude" }], { x: "exited" }, () => true)[0]!.state).toBe("dead"); // encerrado vence atenção
  });
});
