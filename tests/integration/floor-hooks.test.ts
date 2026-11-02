import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import type { FloorHooksState, Workspace, WsServerMessage } from "@messai/contracts";

const ROOT = join(import.meta.dirname, "../..");
const PORT = 48018;
let dir: string; let repo: string; let rt: ChildProcess; let token: string;
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const git = (...a: string[]) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", env: GIT_ENV }).trim();
const api = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : null });
  return { status: r.status, json: r.status === 204 ? null : await r.json() };
};
const wait = async (pred: () => Promise<boolean>, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await pred()) return true; await new Promise((r) => setTimeout(r, 100)); } return false; };

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "mess-floor-hooks-")); repo = join(dir, "repo"); mkdirSync(repo);
  git("init", "-q", "-b", "main"); writeFileSync(join(repo, "README.md"), "# projeto\n"); git("add", "."); git("commit", "-q", "-m", "inicial");
  rt = spawn("node", [join(ROOT, "apps/runtime/dist/index.js")], { env: { ...GIT_ENV, MESS_DATA_DIR: dir, MESS_PORT: String(PORT), SHELL: "/bin/sh" }, stdio: "ignore" });
  for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 200)); try { token = readFileSync(join(dir, "runtime.token"), "utf8").trim(); if ((await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: { authorization: `Bearer ${token}` } })).ok) break; } catch { /* subindo */ } }
}, 30_000);
afterAll(() => { rt?.kill(); rmSync(dir, { recursive: true, force: true }); });

describe("Hooks de andar (#75)", () => {
  let ground: string, floor: Workspace;
  let teardownFile: string;

  it("herda hooks do térreo, roda setup automaticamente ao criar o andar com MESS_FLOOR_* e transmite logs ao vivo", async () => {
    teardownFile = join(dir, "teardown-ran.txt");
    ground = ((await api("POST", "/v1/workspaces", { name: "App", cwd: repo })).json as Workspace).workspaceId;

    const put = await api("PUT", `/v1/workspaces/${ground}/hooks`, {
      setup: 'printf "SETUP:%s|%s|%s|%s|%s\\n" "$MESS_FLOOR_NAME" "$MESS_FLOOR_BRANCH" "$MESS_FLOOR_PATH" "$MESS_ROOT_PATH" "$MESS_HOOK_SECTION"',
      run: 'echo "RUN_INICIADO"; sleep 20',
      teardown: `printf "%s|%s" "$MESS_FLOOR_NAME" "$MESS_HOOK_SECTION" > "${teardownFile}"`,
    });
    expect(put.status).toBe(200);

    const events: WsServerMessage[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/v1/ws?token=${encodeURIComponent(token)}`);
    await new Promise<void>((res) => ws.on("open", () => res()));
    ws.on("message", (raw) => { events.push(JSON.parse(String(raw)) as WsServerMessage); });

    const r = await api("POST", `/v1/workspaces/${ground}/floors`, { name: "Auth Flow" });
    expect(r.status).toBe(201);
    floor = r.json as Workspace;

    expect(await wait(async () => {
      const h = (await api("GET", `/v1/workspaces/${floor.workspaceId}/hooks`)).json as FloorHooksState;
      return h.status.setup.state === "succeeded";
    })).toBe(true);

    const h = (await api("GET", `/v1/workspaces/${floor.workspaceId}/hooks`)).json as FloorHooksState;
    expect(h.status.setup.log.trim()).toBe(`SETUP:Auth Flow|auth-flow|${floor.cwd}|${repo}|setup`);
    expect(events.some((e) => e.type === "floorHook" && e.workspaceId === floor.workspaceId && e.status.section === "setup")).toBe(true);
    ws.close();
  });

  it("roda a seção run sob demanda, transmite saída ao vivo e permite parar o processo", async () => {
    const runRes = await api("POST", `/v1/workspaces/${floor.workspaceId}/hooks/run`, { section: "run" });
    expect(runRes.status).toBe(200);
    expect((runRes.json as FloorHooksState).status.run.state).toBe("running");

    expect(await wait(async () => {
      const h = (await api("GET", `/v1/workspaces/${floor.workspaceId}/hooks`)).json as FloorHooksState;
      return h.status.run.log.includes("RUN_INICIADO");
    })).toBe(true);

    const stopRes = await api("POST", `/v1/workspaces/${floor.workspaceId}/hooks/stop`, { section: "run" });
    expect(stopRes.status).toBe(200);
    expect((stopRes.json as FloorHooksState).status.run.state).toBe("stopped");
  });

  it("CLI mess floor hooks lista, altera e roda seção", async () => {
    const outFile = join(dir, "cli-hooks.txt");
    const r = await api("POST", `/v1/workspaces/${floor.workspaceId}/nodes`, {
      expectedRevision: 0, kind: "terminal", title: "HookCLI", command: "sh",
      args: ["-c", `mess floor hooks set run 'echo CLI_RUN_OK' && mess floor hooks run run > "${outFile}"`],
      geometry: { x: 0, y: 0, w: 300, h: 200 },
    });
    expect(r.status).toBe(201);
    expect(await wait(async () => existsSync(outFile) && readFileSync(outFile, "utf8").includes("CLI_RUN_OK"))).toBe(true);
  });

  it("executa teardown automaticamente ao remover o andar", async () => {
    const del = await api("DELETE", `/v1/workspaces/${floor.workspaceId}`);
    expect(del.status).toBe(204);
    expect(existsSync(teardownFile)).toBe(true);
    expect(readFileSync(teardownFile, "utf8")).toBe("Auth Flow|teardown");
  });
});
