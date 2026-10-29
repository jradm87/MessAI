import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const PORT = 47968;
let dir: string; let rt: ChildProcess; let token: string;
const api = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : null });
  return { status: r.status, json: r.status === 204 ? null : await r.json() };
};
const wait = async (pred: () => Promise<boolean>, ms = 6000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await pred()) return true; await new Promise((r) => setTimeout(r, 120)); } return false; };
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "mess-cwd-"));
  rt = spawn("node", [join(ROOT, "apps/runtime/dist/index.js")], { env: { ...process.env, MESS_DATA_DIR: dir, MESS_PORT: String(PORT), SHELL: "/bin/sh" }, stdio: "ignore" });
  for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 200)); try { token = readFileSync(join(dir, "runtime.token"), "utf8").trim(); if ((await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: { authorization: `Bearer ${token}` } })).ok) break; } catch { /* subindo */ } }
}, 30_000);
afterAll(() => { rt?.kill(); rmSync(dir, { recursive: true, force: true }); });

describe("diretório inexistente não derruba o terminal", () => {
  it("abre no home com aviso em vez de falhar com chdir", async () => {
    const ws = ((await api("POST", "/v1/workspaces", { name: "X", cwd: "/caminho/que/nao/existe/mesmo" })).json as { workspaceId: string }).workspaceId;
    const r = (await api("POST", `/v1/workspaces/${ws}/nodes`, { expectedRevision: 0, kind: "terminal", title: "T", command: "sh", geometry: { x: 0, y: 0, w: 300, h: 200 } })).json as { session: { sessionId: string } };
    const sid = r.session.sessionId;
    expect(await wait(async () => ((await api("GET", `/v1/sessions/${sid}`)).json as { state: string }).state === "running")).toBe(true);
    // ainda rodando passado um tempo (não saiu com chdir)
    await new Promise((x) => setTimeout(x, 400));
    expect(((await api("GET", `/v1/sessions/${sid}`)).json as { state: string }).state).toBe("running");
  });
});
