import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EnvVarEntry, Role, Skill, Workspace, WorkspaceBundle, WorkspaceBundlePreview, WorkspaceSnapshot } from "@messai/contracts";

const ROOT = join(import.meta.dirname, "../..");
const PORT = 48028;
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
  dir = mkdtempSync(join(tmpdir(), "mess-ws-xfer-"));
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

describe("Exportar/importar espaço (.messai) e duplicar (#83)", () => {
  let srcWs: Workspace;
  let bundle: WorkspaceBundle;

  it("exporta um espaço completo (nós, conexões, grupos, bandas, papéis, skills e variáveis) para formato .messai", async () => {
    srcWs = (await api("POST", "/v1/workspaces", { name: "OrigSpace", cwd: wsDir, icon: "code", color: "#5aa9ff" })).json as Workspace;
    const role = (await api("POST", "/v1/roles", { name: "ReviewerX", badge: "RX", instructions: "Revise tudo." })).json as Role;
    const skill = (await api("POST", "/v1/skills", { name: "RustSkill", description: "Rust", instructions: "Cargo check" })).json as Skill;

    await api("PUT", `/v1/workspaces/${srcWs.workspaceId}/env`, {
      vars: [{ key: "APP_ENV", value: "staging" }, { key: "API_SECRET", value: "s3cr3t", secret: true }],
    });

    let rev = 0;
    const n1 = (await api("POST", `/v1/workspaces/${srcWs.workspaceId}/nodes`, {
      expectedRevision: rev,
      kind: "note",
      title: "Arquitetura",
      geometry: { x: 40, y: 40, w: 280, h: 180 },
      content: "# Arquitetura\nDetalhes do projeto",
    })).json as { node: { nodeId: string }; revision: number };
    rev = n1.revision;

    const n2 = (await api("POST", `/v1/workspaces/${srcWs.workspaceId}/nodes`, {
      expectedRevision: rev,
      kind: "terminal",
      title: "Agente1",
      geometry: { x: 380, y: 40, w: 320, h: 220 },
      command: "/bin/sh",
      roleId: role.roleId,
      skillIds: [skill.skillId],
    })).json as { node: { nodeId: string }; revision: number };
    rev = n2.revision;

    await api("POST", `/v1/workspaces/${srcWs.workspaceId}/connections`, {
      expectedRevision: rev,
      sourceNodeId: n1.node.nodeId,
      targetNodeId: n2.node.nodeId,
      label: "contexto",
    });
    rev++;

    await api("POST", `/v1/workspaces/${srcWs.workspaceId}/groups`, {
      expectedRevision: rev,
      nodeIds: [n1.node.nodeId, n2.node.nodeId],
      label: "Bloco Principal",
      color: "#4cd964",
    });

    await api("POST", `/v1/workspaces/${srcWs.workspaceId}/bands`, {
      name: "CoreTeam",
      nodeIds: [n2.node.nodeId],
    });

    const expRes = await api("GET", `/v1/workspaces/${srcWs.workspaceId}/export`);
    expect(expRes.status).toBe(200);
    bundle = expRes.json as WorkspaceBundle;
    expect(bundle.format).toBe("messai.workspace.v1");
    expect(bundle.nodes.length).toBe(2);
    expect(bundle.connections.length).toBe(1);
    expect(bundle.groups.length).toBe(1);
    expect(bundle.bands.length).toBe(1);
    expect(bundle.roles.map((r) => r.name)).toContain("ReviewerX");
    expect(bundle.skills.map((s) => s.name)).toContain("RustSkill");
    expect(bundle.envVars.length).toBe(2);
  });

  it("gera preview de revisão antes de importar e importa o pacote recriando papéis/skills/nós/conexões", async () => {
    // Apaga o papel e a skill para provar que o import os recria em outra máquina/conta
    const roles = (await api("GET", "/v1/roles")).json as Role[];
    for (const r of roles) await api("DELETE", `/v1/roles/${r.roleId}`);
    const skills = (await api("GET", "/v1/skills")).json as Skill[];
    for (const s of skills) await api("DELETE", `/v1/skills/${s.skillId}`);

    const prevRes = await api("POST", "/v1/workspaces/import/preview", { bundle });
    expect(prevRes.status).toBe(200);
    const prev = prevRes.json as WorkspaceBundlePreview;
    expect(prev.valid).toBe(true);
    expect(prev.counts.nodes).toBe(2);
    expect(prev.counts.terminals).toBe(1);
    expect(prev.counts.notes).toBe(1);
    expect(prev.counts.connections).toBe(1);
    expect(prev.counts.groups).toBe(1);
    expect(prev.counts.bands).toBe(1);
    expect(prev.counts.envVars).toBe(2);
    expect(prev.counts.secrets).toBe(1);

    const impRes = await api("POST", "/v1/workspaces/import", {
      bundle,
      name: "ImportedSpace",
      cwd: wsDir,
      includeEnv: true,
    });
    expect(impRes.status).toBe(201);
    const impWs = impRes.json as Workspace;
    expect(impWs.name).toBe("ImportedSpace");

    const snap = (await api("GET", `/v1/workspaces/${impWs.workspaceId}`)).json as WorkspaceSnapshot;
    expect(snap.nodes.length).toBe(2);
    expect(snap.connections.length).toBe(1);
    expect(snap.groups?.length).toBe(1);
    expect(snap.bands?.length).toBe(1);

    const envVars = (await api("GET", `/v1/workspaces/${impWs.workspaceId}/env`)).json as EnvVarEntry[];
    expect(envVars.map((v) => v.key)).toEqual(["APP_ENV", "API_SECRET"]);
  });

  it("duplica um espaço como ponto de partida e suporta `mess workspace export|preview|import|duplicate` pelo CLI", async () => {
    const dupRes = await api("POST", `/v1/workspaces/${srcWs.workspaceId}/duplicate`, {
      name: "OrigSpace Dup",
    });
    expect(dupRes.status).toBe(201);
    const dupWs = dupRes.json as Workspace;
    expect(dupWs.name).toBe("OrigSpace Dup");

    const snap = (await api("GET", `/v1/workspaces/${dupWs.workspaceId}`)).json as WorkspaceSnapshot;
    expect(snap.nodes.length).toBe(2);
    expect(snap.connections.length).toBe(1);

    const cli = join(ROOT, "apps/cli/dist/index.js");
    const file = join(dir, "exportado.messai");
    const envCli = {
      ...process.env,
      MESS_SOCKET: join(dir, "agent.sock"),
      MESS_TOKEN: token,
      MESS_WORKSPACE_ID: srcWs.workspaceId,
    };
    const outExp = execFileSync("node", [cli, "workspace", "export", file], { encoding: "utf8", env: envCli }).trim();
    expect(outExp).toContain("2 nós");

    const outPrev = execFileSync("node", [cli, "workspace", "preview", file], { encoding: "utf8", env: envCli }).trim();
    expect(outPrev).toContain("2 nós (1 terminais, 1 notas)");
  });
});
