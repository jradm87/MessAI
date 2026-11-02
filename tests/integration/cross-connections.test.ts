import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConnectedPeer, Connection, CrossNodeCandidate, Message, Node, Session, Workspace } from "@messai/contracts";

const ROOT = join(import.meta.dirname, "../..");
const PORT = 48022;
let dir: string; let repoA: string; let repoB: string; let rt: ChildProcess; let token: string;
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const api = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : null });
  return { status: r.status, json: r.status === 204 ? null : await r.json() };
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "mess-cross-conn-"));
  repoA = join(dir, "repoA"); mkdirSync(repoA);
  repoB = join(dir, "repoB"); mkdirSync(repoB);
  execFileSync("git", ["-C", repoA, "init", "-q", "-b", "main"], { env: GIT_ENV });
  writeFileSync(join(repoA, "README.md"), "# A\n");
  execFileSync("git", ["-C", repoA, "add", "README.md"], { env: GIT_ENV });
  execFileSync("git", ["-C", repoA, "commit", "-q", "-m", "init"], { env: GIT_ENV });

  rt = spawn("node", [join(ROOT, "apps/runtime/dist/index.js")], { env: { ...GIT_ENV, MESS_DATA_DIR: dir, MESS_PORT: String(PORT), SHELL: "/bin/sh" }, stdio: "ignore" });
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 200));
    try {
      token = readFileSync(join(dir, "runtime.token"), "utf8").trim();
      if ((await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: { authorization: `Bearer ${token}` } })).ok) break;
    } catch { /* subindo */ }
  }
}, 30_000);
afterAll(() => { rt?.kill(); rmSync(dir, { recursive: true, force: true }); });

