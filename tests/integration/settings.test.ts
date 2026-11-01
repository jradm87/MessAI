import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// #55 — configurações do runtime: GET/PATCH /v1/settings persistem no banco (sobrevivem a reinício);
// restoreSessions=false impede RE-SUBIR sessão persistente após "reboot" (tmux morto), marcando-a `lost`.
const ROOT = join(import.meta.dirname, "../..");
const PORT = 47961;
const SOCK = "mess-test-settings"; // socket tmux isolado — nunca toca no tmux do usuário
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

beforeAll(async () => { dir = mkdtempSync(join(tmpdir(), "mess-settings-")); rt = await boot(); }, 30_000);
afterAll(() => { try { rt?.kill("SIGKILL"); } catch { /* */ } try { execFileSync("tmux", ["-L", SOCK, "kill-server"], { stdio: "ignore" }); } catch { /* */ } rmSync(dir, { recursive: true, force: true }); });

describe("configurações do runtime (#55)", () => {
  it("padrão restoreSessions=true; PATCH valida o corpo; o valor sobrevive a um reinício do runtime", async () => {
    expect((await api("GET", "/v1/settings")).json).toEqual({ restoreSessions: true });
    expect((await api("PATCH", "/v1/settings", { restoreSessions: "sim" })).status).toBe(400); // tipo errado
    expect((await api("PATCH", "/v1/settings", { restoreSessions: false })).json).toEqual({ restoreSessions: false });
    expect((await api("GET", "/v1/settings")).json).toEqual({ restoreSessions: false });
    await down(rt); rt = await boot();
    expect((await api("GET", "/v1/settings")).json).toEqual({ restoreSessions: false }); // persistido no banco
  }, 30_000);

  it.skipIf(!hasTmux)("com restoreSessions=false, sessão persistente NÃO re-abre após reboot (vira lost); tmux vivo ainda reanexa", async () => {
    const ws = ((await api("POST", "/v1/workspaces", { name: "Cfg", cwd: dir })).json as { workspaceId: string }).workspaceId;
    const node = (await api("POST", `/v1/workspaces/${ws}/nodes`, { expectedRevision: 0, kind: "terminal", title: "Persistente", command: "/bin/sh", persistent: true, geometry: { x: 0, y: 0, w: 300, h: 200 } })).json as { session: { sessionId: string } };
    expect(node.session.sessionId).toBeTruthy();
    await new Promise((r) => setTimeout(r, 400));
    // Reinício do runtime com o tmux VIVO: reanexa mesmo com restoreSessions=false (não é "restaurar", é reconectar).
    await down(rt); rt = await boot(); await new Promise((r) => setTimeout(r, 600));
    expect(((await api("GET", "/v1/running")).json as { sessions: { title: string }[] }).sessions.some((s) => s.title === "Persistente")).toBe(true);
    // "Reboot": tmux morto + runtime reiniciado → com restoreSessions=false, não RE-SOBE.
    try { execFileSync("tmux", ["-L", SOCK, "kill-server"], { stdio: "ignore" }); } catch { /* já morto */ }
    await down(rt); rt = await boot(); await new Promise((r) => setTimeout(r, 600));
    expect(((await api("GET", "/v1/running")).json as { sessions: { title: string }[] }).sessions.some((s) => s.title === "Persistente")).toBe(false);
    const s = (await api("GET", `/v1/sessions/${node.session.sessionId}`)).json as { state: string };
    expect(s.state).toBe("lost");
  }, 40_000);
});
