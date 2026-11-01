import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// À prova de reboot: sessão persistente re-abre quando o tmux morreu (reboot) e o runtime reinicia.
const ROOT = join(import.meta.dirname, "../..");
const PORT = 47983;
const SOCK = "mess-test-reboot"; // socket tmux isolado — nunca toca no tmux do usuário
let dir: string; let rt: ChildProcess; let token: string;
const H = () => ({ authorization: `Bearer ${token}`, "content-type": "application/json" });
const env = () => ({ ...process.env, MESS_DATA_DIR: dir, MESS_PORT: String(PORT), MESS_TMUX_SOCKET: SOCK, SHELL: "/bin/sh" });
const api = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: H(), body: body ? JSON.stringify(body) : null });
  return { status: r.status, json: r.status === 204 ? null : await r.json().catch(() => null) };
};
const up = async () => { try { return (await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: H() })).ok; } catch { return false; } };
const boot = async () => { const p = spawn("node", [join(ROOT, "apps/runtime/dist/index.js")], { env: env(), stdio: "ignore" }); for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 200)); try { token = readFileSync(join(dir, "runtime.token"), "utf8").trim(); if (await up()) break; } catch { /* subindo */ } } return p; };
const down = async (p: ChildProcess) => { p.kill("SIGKILL"); for (let i = 0; i < 25; i++) { if (!(await up())) return; await new Promise((r) => setTimeout(r, 200)); } };
const hasTmux = (() => { try { execFileSync("tmux", ["-V"], { stdio: "ignore" }); return true; } catch { return false; } })();

beforeAll(async () => { dir = mkdtempSync(join(tmpdir(), "mess-reboot-")); rt = await boot(); }, 30_000);
afterAll(() => { try { rt?.kill("SIGKILL"); } catch { /* */ } try { execFileSync("tmux", ["-L", SOCK, "kill-server"], { stdio: "ignore" }); } catch { /* */ } rmSync(dir, { recursive: true, force: true }); });

describe.skipIf(!hasTmux)("workspace à prova de reboot", () => {
  it("re-abre a sessão persistente após o tmux morrer e o runtime reiniciar", async () => {
    const ws = ((await api("POST", "/v1/workspaces", { name: "Reb", cwd: dir })).json as { workspaceId: string }).workspaceId;
    const node = (await api("POST", `/v1/workspaces/${ws}/nodes`, { expectedRevision: 0, kind: "terminal", title: "Rota", command: "/bin/sh", persistent: true, geometry: { x: 0, y: 0, w: 300, h: 200 } })).json as { session: { sessionId: string } };
    expect(node.session.sessionId).toBeTruthy();
    await new Promise((r) => setTimeout(r, 400));
    const before = (await api("GET", "/v1/running")).json as { sessions: { title: string }[] };
    expect(before.sessions.some((s) => s.title === "Rota")).toBe(true);

    // Simula reboot: mata TODO o tmux do socket isolado + derruba o runtime.
    try { execFileSync("tmux", ["-L", SOCK, "kill-server"], { stdio: "ignore" }); } catch { /* já morto */ }
    await down(rt);

    // Reinicia o runtime no mesmo data dir → recoverPersistent deve RE-ABRIR a sessão.
    rt = await boot();
    await new Promise((r) => setTimeout(r, 600));
    const after = (await api("GET", "/v1/running")).json as { sessions: { title: string }[] };
    expect(after.sessions.some((s) => s.title === "Rota")).toBe(true); // voltou rodando
  }, 30_000);
});
