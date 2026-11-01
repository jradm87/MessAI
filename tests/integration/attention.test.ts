import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// #69 — atenção global: agente que concluiu (até "seen" ou input), não-lidas, encerrado/perdido; e /v1/find?kinds=node por título.
const ROOT = join(import.meta.dirname, "../..");
const PORT = 48001;
let dir: string; let rt: ChildProcess; let token: string; let ws: string;
const H = (json = false) => ({ authorization: `Bearer ${token}`, ...(json ? { "content-type": "application/json" } : {}) });
const api = async (method: string, path: string, body?: unknown) => { const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: H(body !== undefined), body: body !== undefined ? JSON.stringify(body) : null }); return { status: r.status, json: r.status === 204 ? null : await r.json().catch(() => null) }; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Att = { kind: string; nodeId: string; workspaceName: string; title: string; count?: number; at?: string };
const attention = async () => (await api("GET", "/v1/attention")).json as Att[];
const rev = async () => ((await api("GET", `/v1/workspaces/${ws}`)).json as { workspace: { revision: number } }).workspace.revision;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "mess-att-"));
  writeFileSync(join(dir, "claude"), `#!/bin/sh\nwhile read line; do sleep 0.2; echo "trabalhando: $line"; sleep 0.1; echo "pronto: resultado-final-42 ok ok ok"; done\n`); chmodSync(join(dir, "claude"), 0o755);
  rt = spawn("node", [join(ROOT, "apps/runtime/dist/index.js")], { env: { ...process.env, MESS_DATA_DIR: dir, MESS_PORT: String(PORT), SHELL: "/bin/sh", MESS_OLLAMA_URL: "http://127.0.0.1:1" }, stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { await sleep(200); try { token = readFileSync(join(dir, "runtime.token"), "utf8").trim(); up = (await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: H() })).ok; } catch { /* subindo */ } }
  if (!up) throw new Error(`runtime não subiu na ${PORT}`);
  ws = ((await api("POST", "/v1/workspaces", { name: "Att", cwd: dir })).json as { workspaceId: string }).workspaceId;
}, 30_000);
afterAll(() => { try { rt?.kill("SIGKILL"); } catch { /* */ } rmSync(dir, { recursive: true, force: true }); });

describe("atenção global (#69)", () => {
  it("agente concluiu → finished até seen; input limpa; não-lida; encerrado; find por título de nó", async () => {
    expect(await attention()).toEqual([]);
    const a = (await api("POST", `/v1/workspaces/${ws}/nodes`, { expectedRevision: await rev(), kind: "terminal", title: "Agente Alfa", command: join(dir, "claude"), geometry: { x: 0, y: 0, w: 300, h: 200 } })).json as { node: { nodeId: string }; session: { sessionId: string } };
    const b = (await api("POST", `/v1/workspaces/${ws}/nodes`, { expectedRevision: await rev(), kind: "terminal", title: "Shell Beta", command: "/bin/sh", geometry: { x: 400, y: 0, w: 300, h: 200 } })).json as { node: { nodeId: string }; session: { sessionId: string } };
    await sleep(500);
    // turno do agente via WS
    const sock = new WebSocket(`ws://127.0.0.1:${PORT}/v1/ws?token=${token}`);
    await new Promise<void>((res) => { sock.onopen = () => res(); });
    const input = (sid: string, data: string) => { sock.send(JSON.stringify({ type: "acquireLease", sessionId: sid })); sock.send(JSON.stringify({ type: "input", sessionId: sid, data })); };
    input(a.session.sessionId, "faz o relatório\r");
    let att: Att[] = [];
    for (let i = 0; i < 40 && !att.some((x) => x.kind === "finished"); i++) { await sleep(250); att = await attention(); }
    const fin = att.find((x) => x.kind === "finished")!;
    expect(fin).toMatchObject({ nodeId: a.node.nodeId, workspaceName: "Att", title: "Agente Alfa" }); expect(fin.at).toBeTruthy();
    // "seen" limpa
    expect(((await api("POST", `/v1/nodes/${a.node.nodeId}/seen`)).json as { cleared: boolean }).cleared).toBe(true);
    expect((await attention()).some((x) => x.kind === "finished")).toBe(false);
    expect((await api("POST", "/v1/nodes/nao-existe/seen")).status).toBe(404);
    // novo turno → finished de novo; digitar no terminal limpa sem seen
    input(a.session.sessionId, "mais uma\r");
    for (let i = 0; i < 40 && !(await attention()).some((x) => x.kind === "finished"); i++) await sleep(250);
    expect((await attention()).some((x) => x.kind === "finished")).toBe(true);
    input(a.session.sessionId, "ok\r");
    await sleep(100);
    expect((await attention()).some((x) => x.kind === "finished")).toBe(false); // respondeu
    sock.close();
    // não-lida: Beta conectado a Alfa manda mensagem (mesma rota que o `mess ask`/`reply` usam)
    await api("POST", `/v1/workspaces/${ws}/connections`, { expectedRevision: await rev(), sourceNodeId: b.node.nodeId, targetNodeId: a.node.nodeId });
    expect((await api("POST", `/v1/nodes/${b.node.nodeId}/messages`, { to: "Agente Alfa", text: "oi" })).status).toBe(201);
    const unread = (await attention()).find((x) => x.kind === "unread");
    expect(unread).toMatchObject({ nodeId: a.node.nodeId, count: 1 });
    await api("GET", `/v1/nodes/${a.node.nodeId}/inbox?unread=1&mark=1`);
    expect((await attention()).some((x) => x.kind === "unread")).toBe(false);
    // encerrado
    await api("POST", `/v1/sessions/${b.session.sessionId}/stop`);
    for (let i = 0; i < 20 && !(await attention()).some((x) => x.kind === "exited"); i++) await sleep(200);
    expect((await attention()).find((x) => x.kind === "exited")).toMatchObject({ nodeId: b.node.nodeId, title: "Shell Beta" });
    // find por título (kinds=node), case-insensitive, com espaço filtrando
    const hits = (await api("GET", "/v1/find?q=alfa&kinds=node")).json as { kind: string; nodeId: string; nodeTitle: string; snippet: string }[];
    expect(hits).toHaveLength(1); expect(hits[0]).toMatchObject({ kind: "node", nodeId: a.node.nodeId, nodeTitle: "Agente Alfa" }); expect(hits[0]!.snippet).toContain("Att");
    expect(((await api("GET", "/v1/find?q=alfa&kinds=node&workspaceId=outro")).json as unknown[]).length).toBe(0);
    expect(((await api("GET", "/v1/find?q=alfa")).json as { kind: string }[]).some((h) => h.kind === "node")).toBe(true); // sem kinds inclui nós
  }, 60_000);
});
