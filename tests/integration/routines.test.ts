import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Routine, RoutineRunResult, Session, Workspace } from "@messai/contracts";

const ROOT = join(import.meta.dirname, "../..");
const PORT = 48034;
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
  dir = mkdtempSync(join(tmpdir(), "mess-routines-"));
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

describe("Rotinas: comandos agendados e recorrentes (#27)", () => {
  it("cria e executa rotina de comando shell com variáveis de ambiente do espaço e via CLI mess routine", async () => {
    const ws = (await api("POST", "/v1/workspaces", { name: "RoutineWs", cwd: wsDir })).json as Workspace;
    await api("PUT", `/v1/workspaces/${ws.workspaceId}/env`, {
      vars: [{ key: "ROUTINE_TAG", value: "v27" }],
    });

    const r = (await api("POST", `/v1/workspaces/${ws.workspaceId}/routines`, {
      name: "Echo Tag",
      actionType: "command",
      payload: "echo tag:$ROUTINE_TAG",
      scheduleType: "interval",
      intervalSeconds: 120,
    })).json as Routine;
    expect(r.name).toBe("Echo Tag");

    const runRes = (await api("POST", `/v1/routines/${r.routineId}/run`)).json as RoutineRunResult;
    expect(runRes.status).toBe("ok");
    expect(runRes.output).toContain("tag:v27");
    expect(runRes.routine.runCount).toBe(1);

    // CLI mess routine list / disable / delete
    const cliEnv = {
      ...process.env,
      MESS_SOCKET: join(dir, "agent.sock"),
      MESS_TOKEN: token,
      MESS_WORKSPACE_ID: ws.workspaceId,
    };
    const outList = execFileSync("node", [join(ROOT, "apps/cli/dist/index.js"), "routine", "list"], { env: cliEnv, encoding: "utf8" });
    expect(outList).toContain("Echo Tag");
  });

  it("acorda terminal descarregado (wakeIfUnloaded) quando uma rotina do tipo prompt é executada", async () => {
    const ws = (await api("POST", "/v1/workspaces", { name: "WakeWs", cwd: wsDir })).json as Workspace;
    const created = (await api("POST", `/v1/workspaces/${ws.workspaceId}/nodes`, {
      expectedRevision: ws.revision,
      kind: "terminal",
      title: "SleepingAgent",
      geometry: { x: 10, y: 10, w: 600, h: 360 },
    })).json as { node: { nodeId: string }; session: Session };

    // Descarrega o terminal
    const u = (await api("POST", `/v1/nodes/${created.node.nodeId}/unload`)).json as Session;
    expect(u.state).toBe("unloaded");

    // Cria rotina de prompt apontando para o terminal descarregado
    const r = (await api("POST", `/v1/workspaces/${ws.workspaceId}/routines`, {
      name: "Wake Prompt",
      actionType: "prompt",
      targetNodeId: created.node.nodeId,
      payload: "echo AWAKE_FROM_ROUTINE",
      scheduleType: "once",
      intervalSeconds: 60,
      wakeIfUnloaded: true,
    })).json as Routine;

    const runRes = (await api("POST", `/v1/routines/${r.routineId}/run`)).json as RoutineRunResult;
    expect(runRes.status).toBe("ok");
    expect(runRes.routine.enabled).toBe(false); // scheduleType="once" desabilita após rodar

    const afterSess = (await api("GET", `/v1/sessions/${created.session.sessionId}`)).json as Session;
    expect(afterSess.state).toBe("running");
  });
});
