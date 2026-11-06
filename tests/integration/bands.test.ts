import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// #70 Bandas e #29 Modo Maestro (terminais `cat` fazem o papel de agentes: ecoam o que recebem).
const ROOT = join(import.meta.dirname, "../..");
const PORT = 48010;
let dir: string; let rt: ChildProcess; let token: string;
const H = () => ({ authorization: `Bearer ${token}`, "content-type": "application/json" });
const api = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: H(), body: body ? JSON.stringify(body) : null });
  return { status: r.status, json: r.status === 204 ? null : await r.json() };
};
const cli = (args: string[], env: Record<string, string>) => new Promise<{ code: number; out: string }>((res) => {
  const p = spawn(join(ROOT, "apps/cli/bin/mess"), args, { env: { ...process.env, ...env } }); let out = "";
  p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d)); p.on("exit", (code) => res({ code: code ?? 1, out }));
});
type Node = { nodeId: string; title: string; maestro?: boolean };
type Snap = { workspace: { revision: number }; nodes: Node[]; connections: { sourceNodeId: string; targetNodeId: string }[]; bands?: { bandId: string; name: string; nodeIds: string[]; asking: string[] }[] };
const snap = async (ws: string) => (await api("GET", `/v1/workspaces/${ws}`)).json as Snap;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "mess-int-"));
  rt = spawn("node", [join(ROOT, "apps/runtime/dist/index.js")], { env: { ...process.env, MESS_DATA_DIR: dir, MESS_PORT: String(PORT), SHELL: "/bin/sh" }, stdio: "ignore" });
  for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 200)); try { token = readFileSync(join(dir, "runtime.token"), "utf8").trim(); if ((await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: H() })).ok) break; } catch { /* subindo */ } }
}, 30_000);
afterAll(() => { rt?.kill(); rmSync(dir, { recursive: true, force: true }); });

