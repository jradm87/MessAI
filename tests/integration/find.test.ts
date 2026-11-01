import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// #41 — GET /v1/find (FTS5) pela API: notas criadas/editadas pelo serviço e chats postados entram na busca; capability anunciada.
const ROOT = join(import.meta.dirname, "../..");
const PORT = 47987;
let dir: string; let rt: ChildProcess; let token: string;
const H = (json = false) => ({ authorization: `Bearer ${token}`, ...(json ? { "content-type": "application/json" } : {}) });
const api = async (method: string, path: string, body?: unknown) => { const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: H(body !== undefined), body: body !== undefined ? JSON.stringify(body) : null }); return { status: r.status, json: r.status === 204 ? null : await r.json().catch(() => null) }; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "mess-find-"));
  rt = spawn("node", [join(ROOT, "apps/runtime/dist/index.js")], { env: { ...process.env, MESS_DATA_DIR: dir, MESS_PORT: String(PORT), SHELL: "/bin/sh" }, stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { await sleep(200); try { token = readFileSync(join(dir, "runtime.token"), "utf8").trim(); up = (await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: H() })).ok; } catch { /* subindo */ } }
  if (!up) throw new Error(`runtime não subiu na ${PORT}`);
}, 30_000);
afterAll(() => { try { rt?.kill("SIGKILL"); } catch { /* */ } rmSync(dir, { recursive: true, force: true }); });

describe("busca de texto (#41)", () => {
  it("capability search.fts5; notas e chats aparecem com snippet, filtram por espaço e tipo; edição e exclusão refletem", async () => {
    expect(((await api("GET", "/v1/capabilities")).json as { features: string[] }).features).toContain("search.fts5");
    const ws = ((await api("POST", "/v1/workspaces", { name: "Busca", cwd: dir })).json as { workspaceId: string }).workspaceId;
    const n = (await api("POST", `/v1/workspaces/${ws}/nodes`, { expectedRevision: 0, kind: "note", title: "Plano de migração", content: "Passo 1: congelar deploys. Passo 2: migrar o banco.", geometry: { x: 0, y: 0, w: 200, h: 100 } })).json as { node: { nodeId: string }; revision: number };
    const t = (await api("POST", `/v1/workspaces/${ws}/nodes`, { expectedRevision: n.revision, kind: "terminal", title: "Agente", command: "/bin/sh", geometry: { x: 0, y: 0, w: 200, h: 100 } })).json as { node: { nodeId: string }; revision: number };
    await api("POST", `/v1/nodes/${t.node.nodeId}/chat`, { text: "o deploy quebrou na migração da tabela users" });
    const all = (await api("GET", "/v1/find?q=migra")).json as { kind: string; nodeId: string; nodeTitle: string; snippet: string }[];
    expect(all.map((h) => h.kind).sort()).toEqual(["chat", "node", "note"]); // sem kinds: conteúdo (FTS5) + título de nó (#69)
    const note = all.find((h) => h.kind === "note")!; expect(note.nodeTitle).toBe("Plano de migração"); expect(note.snippet).toMatch(/\[migra/i);
    const chat = all.find((h) => h.kind === "chat")!; expect(chat.nodeId).toBe(t.node.nodeId); expect(chat.nodeTitle).toBe("Agente");
    expect(((await api("GET", `/v1/find?q=migra&kinds=chat`)).json as unknown[]).length).toBe(1);
    expect(((await api("GET", `/v1/find?q=migra&workspaceId=nao-existe`)).json as unknown[]).length).toBe(0);
    expect(((await api("GET", "/v1/find?q=")).json as unknown[]).length).toBe(0);
    // edição pela API re-indexa
    await api("PATCH", `/v1/nodes/${n.node.nodeId}`, { expectedRevision: t.revision, content: "Plano cancelado: sem rollout este mês." });
    expect(((await api("GET", "/v1/find?q=congelar")).json as unknown[]).length).toBe(0);
    expect(((await api("GET", "/v1/find?q=rollout")).json as { nodeId: string }[])[0]!.nodeId).toBe(n.node.nodeId);
    // apagar o nó some
    const rev = ((await api("GET", `/v1/workspaces/${ws}`)).json as { workspace: { revision: number } }).workspace.revision;
    await api("DELETE", `/v1/nodes/${n.node.nodeId}`, { expectedRevision: rev });
    expect(((await api("GET", "/v1/find?q=rollout")).json as unknown[]).length).toBe(0);
  }, 30_000);
});
