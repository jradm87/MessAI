import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const PORT = 47964;
let dir: string; let rt: ChildProcess; let token: string;
const api = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : null });
  return { status: r.status, json: r.status === 204 ? null : await r.json() };
};
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "messy-conn-"));
  rt = spawn("node", [join(ROOT, "apps/runtime/dist/index.js")], { env: { ...process.env, MESSY_DATA_DIR: dir, MESSY_PORT: String(PORT), SHELL: "/bin/sh" }, stdio: "ignore" });
  for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 200)); try { token = readFileSync(join(dir, "runtime.token"), "utf8").trim(); if ((await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: { authorization: `Bearer ${token}` } })).ok) break; } catch { /* subindo */ } }
}, 30_000);
afterAll(() => { rt?.kill(); rmSync(dir, { recursive: true, force: true }); });

describe("estilo da conexão", () => {
  it("nasce como corda, troca para circuito com revisão e volta", async () => {
    const ws = ((await api("POST", "/v1/workspaces", { name: "C", cwd: dir })).json as { workspaceId: string }).workspaceId;
    const a = (await api("POST", `/v1/workspaces/${ws}/nodes`, { expectedRevision: 0, kind: "note", geometry: { x: 0, y: 0, w: 200, h: 100 } })).json as { node: { nodeId: string } };
    const b = (await api("POST", `/v1/workspaces/${ws}/nodes`, { expectedRevision: 1, kind: "note", geometry: { x: 400, y: 0, w: 200, h: 100 } })).json as { node: { nodeId: string } };
    const c = (await api("POST", `/v1/workspaces/${ws}/connections`, { expectedRevision: 2, sourceNodeId: a.node.nodeId, targetNodeId: b.node.nodeId })).json as { connectionId: string; style?: string };
    expect(c.style ?? "rope").toBe("rope");
    const p = await api("PATCH", `/v1/connections/${c.connectionId}`, { expectedRevision: 3, style: "circuit", label: "fio 1" });
    expect(p.status).toBe(200); expect(p.json).toMatchObject({ style: "circuit", label: "fio 1" });
    expect((await api("PATCH", `/v1/connections/${c.connectionId}`, { expectedRevision: 3, style: "rope" })).status).toBe(409);
    expect((await api("PATCH", `/v1/connections/${c.connectionId}`, { expectedRevision: 4, style: "laser" })).status).toBe(400);
    const snap = (await api("GET", `/v1/workspaces/${ws}`)).json as { connections: { style: string }[] };
    expect(snap.connections[0]!.style).toBe("circuit");
  });
});
