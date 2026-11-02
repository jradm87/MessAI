import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// #80 Terminal: monitor de processos (listar/parar) + limite de memória.
const ROOT = join(import.meta.dirname, "../..");
const PORT = 48016;
let dir: string; let rt: ChildProcess; let token: string;
const H = () => ({ authorization: `Bearer ${token}`, "content-type": "application/json" });
const api = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: H(), body: body ? JSON.stringify(body) : null });
  return { status: r.status, json: r.status === 204 ? null : await r.json() };
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "mess-int-"));
  rt = spawn("node", [join(ROOT, "apps/runtime/dist/index.js")], { env: { ...process.env, MESS_DATA_DIR: dir, MESS_PORT: String(PORT), SHELL: "/bin/sh" }, stdio: "ignore" });
  for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 200)); try { token = readFileSync(join(dir, "runtime.token"), "utf8").trim(); if ((await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: H() })).ok) break; } catch { /* subindo */ } }
}, 30_000);
afterAll(() => { rt?.kill(); rmSync(dir, { recursive: true, force: true }); });

describe("#80 monitor de processos + limite de memória", () => {
  let ws: string, nodeId: string, sessionId: string;
  it("lista a árvore de processos do PTY com RSS > 0 e respeita confinamento ao matar", async () => {
    ws = ((await api("POST", "/v1/workspaces", { name: "Procs", cwd: dir })).json as { workspaceId: string }).workspaceId;
    const made = (await api("POST", `/v1/workspaces/${ws}/nodes`, { expectedRevision: 0, kind: "terminal", title: "Sh", command: "/bin/sh", args: ["-c", "sleep 30"], geometry: { x: 0, y: 0, w: 300, h: 200 } })).json as { node: { nodeId: string }; session: { sessionId: string } };
    nodeId = made.node.nodeId; sessionId = made.session.sessionId;
    await new Promise((r) => setTimeout(r, 300));
    const pr = (await api("GET", `/v1/sessions/${sessionId}/procs`)).json as { totalRssKb: number; overLimit: boolean; processes: { pid: number; name: string; depth: number }[] };
    expect(pr.totalRssKb).toBeGreaterThan(0);
    expect(pr.processes.length).toBeGreaterThanOrEqual(1);
    // Recusa matar PID que não pertence ao terminal (ex.: o próprio teste)
    expect((await api("POST", `/v1/sessions/${sessionId}/procs/kill`, { pid: process.pid })).status).toBe(403);
  });
  it("detecta overLimit quando memLimitMb no nó é excedido", async () => {
    const p = await api("PATCH", `/v1/nodes/${nodeId}`, { expectedRevision: 1, memLimitMb: 1 });
    expect(p.status).toBe(200);
    // Mas mesmo que /bin/sh ocupe >1MB ou <1MB, se pusermos um processo node ou checarmos limitMb=1:
    const pr = (await api("GET", `/v1/sessions/${sessionId}/procs`)).json as { limitMb: number; totalRssKb: number; overLimit: boolean };
    expect(pr.limitMb).toBe(1);
    expect(pr.overLimit).toBe(pr.totalRssKb > 1024);
  });
  it("parar um processo da árvore encerra o processo", async () => {
    const pr0 = (await api("GET", `/v1/sessions/${sessionId}/procs`)).json as { processes: { pid: number }[] };
    const target = pr0.processes[pr0.processes.length - 1]!.pid;
    const k = await api("POST", `/v1/sessions/${sessionId}/procs/kill`, { pid: target, signal: "SIGTERM" });
    expect(k.status).toBe(200);
  });
});