describe("#70 bandas", () => {
  let ws: string; let a: Node, b: Node, c: Node; let band: string;
  it("cria terminais e uma banda com dois deles; nome repetido é recusado", async () => {
    ws = ((await api("POST", "/v1/workspaces", { name: "Bandas", cwd: dir })).json as { workspaceId: string }).workspaceId;
    const mk = async (title: string) => { const s = await snap(ws); return ((await api("POST", `/v1/workspaces/${ws}/nodes`, { expectedRevision: s.workspace.revision, kind: "terminal", title, command: "cat", geometry: { x: 0, y: 0, w: 300, h: 200 } })).json as { node: Node }).node; };
    a = await mk("Alfa"); b = await mk("Beta"); c = await mk("Gama");
    const r = await api("POST", `/v1/workspaces/${ws}/bands`, { name: "Dupla", nodeIds: [a.nodeId, b.nodeId] });
    expect(r.status).toBe(201); band = (r.json as { bandId: string }).bandId;
    expect((await api("POST", `/v1/workspaces/${ws}/bands`, { name: "dupla" })).status).toBe(409);
    expect((await snap(ws)).bands?.[0]).toMatchObject({ name: "Dupla", nodeIds: [a.nodeId, b.nodeId], asking: [] });
  });
  it("adiciona/remove membros", async () => {
    const r = await api("PATCH", `/v1/bands/${band}`, { addNodeIds: [c.nodeId], removeNodeIds: [a.nodeId] });
    expect((r.json as { nodeIds: string[] }).nodeIds).toEqual([b.nodeId, c.nodeId]);
    await api("PATCH", `/v1/bands/${band}`, { addNodeIds: [a.nodeId] });
  });
  it("perguntar em lote: todos os membros respondem (eco do cat) e o estado 'perguntando' volta a vazio", async () => {
    await new Promise((r) => setTimeout(r, 600));
    const r = await api("POST", `/v1/bands/${band}/ask`, { text: "ping-banda", timeoutMs: 4000 });
    expect(r.status).toBe(200);
    const res = r.json as { answers: { title: string; response: string; delivered: boolean; timedOut: boolean }[] };
    expect(res.answers.map((x) => x.title).sort()).toEqual(["Alfa", "Beta", "Gama"]);
    for (const x of res.answers) { expect(x.delivered).toBe(true); expect(x.response).toContain("ping-banda"); }
    expect((await snap(ws)).bands?.[0]?.asking).toEqual([]);
  });
  it("transmitir não espera resposta", async () => {
    const r = await api("POST", `/v1/bands/${band}/broadcast`, { text: "aviso" });
    const res = r.json as { answers: { delivered: boolean; response: string }[] };
    expect(res.answers).toHaveLength(3); expect(res.answers.every((x) => x.delivered && x.response === "")).toBe(true);
  });
  it("agente: só alcança membros ligados a ele ou, sendo da banda, os colegas", async () => {
    const sock = join(dir, "agent.sock");
    const env = (n: Node) => ({ MESS_SOCKET: sock, MESS_TOKEN: token, MESS_WORKSPACE_ID: ws, MESS_NODE_ID: n.nodeId });
    // Dentro da banda (Alfa é membro): fala com Beta e Gama sem ligação.
    const ok = await cli(["band", "ask", "Dupla", "oi colegas", "--timeout", "4"], env(a));
    expect(ok.code).toBe(0); expect(ok.out).toContain("Beta"); expect(ok.out).toContain("Gama");
    // Fora da banda, sem ligações: cada membro volta com erro de conexão.
    const s = await snap(ws);
    const d = ((await api("POST", `/v1/workspaces/${ws}/nodes`, { expectedRevision: s.workspace.revision, kind: "terminal", title: "Delta", command: "cat", geometry: { x: 0, y: 0, w: 300, h: 200 } })).json as { node: Node }).node;
    const r = await api("POST", `/v1/bands/${band}/ask`, { text: "x", fromNodeId: d.nodeId, timeoutMs: 2000 });
    const res = r.json as { answers: { error?: string }[] };
    expect(res.answers.every((x) => (x.error ?? "").includes("conectados"))).toBe(true);
  });
  it("apagar o nó o retira da banda; apagar a banda não apaga os terminais", async () => {
    const s = await snap(ws);
    await api("DELETE", `/v1/nodes/${c.nodeId}`, { expectedRevision: s.workspace.revision });
    expect([...((await snap(ws)).bands?.[0]?.nodeIds ?? [])].sort()).toEqual([a.nodeId, b.nodeId].sort());
    expect((await api("DELETE", `/v1/bands/${band}`, {})).status).toBe(204);
    const after = await snap(ws);
    expect(after.bands ?? []).toEqual([]); expect(after.nodes.some((n) => n.nodeId === a.nodeId)).toBe(true);
  });
});

