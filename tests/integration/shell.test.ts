import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const PORT = 47969;
let dir: string; let rt: ChildProcess; let token: string;
const api = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : null });
  return { status: r.status, json: r.status === 204 ? null : await r.json() };
};
const wait = async (pred: () => Promise<boolean>, ms = 6000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await pred()) return true; await new Promise((r) => setTimeout(r, 120)); } return false; };
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "messy-shell-"));
  // MESSY_SHELL força o shell padrão (o usuário pode trocar assim)
  rt = spawn("node", [join(ROOT, "apps/runtime/dist/index.js")], { env: { ...process.env, MESSY_DATA_DIR: dir, MESSY_PORT: String(PORT), MESSY_SHELL: "/bin/sh" }, stdio: "ignore" });
  for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 200)); try { token = readFileSync(join(dir, "runtime.token"), "utf8").trim(); if ((await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: { authorization: `Bearer ${token}` } })).ok) break; } catch { /* subindo */ } }
}, 30_000);
afterAll(() => { rt?.kill(); rmSync(dir, { recursive: true, force: true }); });

describe("shell padrão do PC", () => {
  it("o preset Shell e o terminal sem comando usam MESSY_SHELL", async () => {
    const shell = ((await api("GET", "/v1/presets")).json as { id: string; command: string }[]).find((p) => p.id === "shell")!;
    expect(shell.command).toBe("/bin/sh");
    const ws = ((await api("POST", "/v1/workspaces", { name: "S", cwd: dir })).json as { workspaceId: string }).workspaceId;
    // terminal sem comando => usa o shell padrão; grava $0 e $SHELL para provar
    const out = join(dir, "shell.txt");
    const r = (await api("POST", `/v1/workspaces/${ws}/nodes`, { expectedRevision: 0, kind: "terminal", title: "T", geometry: { x: 0, y: 0, w: 300, h: 200 } })).json as { session: { sessionId: string; command: string } };
    expect(r.session.command).toBe("/bin/sh");
    // envia um comando pelo WS e confere que $SHELL no ambiente é o padrão
    await new Promise<void>((res) => { const ws2 = new WebSocket(`ws://127.0.0.1:${PORT}/v1/ws?token=${token}`); ws2.onopen = () => { ws2.send(JSON.stringify({ type: "attach", sessionId: r.session.sessionId })); setTimeout(() => { ws2.send(JSON.stringify({ type: "input", sessionId: r.session.sessionId, data: `printf '%s' "$SHELL" > ${out}\n` })); setTimeout(() => { ws2.close(); res(); }, 400); }, 400); }; });
    expect(await wait(async () => existsSync(out))).toBe(true);
    expect(readFileSync(out, "utf8")).toBe("/bin/sh");
  });
});
