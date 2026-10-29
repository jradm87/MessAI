import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const PORT = 47965;
const SOCK = `mess-test-${process.pid}`; // servidor tmux isolado (tmux -L): nunca toca no tmux pessoal do usuário
const tmux = (...a: string[]) => execFileSync("tmux", ["-L", SOCK, ...a], { stdio: "ignore" });
const hasTmux = (() => { try { execFileSync("tmux", ["-V"], { stdio: "ignore" }); return true; } catch { return false; } })();
let dir: string; let rt: ChildProcess | undefined; let token: string;
const api = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : null });
  return { status: r.status, json: r.status === 204 ? null : await r.json() };
};
const startRuntime = async () => {
  rt = spawn("node", [join(ROOT, "apps/runtime/dist/index.js")], { env: { ...process.env, MESS_DATA_DIR: dir, MESS_PORT: String(PORT), SHELL: "/bin/sh", MESS_TMUX_SOCKET: SOCK }, stdio: "ignore" });
  for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 200)); try { token = readFileSync(join(dir, "runtime.token"), "utf8").trim(); if ((await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: { authorization: `Bearer ${token}` } })).ok) return; } catch { /* subindo */ } }
  throw new Error("runtime não subiu");
};
const wait = async (pred: () => Promise<boolean>, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await pred()) return true; await new Promise((r) => setTimeout(r, 150)); } return false; };
const alive = (sid: string) => { try { tmux("has-session", "-t", `mess-${sid.slice(0, 12)}`); return true; } catch { return false; } };
/** Escreve no PTY pelo WebSocket (o runtime concede o lease quando livre). */
const typeInto = (sessionId: string, data: string) => new Promise<void>((res, rej) => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/v1/ws?token=${token}`);
  ws.onopen = () => { ws.send(JSON.stringify({ type: "attach", sessionId })); setTimeout(() => { ws.send(JSON.stringify({ type: "input", sessionId, data })); setTimeout(() => { ws.close(); res(); }, 300); }, 300); };
  ws.onerror = () => rej(new Error("ws"));
});

beforeAll(async () => { dir = mkdtempSync(join(tmpdir(), "mess-tmux-")); await startRuntime(); }, 30_000);
afterAll(() => { try { tmux("kill-server"); } catch { /* servidor de teste já encerrado */ } rt?.kill(); rmSync(dir, { recursive: true, force: true }); });

describe.skipIf(!hasTmux)("sessão persistente (tmux)", () => {
  let ws: string, sid: string, plainSid: string, nodeId: string;
  it("anuncia terminal.tmux e cria sessão persistente dentro do tmux com o ambiente do MessAI", async () => {
    expect(((await api("GET", "/v1/capabilities")).json as { features: string[] }).features).toContain("terminal.tmux");
    ws = ((await api("POST", "/v1/workspaces", { name: "T", cwd: dir })).json as { workspaceId: string }).workspaceId;
    const r = (await api("POST", `/v1/workspaces/${ws}/nodes`, { expectedRevision: 0, kind: "terminal", title: "P", command: "sh", geometry: { x: 0, y: 0, w: 400, h: 300 }, persistent: true })).json as { node: { nodeId: string }; session: { sessionId: string; persistent?: boolean } };
    sid = r.session.sessionId; nodeId = r.node.nodeId; expect(r.session.persistent).toBe(true);
    const p = (await api("POST", `/v1/workspaces/${ws}/nodes`, { expectedRevision: 1, kind: "terminal", title: "N", command: "sh", geometry: { x: 0, y: 0, w: 400, h: 300 } })).json as { session: { sessionId: string } };
    plainSid = p.session.sessionId;
    expect(await wait(async () => ((await api("GET", `/v1/sessions/${sid}`)).json as { state: string }).state === "running")).toBe(true);
    expect(await wait(async () => alive(sid))).toBe(true);
    await typeInto(sid, `echo "node=$MESS_NODE_ID" > ${dir}/env1.txt; MARK=42\n`);
    expect(await wait(async () => existsSync(join(dir, "env1.txt")))).toBe(true);
    expect(readFileSync(join(dir, "env1.txt"), "utf8").trim()).toBe(`node=${nodeId}`);
  });
  it("sobrevive à morte do runtime: o novo runtime reanexa com o estado do shell; a sessão comum vira lost", async () => {
    rt!.kill("SIGKILL"); await new Promise((r) => setTimeout(r, 400));
    await startRuntime();
    expect(await wait(async () => ((await api("GET", `/v1/sessions/${sid}`)).json as { state: string }).state === "running")).toBe(true);
    expect(((await api("GET", `/v1/sessions/${plainSid}`)).json as { state: string }).state).toBe("lost");
    await typeInto(sid, `echo "mark=$MARK" > ${dir}/env2.txt\n`);
    expect(await wait(async () => existsSync(join(dir, "env2.txt")))).toBe(true);
    expect(readFileSync(join(dir, "env2.txt"), "utf8").trim()).toBe("mark=42");
  });
  it("parar encerra também a sessão tmux; reiniciar cria outra; apagar o nó limpa", async () => {
    await api("POST", `/v1/sessions/${sid}/stop`);
    expect(await wait(async () => !alive(sid))).toBe(true);
    expect(await wait(async () => ((await api("GET", `/v1/sessions/${sid}`)).json as { state: string }).state === "exited")).toBe(true);
    await api("POST", `/v1/nodes/${nodeId}/restart`);
    expect(await wait(async () => ((await api("GET", `/v1/sessions/${sid}`)).json as { state: string }).state === "running" && alive(sid))).toBe(true);
    const rev = ((await api("GET", `/v1/workspaces/${ws}`)).json as { workspace: { revision: number } }).workspace.revision;
    await api("DELETE", `/v1/nodes/${nodeId}`, { expectedRevision: rev });
    expect(await wait(async () => !alive(sid))).toBe(true);
  });
});
