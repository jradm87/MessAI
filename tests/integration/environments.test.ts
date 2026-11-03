import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EnvVarEntry, Workspace } from "@messai/contracts";

const ROOT = join(import.meta.dirname, "../..");
const PORT = 48026;
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
  dir = mkdtempSync(join(tmpdir(), "mess-env-"));
  wsDir = join(dir, "ws");
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

describe("Ambientes: variáveis de ambiente por espaço/global (#72)", () => {
  let ws: Workspace;

  it("persiste variáveis globais e por espaço, marca segredos automaticamente e rejeita prefixo MESS_", async () => {
    ws = (await api("POST", "/v1/workspaces", { name: "EnvSpace", cwd: wsDir })).json as Workspace;

    const bad = await api("PUT", "/v1/environments/global", {
      vars: [{ key: "MESS_TOKEN", value: "spoof" }],
    });
    expect(bad.status).toBe(400);

    const gRes = await api("PUT", "/v1/environments/global", {
      vars: [
        { key: "GLOBAL_URL", value: "https://api.global" },
        { key: "SHARED_MODE", value: "from-global" },
        { key: "OPENAI_API_KEY", value: "sk-secret-123" },
      ],
    });
    expect(gRes.status).toBe(200);
    const gVars = gRes.json as EnvVarEntry[];
    expect(gVars.find((v) => v.key === "OPENAI_API_KEY")?.secret).toBe(true);

    const wRes = await api("PUT", `/v1/workspaces/${ws.workspaceId}/env`, {
      vars: [
        { key: "SHARED_MODE", value: "from-workspace" },
        { key: "WS_ONLY", value: "ok-ws" },
      ],
    });
    expect(wRes.status).toBe(200);
  });

  it("injeta o ambiente mesclado (global + espaço) na criação do terminal e aplica mudanças sem recriar o espaço", async () => {
    const out1 = join(wsDir, "env1.txt");
    const snap1 = (await api("GET", `/v1/workspaces/${ws.workspaceId}`)).json as { workspace: Workspace };
    const create1 = await api("POST", `/v1/workspaces/${ws.workspaceId}/nodes`, {
      expectedRevision: snap1.workspace.revision,
      kind: "terminal",
      title: "EnvProbe1",
      geometry: { x: 40, y: 40, w: 300, h: 200 },
      command: "/bin/sh",
      args: ["-c", `printf "%s|%s|%s|%s" "$GLOBAL_URL" "$SHARED_MODE" "$WS_ONLY" "$OPENAI_API_KEY" > "${out1}"`],
    });
    expect(create1.status).toBe(201);

    for (let i = 0; i < 30 && !existsSync(out1); i++) await new Promise((r) => setTimeout(r, 100));
    expect(readFileSync(out1, "utf8")).toBe("https://api.global|from-workspace|ok-ws|sk-secret-123");

    // Atualiza variável do espaço sem recriar o espaço; vale no próximo terminal
    await api("PUT", `/v1/workspaces/${ws.workspaceId}/env`, {
      vars: [
        { key: "SHARED_MODE", value: "updated-live" },
        { key: "WS_ONLY", value: "ok-ws-2" },
      ],
    });

    const out2 = join(wsDir, "env2.txt");
    const snap2 = (await api("GET", `/v1/workspaces/${ws.workspaceId}`)).json as { workspace: Workspace };
    await api("POST", `/v1/workspaces/${ws.workspaceId}/nodes`, {
      expectedRevision: snap2.workspace.revision,
      kind: "terminal",
      title: "EnvProbe2",
      geometry: { x: 380, y: 40, w: 300, h: 200 },
      command: "/bin/sh",
      args: ["-c", `printf "%s|%s" "$SHARED_MODE" "$WS_ONLY" > "${out2}"`],
    });

    for (let i = 0; i < 30 && !existsSync(out2); i++) await new Promise((r) => setTimeout(r, 100));
    expect(readFileSync(out2, "utf8")).toBe("updated-live|ok-ws-2");
  });

  it("suporta `mess env list|set|unset` pelo CLI com mascaramento de segredos", () => {
    const cli = join(ROOT, "apps/cli/dist/index.js");
    const envCli = {
      ...process.env,
      MESS_SOCKET: join(dir, "agent.sock"),
      MESS_TOKEN: token,
      MESS_WORKSPACE_ID: ws.workspaceId,
    };

    const gMasked = execFileSync("node", [cli, "env", "list", "--global"], { encoding: "utf8", env: envCli }).trim();
    expect(gMasked).toContain("OPENAI_API_KEY=••••••••  (secreto)");
    expect(gMasked).not.toContain("sk-secret-123");

    const gRevealed = execFileSync("node", [cli, "env", "list", "--global", "--reveal"], { encoding: "utf8", env: envCli }).trim();
    expect(gRevealed).toContain("OPENAI_API_KEY=sk-secret-123  (secreto)");

    execFileSync("node", [cli, "env", "set", "CLI_ADDED=valor_cli"], { encoding: "utf8", env: envCli });
    const wList = execFileSync("node", [cli, "env", "list"], { encoding: "utf8", env: envCli }).trim();
    expect(wList).toContain("CLI_ADDED=valor_cli");

    execFileSync("node", [cli, "env", "unset", "CLI_ADDED"], { encoding: "utf8", env: envCli });
    const wListAfter = execFileSync("node", [cli, "env", "list"], { encoding: "utf8", env: envCli }).trim();
    expect(wListAfter).not.toContain("CLI_ADDED");
  });
});
