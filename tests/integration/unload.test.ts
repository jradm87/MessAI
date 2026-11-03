import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Session, Workspace, WorkspaceSnapshot } from "@messai/contracts";

const ROOT = join(import.meta.dirname, "../..");
const PORT = 48030;
let dir: string;
let wsDir: string;
let rt: ChildProcess;
let token: string;

const api = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : null,
  });
  return { status: r.status, json: r.status === 204 ? null : await r.json() };
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "mess-unload-"));
  wsDir = join(dir, "proj");
  mkdirSync(wsDir);
  rt = spawn("node", [join(ROOT, "apps/runtime/dist/index.js")], {
    env: { ...process.env, MESS_DATA_DIR: dir, MESS_PORT: String(PORT), SHELL: "/bin/sh" },
    stdio: "ignore",
  });
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 200));
    try {
      token = readFileSync(join(dir, "runtime.token"), "utf8").trim();
      if ((await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: { authorization: `Bearer ${token}` } })).ok) break;
    } catch { /* subindo */ }
  }
}, 30_000);

afterAll(() => {
  rt?.kill();
  rmSync(dir, { recursive: true, force: true });
});

describe("Descarregar e recarregar espaços e terminais (#84)", () => {
  it("descarrega e recarrega um nó individual preservando sessionId", async () => {
    const ws = (await api("POST", "/v1/workspaces", { name: "UnloadNodeWs", cwd: wsDir })).json as Workspace;
    const created = (await api("POST", `/v1/workspaces/${ws.workspaceId}/nodes`, {
      expectedRevision: ws.revision,
      kind: "terminal",
      title: "Worker",
      geometry: { x: 10, y: 10, w: 600, h: 360 },
    })).json as { node: { nodeId: string; sessionId: string }; session: Session };

    expect(created.session.state).toBe("running");

    const unloaded = (await api("POST", `/v1/nodes/${created.node.nodeId}/unload`)).json as Session;
    expect(unloaded.state).toBe("unloaded");
    expect(unloaded.sessionId).toBe(created.session.sessionId);

    const reloaded = (await api("POST", `/v1/nodes/${created.node.nodeId}/reload`)).json as Session;
    expect(reloaded.state).toBe("running");
    expect(reloaded.sessionId).toBe(created.session.sessionId);
    expect(reloaded.pid).toBeGreaterThan(0);
  });

  it("descarrega e recarrega um espaço inteiro, persiste RuntimeSettings e funciona via CLI mess unload/reload", async () => {
    const ws = (await api("POST", "/v1/workspaces", { name: "UnloadWs", cwd: wsDir })).json as Workspace;
    const created = (await api("POST", `/v1/workspaces/${ws.workspaceId}/nodes`, {
      expectedRevision: ws.revision,
      kind: "terminal",
      title: "T1",
      geometry: { x: 10, y: 10, w: 600, h: 360 },
    })).json as { node: { nodeId: string }; session: Session };

    const uRes = (await api("POST", `/v1/workspaces/${ws.workspaceId}/unload`)).json as { workspace: Workspace; unloadedCount: number };
    expect(uRes.unloadedCount).toBe(1);
    expect(uRes.workspace.unloaded).toBe(true);

    const snap1 = (await api("GET", `/v1/workspaces/${ws.workspaceId}`)).json as WorkspaceSnapshot;
    expect(snap1.workspace.unloaded).toBe(true);
    const s1 = (await api("GET", `/v1/sessions/${created.session.sessionId}`)).json as Session;
    expect(s1.state).toBe("unloaded");

    // Recarrega via CLI mess reload --workspace
    const cliEnv = {
      ...process.env,
      MESS_SOCKET: join(dir, "agent.sock"),
      MESS_TOKEN: token,
      MESS_WORKSPACE_ID: ws.workspaceId,
      MESS_NODE_ID: created.node.nodeId,
    };
    const outReload = execFileSync("node", [join(ROOT, "apps/cli/dist/index.js"), "reload", "--workspace"], { env: cliEnv, encoding: "utf8" });
    expect(outReload).toContain("recarregado");

    const snap2 = (await api("GET", `/v1/workspaces/${ws.workspaceId}`)).json as WorkspaceSnapshot;
    expect(Boolean(snap2.workspace.unloaded)).toBe(false);
    const s2 = (await api("GET", `/v1/sessions/${created.session.sessionId}`)).json as Session;
    expect(s2.state).toBe("running");

    const st = (await api("PATCH", "/v1/settings", { autoUnloadMinutes: 30, reloadOnSelect: false })).json as { autoUnloadMinutes: number; reloadOnSelect: boolean };
    expect(st.autoUnloadMinutes).toBe(30);
    expect(st.reloadOnSelect).toBe(false);
  });
});
