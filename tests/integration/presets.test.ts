import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// #56 — presets de Início rápido editáveis/persistidos (GET/PUT/reset /v1/presets) e aparência do terminal no nó
// (icon/color/termTheme na criação e no PATCH).
const ROOT = join(import.meta.dirname, "../..");
const PORT = 47963;
let dir: string; let rt: ChildProcess; let token: string;
const H = (json = false) => ({ authorization: `Bearer ${token}`, ...(json ? { "content-type": "application/json" } : {}) });
const api = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: H(body !== undefined), body: body !== undefined ? JSON.stringify(body) : null });
  return { status: r.status, json: r.status === 204 ? null : await r.json().catch(() => null) };
};
const up = async () => { try { return (await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: H() })).ok; } catch { return false; } };
const boot = async () => { const p = spawn("node", [join(ROOT, "apps/runtime/dist/index.js")], { env: { ...process.env, MESS_DATA_DIR: dir, MESS_PORT: String(PORT), SHELL: "/bin/sh" }, stdio: "ignore" }); for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 200)); try { token = readFileSync(join(dir, "runtime.token"), "utf8").trim(); if (await up()) break; } catch { /* subindo */ } } return p; };
const down = async (p: ChildProcess) => { p.kill("SIGKILL"); for (let i = 0; i < 25; i++) { if (!(await up())) return; await new Promise((r) => setTimeout(r, 200)); } };
type P = { id: string; label: string; command: string; args: string[]; enabled: boolean; icon: string; color: string; maestro: boolean; target: string; theme: string; available: boolean; builtin: boolean };
const strip = (p: P) => { const { available: _a, builtin: _b, ...rest } = p; return rest; };

beforeAll(async () => { dir = mkdtempSync(join(tmpdir(), "mess-presets-")); rt = await boot(); }, 30_000);
afterAll(() => { try { rt?.kill("SIGKILL"); } catch { /* */ } rmSync(dir, { recursive: true, force: true }); });

describe("presets editáveis (#56)", () => {
  it("padrões vêm com builtin/available; PUT reordena, desabilita e adiciona; persiste após reinício; reset restaura", async () => {
    const d = (await api("GET", "/v1/presets")).json as P[];
    expect(d.map((p) => p.id)).toEqual(["shell", "claude", "codex", "opencode", "antigravity"]);
    expect(d[0]).toMatchObject({ builtin: true, available: true, enabled: true, theme: "system", target: "terminal" }); expect(d[0]!.command.length).toBeGreaterThan(0); // shell padrão vem do passwd, não do $SHELL
    // reordena (claude primeiro), desabilita codex, adiciona um preset próprio com aparência
    const mine = { id: "meu-shell", label: "Meu shell", command: "/bin/sh", args: ["-l"], enabled: true, icon: "rocket", color: "#ef5350", maestro: false, target: "chat", theme: "dark" };
    const next = [strip(d[1]!), strip(d[0]!), { ...strip(d[2]!), enabled: false }, strip(d[3]!), strip(d[4]!), mine];
    const put = (await api("PUT", "/v1/presets", { presets: next })).json as P[];
    expect(put.map((p) => p.id)).toEqual(["claude", "shell", "codex", "opencode", "antigravity", "meu-shell"]);
    expect(put[2]!.enabled).toBe(false);
    expect(put[5]).toMatchObject({ ...mine, builtin: false, available: true });
    await down(rt); rt = await boot();
    expect(((await api("GET", "/v1/presets")).json as P[]).map((p) => p.id)).toEqual(["claude", "shell", "codex", "opencode", "antigravity", "meu-shell"]); // sobreviveu
    const reset = (await api("POST", "/v1/presets/reset")).json as P[];
    expect(reset.map((p) => p.id)).toEqual(["shell", "claude", "codex", "opencode", "antigravity"]);
  }, 30_000);

  it("PUT rejeita id duplicado, id fora do padrão e comando vazio (400), sem tocar no que estava salvo", async () => {
    const d = (await api("GET", "/v1/presets")).json as P[];
    expect((await api("PUT", "/v1/presets", { presets: [strip(d[0]!), { ...strip(d[1]!), id: d[0]!.id }] })).status).toBe(400); // id duplicado
    expect((await api("PUT", "/v1/presets", { presets: [{ ...strip(d[0]!), id: "Com Espaço" }] })).status).toBe(400);
    expect((await api("PUT", "/v1/presets", { presets: [{ ...strip(d[0]!), command: "" }] })).status).toBe(400);
    expect(((await api("GET", "/v1/presets")).json as P[]).length).toBe(5);
  });

  it("aparência do terminal: criação com icon/color/termTheme; PATCH altera e null limpa; 'system' não é gravado", async () => {
    const ws = ((await api("POST", "/v1/workspaces", { name: "Ap", cwd: dir })).json as { workspaceId: string }).workspaceId;
    const r = (await api("POST", `/v1/workspaces/${ws}/nodes`, { expectedRevision: 0, kind: "terminal", title: "T", command: "/bin/sh", icon: "rocket", color: "#ef5350", termTheme: "dark", geometry: { x: 0, y: 0, w: 300, h: 200 } })).json as { node: { nodeId: string; icon?: string; color?: string; termTheme?: string }; revision: number };
    expect(r.node).toMatchObject({ icon: "rocket", color: "#ef5350", termTheme: "dark" });
    const p1 = (await api("PATCH", `/v1/nodes/${r.node.nodeId}`, { expectedRevision: r.revision, icon: "bug", termTheme: "light", color: "#5aa9ff" })).json as { icon?: string; termTheme?: string; color?: string };
    expect(p1).toMatchObject({ icon: "bug", termTheme: "light", color: "#5aa9ff" });
    const rev = ((await api("GET", `/v1/workspaces/${ws}`)).json as { workspace: { revision: number } }).workspace.revision;
    const p2 = (await api("PATCH", `/v1/nodes/${r.node.nodeId}`, { expectedRevision: rev, icon: null, termTheme: "system", color: null })).json as { icon?: string; termTheme?: string; color?: string };
    expect(p2.icon).toBeUndefined(); expect(p2.termTheme).toBeUndefined(); expect(p2.color).toBeUndefined();
    const rev2 = ((await api("GET", `/v1/workspaces/${ws}`)).json as { workspace: { revision: number } }).workspace.revision;
    expect((await api("PATCH", `/v1/nodes/${r.node.nodeId}`, { expectedRevision: rev2, termTheme: "neon" })).status).toBe(400); // tema fora do enum
  });
});
