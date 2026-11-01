import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Verifica o runtime: /v1/running, pid file, e /v1/shutdown (que encerra o processo).
const ROOT = join(import.meta.dirname, "../..");
const PORT = 47971;
let dir: string; let rt: ChildProcess; let token: string;
const H = () => ({ authorization: `Bearer ${token}`, "content-type": "application/json" });
const api = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: H(), body: body ? JSON.stringify(body) : null });
  return { status: r.status, json: r.status === 204 ? null : await r.json().catch(() => null) };
};
const up = async () => { try { return (await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: H() })).ok; } catch { return false; } };

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "mess-life-"));
  rt = spawn("node", [join(ROOT, "apps/runtime/dist/index.js")], { env: { ...process.env, MESS_DATA_DIR: dir, MESS_PORT: String(PORT), SHELL: "/bin/sh" }, stdio: "ignore" });
  for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 200)); try { token = readFileSync(join(dir, "runtime.token"), "utf8").trim(); if (await up()) break; } catch { /* subindo */ } }
}, 30_000);
afterAll(() => { rt?.kill(); rmSync(dir, { recursive: true, force: true }); });

describe("ciclo de vida do runtime", () => {
  it("escreve runtime.pid com o pid do processo", () => {
    const pid = Number(readFileSync(join(dir, "runtime.pid"), "utf8").trim());
    expect(pid).toBe(rt.pid);
  });

  it("/v1/running lista sessões rodando com tipo", async () => {
    const ws = ((await api("POST", "/v1/workspaces", { name: "Life", cwd: dir })).json as { workspaceId: string }).workspaceId;
    await api("POST", `/v1/workspaces/${ws}/nodes`, { expectedRevision: 0, kind: "terminal", title: "Sh", command: "/bin/sh", geometry: { x: 0, y: 0, w: 300, h: 200 } });
    await new Promise((r) => setTimeout(r, 300));
    const r = (await api("GET", "/v1/running")).json as { sessions: { title: string; agentType: string; isAgent: boolean }[] };
    expect(r.sessions.length).toBeGreaterThanOrEqual(1);
    const sh = r.sessions.find((s) => s.title === "Sh");
    expect(sh).toBeTruthy(); expect(sh!.agentType).toBe("genericShell"); expect(sh!.isAgent).toBe(false);
  });

  it("/v1/shutdown encerra o runtime (porta livre, pid file removido)", async () => {
    const r = await api("POST", "/v1/shutdown", { killAgents: true });
    expect(r.status).toBe(202);
    let down = false;
    for (let i = 0; i < 25; i++) { await new Promise((x) => setTimeout(x, 200)); if (!(await up())) { down = true; break; } }
    expect(down).toBe(true); // runtime saiu
    expect(existsSync(join(dir, "runtime.pid"))).toBe(false); // pid file limpo
  });
});