describe("Conexões entre andares e entre espaços (#82)", () => {
  let wsGround: Workspace;
  let wsFloor: Workspace;
  let wsOther: Workspace;
  let nodeGround: Node;
  let nodeFloor: Node;
  let nodeOther: Node;

  it("lista candidatos de outros andares/espaços e cria conexão cross-floor e cross-workspace por 'Nome @ Espaço'", async () => {
    wsGround = (await api("POST", "/v1/workspaces", { name: "Frontend", cwd: repoA })).json as Workspace;
    wsFloor = (await api("POST", `/v1/workspaces/${wsGround.workspaceId}/floors`, { name: "Andar UI", floorType: "worktree" })).json as Workspace;
    wsOther = (await api("POST", "/v1/workspaces", { name: "Backend", cwd: repoB })).json as Workspace;

    const r1 = (await api("POST", `/v1/workspaces/${wsGround.workspaceId}/nodes`, {
      expectedRevision: 0, kind: "terminal", title: "Líder", geometry: { x: 40, y: 40, w: 320, h: 200 },
    })).json as { node: Node; session: Session; revision: number };
    nodeGround = r1.node;

    const r2 = (await api("POST", `/v1/workspaces/${wsFloor.workspaceId}/nodes`, {
      expectedRevision: 0, kind: "terminal", title: "DevUI", geometry: { x: 40, y: 40, w: 320, h: 200 },
    })).json as { node: Node; session: Session; revision: number };
    nodeFloor = r2.node;

    const r3 = (await api("POST", `/v1/workspaces/${wsOther.workspaceId}/nodes`, {
      expectedRevision: 0, kind: "terminal", title: "WorkerAPI", geometry: { x: 40, y: 40, w: 320, h: 200 },
    })).json as { node: Node; session: Session; revision: number };
    nodeOther = r3.node;

    const candRes = await api("GET", `/v1/nodes/${nodeGround.nodeId}/cross-candidates`);
    expect(candRes.status).toBe(200);
    const cands = candRes.json as CrossNodeCandidate[];
    expect(cands.map((c) => c.refLabel).sort()).toEqual(["DevUI @ Andar UI", "WorkerAPI @ Backend"]);

    // Conecta por targetRef "DevUI @ Andar UI" (cross-floor)
    const c1 = await api("POST", `/v1/workspaces/${wsGround.workspaceId}/connections`, {
      expectedRevision: r1.revision,
      sourceNodeId: nodeGround.nodeId,
      targetRef: "DevUI @ Andar UI",
    });
    expect(c1.status).toBe(201);
    expect((c1.json as Connection).targetNodeId).toBe(nodeFloor.nodeId);

    // Conecta por targetRef "WorkerAPI @ Backend" (cross-workspace)
    const c2 = await api("POST", `/v1/workspaces/${wsGround.workspaceId}/connections`, {
      expectedRevision: r1.revision + 1,
      sourceNodeId: nodeGround.nodeId,
      targetRef: "WorkerAPI @ Backend",
    });
    expect(c2.status).toBe(201);
    expect((c2.json as Connection).targetNodeId).toBe(nodeOther.nodeId);

    const peersRes = await api("GET", `/v1/nodes/${nodeGround.nodeId}/connected`);
    const peers = peersRes.json as ConnectedPeer[];
    expect(peers).toHaveLength(2);
    expect(peers.every((p) => p.crossWorkspace)).toBe(true);
    expect(peers.map((p) => `${p.node.title} @ ${p.workspaceName}`).sort()).toEqual(["DevUI @ Andar UI", "WorkerAPI @ Backend"]);
  });

  it("atravessa a conexão com mensagens, ask e check usando 'Nome @ Espaço'", async () => {
    // Envia mensagem de Líder (Frontend) para WorkerAPI @ Backend
    const msgRes = await api("POST", `/v1/nodes/${nodeGround.nodeId}/messages`, {
      to: "WorkerAPI @ Backend",
      text: "echo PONG_CROSS_WS",
    });
    expect(msgRes.status).toBe(201);
    const msg = msgRes.json as Message;
    expect(msg.toNodeId).toBe(nodeOther.nodeId);

    // Caixa de entrada do WorkerAPI mostra remetente com @ Frontend
    const inboxRes = await api("GET", `/v1/nodes/${nodeOther.nodeId}/inbox?unread=1&mark=0`);
    expect(inboxRes.status).toBe(200);
    const inbox = (inboxRes.json as { messages: (Message & { fromTitle: string })[] }).messages;
    expect(inbox.some((m) => m.fromTitle === "Líder @ Frontend" && m.text === "echo PONG_CROSS_WS")).toBe(true);

    // ask bloqueante para DevUI @ Andar UI
    const askRes = await api("POST", `/v1/nodes/${nodeGround.nodeId}/ask`, {
      to: "DevUI @ Andar UI",
      text: "echo RESPOSTA_DO_ANDAR_42",
      timeoutMs: 5000,
    });
    expect(askRes.status).toBe(200);
    expect((askRes.json as { response: string }).response).toContain("RESPOSTA_DO_ANDAR_42");

    // check da tela de DevUI @ Andar UI
    const chkRes = await api("GET", `/v1/nodes/${nodeGround.nodeId}/check?ref=${encodeURIComponent("DevUI @ Andar UI")}`);
    expect(chkRes.status).toBe(200);
    expect((chkRes.json as { screen: string }).screen).toContain("RESPOSTA_DO_ANDAR_42");
  });

  it("funciona pelo CLI `mess connect` e `mess peers` entre espaços", () => {
    const cli = join(ROOT, "apps/cli/dist/index.js");
    const envFloor = {
      ...process.env,
      MESS_SOCKET: join(dir, "agent.sock"),
      MESS_TOKEN: token,
      MESS_WORKSPACE_ID: wsFloor.workspaceId,
      MESS_NODE_ID: nodeFloor.nodeId,
    };
    const outConnect = execFileSync("node", [cli, "connect", "WorkerAPI @ Backend"], { encoding: "utf8", env: envFloor }).trim();
    expect(outConnect).toContain('ligado a "WorkerAPI @ Backend"');

    const outPeers = execFileSync("node", [cli, "peers"], { encoding: "utf8", env: envFloor }).trim();
    expect(outPeers).toContain("Líder @ Frontend");
    expect(outPeers).toContain("WorkerAPI @ Backend");
  });
});