describe("#29 modo maestro", () => {
  let ws: string; let m: Node, plain: Node; let env: Record<string, string>;
  it("só terminal com Modo Maestro recruta", async () => {
    ws = ((await api("POST", "/v1/workspaces", { name: "Maestro", cwd: dir })).json as { workspaceId: string }).workspaceId;
    let s = await snap(ws);
    m = ((await api("POST", `/v1/workspaces/${ws}/nodes`, { expectedRevision: s.workspace.revision, kind: "terminal", title: "Condutor", command: "cat", geometry: { x: 0, y: 0, w: 300, h: 200 } })).json as { node: Node }).node;
    s = await snap(ws);
    plain = ((await api("POST", `/v1/workspaces/${ws}/nodes`, { expectedRevision: s.workspace.revision, kind: "terminal", title: "Comum", command: "cat", geometry: { x: 400, y: 0, w: 300, h: 200 } })).json as { node: Node }).node;
    const no = await api("POST", `/v1/nodes/${m.nodeId}/maestro/recruit`, { command: "cat" });
    expect(no.status).toBe(403);
    s = await snap(ws);
    const p = await api("PATCH", `/v1/nodes/${m.nodeId}`, { expectedRevision: s.workspace.revision, maestro: true });
    expect((p.json as Node).maestro).toBe(true);
    env = { MESS_SOCKET: join(dir, "agent.sock"), MESS_TOKEN: token, MESS_WORKSPACE_ID: ws, MESS_NODE_ID: m.nodeId };
  });
  it("recruta (ligado ao condutor, com papel e banda), reatribui e dispensa", async () => {
    await api("POST", "/v1/roles", { name: "Revisor", instructions: "revise" });
    const r = await api("POST", `/v1/nodes/${m.nodeId}/maestro/recruit`, { command: "cat", name: "Recruta", roleName: "Revisor", band: "Time" });
    expect(r.status).toBe(201);
    const rec = (r.json as { node: Node & { roleId?: string }; bandId?: string });
    expect(rec.node.title).toBe("Recruta"); expect(rec.node.roleId).toBeTruthy(); expect(rec.bandId).toBeTruthy();
    const s = await snap(ws);
    expect(s.connections.some((c) => c.sourceNodeId === m.nodeId && c.targetNodeId === rec.node.nodeId)).toBe(true);
    expect(s.bands?.find((b) => b.name === "Time")?.nodeIds).toContain(rec.node.nodeId);
    // reatribuir: remove o papel
    const as = await api("POST", `/v1/nodes/${m.nodeId}/maestro/assign`, { ref: "Recruta", roleName: null });
    expect(as.status).toBe(200); expect((as.json as { roleId?: string }).roleId).toBeUndefined();
    expect((await api("POST", `/v1/nodes/${m.nodeId}/maestro/assign`, { ref: "Recruta", roleName: "Inexistente" })).status).toBe(404);
    // não age em terminal não ligado a ele
    expect((await api("POST", `/v1/nodes/${m.nodeId}/maestro/dismiss`, { ref: plain.title })).status).toBe(403);
    // dispensar
    const d = await api("POST", `/v1/nodes/${m.nodeId}/maestro/dismiss`, { ref: "Recruta" });
    expect(d.status).toBe(200);
    const after = await snap(ws);
    expect(after.nodes.some((n) => n.title === "Recruta")).toBe(false);
    expect(after.bands?.find((b) => b.name === "Time")?.nodeIds).not.toContain(rec.node.nodeId);
  });
  it("interrompe recrutados: um nó e --all; só o condutor pode", async () => {
    // obs.: o teste usa `cat` (shell) → interrupt manda Ctrl-C (encerra o cat). Com agente de IA real seria Esc (não mata).
    const single = await api("POST", `/v1/nodes/${m.nodeId}/maestro/recruit`, { command: "cat", name: "Int0" });
    expect(single.status).toBe(201);
    await new Promise((r) => setTimeout(r, 700));
    const one = await api("POST", `/v1/nodes/${m.nodeId}/maestro/interrupt`, { ref: "Int0" });
    expect(one.status).toBe(200); expect((one.json as { interrupted: number }).interrupted).toBe(1);
    const r1 = await api("POST", `/v1/nodes/${m.nodeId}/maestro/recruit`, { command: "cat", name: "Int1" });
    const r2 = await api("POST", `/v1/nodes/${m.nodeId}/maestro/recruit`, { command: "cat", name: "Int2" });
    expect(r1.status).toBe(201); expect(r2.status).toBe(201);
    await new Promise((r) => setTimeout(r, 800)); // espera os dois `cat` entrarem em "running"
    const all = await api("POST", `/v1/nodes/${m.nodeId}/maestro/interrupt`, { all: true });
    expect(all.status).toBe(200); expect((all.json as { interrupted: number }).interrupted).toBeGreaterThanOrEqual(2);
    // terminal comum não conduz
    expect((await api("POST", `/v1/nodes/${plain.nodeId}/maestro/interrupt`, { all: true })).status).toBe(403);
    for (const name of ["Int0", "Int1", "Int2"]) await api("POST", `/v1/nodes/${m.nodeId}/maestro/dismiss`, { ref: name });
  });
  it("pela CLI: recruit/assign/dismiss e o condutor enxerga o próprio estado", async () => {
    const r = await cli(["maestro", "recruit", "--command", "cat", "--name", "ViaCli"], env);
    expect(r.code).toBe(0); expect(r.out).toContain("ViaCli");
    expect((await cli(["maestro", "dismiss", "ViaCli"], env)).code).toBe(0);
    // terminal comum não é condutor
    const bad = await cli(["maestro", "recruit", "--command", "cat"], { ...env, MESS_NODE_ID: plain.nodeId });
    expect(bad.code).toBe(1); expect(bad.out).toContain("FORBIDDEN");
  });
});
