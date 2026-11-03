import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NotificationItem, Workspace } from "@messai/contracts";

const ROOT = join(import.meta.dirname, "../..");
const PORT = 48032;
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
  dir = mkdtempSync(join(tmpdir(), "mess-notify-"));
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

describe("Notificações do SO e mess notify (#85)", () => {
  it("emite notificações via POST /v1/notify, CLI mess notify e mudança de status de andar", async () => {
    const ws = (await api("POST", "/v1/workspaces", { name: "NotifyWs", cwd: wsDir })).json as Workspace;
    const created = (await api("POST", `/v1/workspaces/${ws.workspaceId}/nodes`, {
      expectedRevision: ws.revision,
      kind: "terminal",
      title: "Builder",
      geometry: { x: 10, y: 10, w: 600, h: 360 },
    })).json as { node: { nodeId: string } };

    // 1. POST /v1/notify direto
    const n1 = (await api("POST", "/v1/notify", {
      text: "Deploy finalizado!",
      title: "CI Bot",
      workspaceId: ws.workspaceId,
      nodeId: created.node.nodeId,
    })).json as NotificationItem;
    expect(n1.kind).toBe("notify");
    expect(n1.title).toBe("CI Bot");
    expect(n1.body).toBe("Deploy finalizado!");

    // 2. CLI mess notify
    const cliEnv = {
      ...process.env,
      MESS_SOCKET: join(dir, "agent.sock"),
      MESS_TOKEN: token,
      MESS_WORKSPACE_ID: ws.workspaceId,
      MESS_NODE_ID: created.node.nodeId,
    };
    const out = execFileSync("node", [join(ROOT, "apps/cli/dist/index.js"), "notify", "Testes", "passaram", "--title", "Runner"], {
      env: cliEnv,
      encoding: "utf8",
    });
    expect(out).toContain("notificação enviada");

    // 3. Mudança de status de espaço/andar gera notificação kind="floor"
    const curWs = (await api("GET", `/v1/workspaces/${ws.workspaceId}`)).json as { workspace: Workspace };
    await api("PATCH", `/v1/workspaces/${ws.workspaceId}`, {
      expectedRevision: curWs.workspace.revision,
      status: "review",
      statusText: "PR pronto",
    });

    const list = (await api("GET", "/v1/notifications")).json as NotificationItem[];
    expect(list.some((x) => x.kind === "floor" && x.body.includes("PR pronto"))).toBe(true);
    expect(list.some((x) => x.kind === "notify" && x.title === "Runner" && x.body === "Testes passaram")).toBe(true);
  });
});
