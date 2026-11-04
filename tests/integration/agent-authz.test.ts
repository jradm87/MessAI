import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTokenInfo, Node, Session, Workspace, WorkspaceSnapshot } from "@messai/contracts";

// #87 [MESS-02] — credencial por agente + autorização por capacidade no runtime.
const ROOT = join(import.meta.dirname, "../..");
const PORT = 48038;
let dir: string;
let wsDir: string;
let otherDir: string;
let rt: ChildProcess;
let token: string;

const call = async (tok: string, method: string, path: string, body?: unknown) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method,
    headers: { authorization: `Bearer ${tok}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : null,
  });
  const text = await r.text();
  return { status: r.status, json: text ? JSON.parse(text) : null };
};
const api = (method: string, path: string, body?: unknown) => call(token, method, path, body);
const rev = async (ws: string) => ((await api("GET", `/v1/workspaces/${ws}`)).json as WorkspaceSnapshot).workspace.revision;
const waitFor = async (f: () => boolean, ms = 6000) => { for (let i = 0; i < ms / 100 && !f(); i++) await new Promise((r) => setTimeout(r, 100)); };

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "mess-authz-"));
  wsDir = join(dir, "proj"); mkdirSync(wsDir);
  otherDir = join(dir, "other"); mkdirSync(otherDir);
  writeFileSync(join(wsDir, "leia.txt"), "conteudo");
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

describe("Credencial por agente + autorização por capacidade (#87)", () => {
  let ws: Workspace;
  let other: Workspace;
  let agent: Node;
  let peer: Node;

  it("cada terminal recebe MESS_TOKEN próprio (≠ token mestre) que autentica como agente", async () => {
    ws = (await api("POST", "/v1/workspaces", { name: "Authz", cwd: wsDir })).json as Workspace;
    other = (await api("POST", "/v1/workspaces", { name: "Outro", cwd: otherDir })).json as Workspace;
    const out = join(wsDir, "tok.txt");
    const made = await api("POST", `/v1/workspaces/${ws.workspaceId}/nodes`, {
      expectedRevision: await rev(ws.workspaceId), kind: "terminal", title: "Agente",
      geometry: { x: 0, y: 0, w: 400, h: 300 }, command: "/bin/sh", args: ["-c", `printf %s "$MESS_TOKEN" > "${out}"; sleep 60`],
    });
    expect(made.status).toBe(201);
    agent = (made.json as { node: Node }).node;
    await waitFor(() => existsSync(out) && readFileSync(out, "utf8").length > 0);
    const envTok = readFileSync(out, "utf8");
    expect(envTok).toMatch(/^agt_/);
    expect(envTok).not.toBe(token);
    // o token do env funciona para leitura do próprio espaço
    expect((await call(envTok, "GET", `/v1/workspaces/${ws.workspaceId}`)).status).toBe(200);
    // e o token mestre não aparece em lugar nenhum do env
    expect(readFileSync(out, "utf8")).not.toContain(token);
  });

  it("credencial somente leitura lê arquivos/nós mas recebe 403 ao escrever, controlar terminais, gerir o espaço ou rotas do app", async () => {
    const p = await api("POST", `/v1/workspaces/${ws.workspaceId}/nodes`, {
      expectedRevision: await rev(ws.workspaceId), kind: "terminal", title: "Par", geometry: { x: 500, y: 0, w: 400, h: 300 }, command: "/bin/sh", args: ["-c", "sleep 60"],
    });
    peer = (p.json as { node: Node; session: Session }).node;
    const issued = await api("POST", `/v1/nodes/${agent.nodeId}/token`, { capabilities: ["files:read", "nodes:read"] });
    expect(issued.status).toBe(201);
    const info = issued.json as AgentTokenInfo;
    expect(info.capabilities.sort()).toEqual(["files:read", "nodes:read"]);
    const ro = info.token;

    // permitido
    expect((await call(ro, "GET", `/v1/workspaces/${ws.workspaceId}/file?path=leia.txt`)).json.text).toBe("conteudo");
    expect((await call(ro, "GET", `/v1/workspaces/${ws.workspaceId}`)).status).toBe(200);
    expect((await call(ro, "GET", `/v1/workspaces/${ws.workspaceId}/tree`)).status).toBe(200);

    // negado por capacidade
    const deny = async (method: string, path: string, body?: unknown) => {
      const r = await call(ro, method, path, body);
      expect(r.status, `${method} ${path}`).toBe(403);
      expect(r.json.error.code).toBe("FORBIDDEN");
    };
    await deny("POST", `/v1/workspaces/${ws.workspaceId}/fs`, { op: "write", path: "x.txt", text: "x" });
    await deny("POST", `/v1/workspaces/${ws.workspaceId}/fs`, { op: "delete", path: "leia.txt" });
    await deny("POST", `/v1/sessions/${peer.sessionId}/stop`);
    await deny("POST", `/v1/nodes/${peer.nodeId}/restart`);
    await deny("PATCH", `/v1/workspaces/${ws.workspaceId}`, { expectedRevision: await rev(ws.workspaceId), name: "hack" });
    await deny("DELETE", `/v1/workspaces/${ws.workspaceId}`);
    await deny("POST", `/v1/nodes/${agent.nodeId}/chat`, { text: "oi" });
    // rotas reservadas ao app
    await deny("GET", "/v1/settings");
    await deny("GET", "/v1/environments/global");
    await deny("POST", `/v1/nodes/${agent.nodeId}/token`, { capabilities: ["files:write"] });
    await deny("POST", "/v1/shutdown");
    expect(existsSync(join(wsDir, "leia.txt"))).toBe(true);
    expect(existsSync(join(wsDir, "x.txt"))).toBe(false);
  });

  it("credencial padrão: escreve no próprio espaço, mas não fora do escopo nem em nome de outro nó", async () => {
    const full = (await api("POST", `/v1/nodes/${agent.nodeId}/token`, { capabilities: ["files:read", "files:write", "chat:post", "nodes:read", "nodes:write", "messages:send", "workspace:manage", "terminal:control"] })).json as AgentTokenInfo;
    expect((await call(full.token, "POST", `/v1/workspaces/${ws.workspaceId}/fs`, { op: "write", path: "ok.txt", text: "ok" })).status).toBe(200);
    expect((await call(full.token, "POST", `/v1/nodes/${agent.nodeId}/chat`, { text: "oi" })).status).toBe(201);
    // outro espaço (outro térreo): fora do escopo
    expect((await call(full.token, "GET", `/v1/workspaces/${other.workspaceId}/tree`)).status).toBe(403);
    expect((await call(full.token, "POST", `/v1/workspaces/${other.workspaceId}/fs`, { op: "write", path: "x.txt", text: "x" })).status).toBe(403);
    // falar em nome de outro nó
    expect((await call(full.token, "POST", `/v1/nodes/${peer.nodeId}/chat`, { text: "spoof" })).status).toBe(403);
    expect((await call(full.token, "POST", `/v1/nodes/${peer.nodeId}/messages`, { to: agent.nodeId, text: "spoof" })).status).toBe(403);
    // Maestro só para condutor
    expect((await call(full.token, "POST", `/v1/nodes/${agent.nodeId}/maestro/recruit`, { command: "/bin/sh" })).status).toBe(403);
    // apagar o térreo é só do app
    expect((await call(full.token, "DELETE", `/v1/workspaces/${ws.workspaceId}`)).status).toBe(403);
    // WebSocket (digita em qualquer terminal) é só do app
    expect((await call(full.token, "GET", "/v1/ws")).status).toBe(403);
  });

  it("ligar o Modo Maestro concede maestro:conduct ao token VIVO do agente (sem reiniciar); desligar remove (#3/#29)", async () => {
    const r = (await api("POST", `/v1/workspaces/${ws.workspaceId}/nodes`, { expectedRevision: await rev(ws.workspaceId), kind: "terminal", title: "Cond", command: "/bin/sh", geometry: { x: 0, y: 0, w: 100, h: 100 } })).json as { node: Node };
    const tk = ((await api("POST", `/v1/nodes/${r.node.nodeId}/token`, {})).json as { token: string }).token; // token PADRÃO (caps dinâmicas)
    expect((await call(tk, "POST", `/v1/nodes/${r.node.nodeId}/maestro/recruit`, { command: "/bin/sh" })).status).toBe(403); // sem Maestro: não conduz
    // o app liga o Maestro no nó
    expect((await api("PATCH", `/v1/nodes/${r.node.nodeId}`, { expectedRevision: await rev(ws.workspaceId), maestro: true })).status).toBe(200);
    const rec = await call(tk, "POST", `/v1/nodes/${r.node.nodeId}/maestro/recruit`, { command: "/bin/sh", name: "Filho" }); // MESMO token agora conduz
    expect(rec.status, JSON.stringify(rec.json)).toBe(201);
    expect(((await api("GET", `/v1/workspaces/${ws.workspaceId}`)).json as { nodes: { title: string }[] }).nodes.some((n) => n.title === "Filho")).toBe(true);
    // desligar remove a capacidade do mesmo token
    expect((await api("PATCH", `/v1/nodes/${r.node.nodeId}`, { expectedRevision: await rev(ws.workspaceId), maestro: false })).status).toBe(200);
    expect((await call(tk, "POST", `/v1/nodes/${r.node.nodeId}/maestro/recruit`, { command: "/bin/sh" })).status).toBe(403);
  });

  it("revogar, parar, descarregar ou apagar o terminal invalida a credencial; reiniciar/recarregar rotaciona", async () => {
    let t = ((await api("POST", `/v1/nodes/${agent.nodeId}/token`, {})).json as AgentTokenInfo).token;
    expect((await call(t, "GET", `/v1/workspaces/${ws.workspaceId}`)).status).toBe(200);
    // revogar explicitamente
    expect((await api("DELETE", `/v1/nodes/${agent.nodeId}/token`)).json.revoked).toBeGreaterThanOrEqual(1);
    expect((await call(t, "GET", `/v1/workspaces/${ws.workspaceId}`)).status).toBe(401);

    // parar a sessão
    t = ((await api("POST", `/v1/nodes/${agent.nodeId}/token`, {})).json as AgentTokenInfo).token;
    await api("POST", `/v1/sessions/${agent.sessionId}/stop`);
    await waitFor(() => false, 600);
    expect((await call(t, "GET", `/v1/workspaces/${ws.workspaceId}`)).status).toBe(401);

    // reiniciar rotaciona: o token antigo não volta a valer
    const out = join(wsDir, "tok.txt"); rmSync(out, { force: true });
    expect((await api("POST", `/v1/nodes/${agent.nodeId}/restart`)).status).toBe(200);
    await waitFor(() => existsSync(out) && readFileSync(out, "utf8").length > 0);
    const rotated = readFileSync(out, "utf8");
    expect(rotated).toMatch(/^agt_/);
    expect(rotated).not.toBe(t);
    expect((await call(rotated, "GET", `/v1/workspaces/${ws.workspaceId}`)).status).toBe(200);

    // descarregar invalida; recarregar emite outra
    expect((await api("POST", `/v1/nodes/${agent.nodeId}/unload`)).status).toBe(200);
    expect((await call(rotated, "GET", `/v1/workspaces/${ws.workspaceId}`)).status).toBe(401);
    rmSync(out, { force: true });
    expect((await api("POST", `/v1/nodes/${agent.nodeId}/reload`)).status).toBe(200);
    await waitFor(() => existsSync(out) && readFileSync(out, "utf8").length > 0);
    const afterReload = readFileSync(out, "utf8");
    expect(afterReload).not.toBe(rotated);
    expect((await call(afterReload, "GET", `/v1/workspaces/${ws.workspaceId}`)).status).toBe(200);

    // apagar o nó invalida
    expect((await api("DELETE", `/v1/nodes/${agent.nodeId}`, { expectedRevision: await rev(ws.workspaceId) })).status).toBe(204);
    expect((await call(afterReload, "GET", `/v1/workspaces/${ws.workspaceId}`)).status).toBe(401);
    // token qualquer/forjado
    expect((await call("agt_forjado", "GET", `/v1/workspaces/${ws.workspaceId}`)).status).toBe(401);
  });
});
