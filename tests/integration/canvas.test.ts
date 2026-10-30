import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const PORT = 47968;
let dir: string; let rt: ChildProcess; let token: string;
const api = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : null });
  return { status: r.status, json: r.status === 204 ? null : await r.json() };
};
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "mess-canvas-")); mkdirSync(join(dir, "proj"));
  rt = spawn("node", [join(ROOT, "apps/runtime/dist/index.js")], { env: { ...process.env, MESS_DATA_DIR: dir, MESS_PORT: String(PORT), SHELL: "/bin/sh" }, stdio: "ignore" });
  for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 200)); try { token = readFileSync(join(dir, "runtime.token"), "utf8").trim(); if ((await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: { authorization: `Bearer ${token}` } })).ok) break; } catch { /* subindo */ } }
}, 30_000);
afterAll(() => { rt?.kill(); rmSync(dir, { recursive: true, force: true }); });

type N = { nodeId: string; kind: string; title: string; geometry: { x: number; y: number; w: number; h: number }; content?: string; color?: string; sessionId?: string };
describe("polir canvas: duplicar e organizar", () => {
  let ws: string, rev = 0;
  const snap = async () => (await api("GET", `/v1/workspaces/${ws}`)).json as { workspace: { revision: number }; nodes: N[] };
  it("prepara o espaço", async () => {
    ws = ((await api("POST", "/v1/workspaces", { name: "C", cwd: join(dir, "proj") })).json as { workspaceId: string }).workspaceId;
  });
  it("duplica uma nota com o mesmo conteúdo/cor, deslocada +32", async () => {
    const note = ((await api("POST", `/v1/workspaces/${ws}/nodes`, { expectedRevision: rev++, kind: "note", title: "Plano", geometry: { x: 10, y: 20, w: 200, h: 100 }, content: "corpo", color: "#4cd964" })).json as { node: N }).node;
    const r = await api("POST", `/v1/nodes/${note.nodeId}/duplicate`, { expectedRevision: rev++ });
    expect(r.status).toBe(201);
    const copy = (r.json as { node: N }).node;
    expect(copy.nodeId).not.toBe(note.nodeId);
    expect(copy.kind).toBe("note"); expect(copy.content).toBe("corpo"); expect(copy.color).toBe("#4cd964");
    expect({ x: copy.geometry.x, y: copy.geometry.y }).toEqual({ x: 42, y: 52 });
    expect((await snap()).nodes.filter((n) => n.kind === "note")).toHaveLength(2);
  });
  it("duplica um terminal relançando o mesmo comando (nova sessão)", async () => {
    const t = ((await api("POST", `/v1/workspaces/${ws}/nodes`, { expectedRevision: rev++, kind: "terminal", title: "Gato", command: "cat", geometry: { x: 0, y: 0, w: 300, h: 200 } })).json as { node: N }).node;
    const r = await api("POST", `/v1/nodes/${t.nodeId}/duplicate`, { expectedRevision: rev++ });
    expect(r.status).toBe(201);
    const body = r.json as { node: N; session?: { command: string; sessionId: string } };
    expect(body.node.sessionId).toBeTruthy();
    expect(body.session?.command).toBe("cat");
    expect(body.session?.sessionId).not.toBe(t.sessionId);
  });
  it("conflito de revisão ao duplicar", async () => {
    const t = (await snap()).nodes[0]!;
    expect((await api("POST", `/v1/nodes/${t.nodeId}/duplicate`, { expectedRevision: 0 })).status).toBe(409);
  });
  it("organiza vários nós numa única revisão (applyLayout)", async () => {
    const s0 = await snap(); const before = s0.workspace.revision;
    const ns = s0.nodes.slice(0, 3);
    const moves = ns.map((n, i) => ({ nodeId: n.nodeId, geometry: { ...n.geometry, x: i * 500, y: 0 } }));
    const r = await api("POST", `/v1/workspaces/${ws}/layout`, { expectedRevision: before, moves });
    expect(r.status).toBe(200);
    const s1 = await snap();
    expect(s1.workspace.revision).toBe(before + 1); // uma revisão só, não uma por nó
    for (let i = 0; i < ns.length; i++) expect(s1.nodes.find((n) => n.nodeId === ns[i]!.nodeId)!.geometry.x).toBe(i * 500);
  });
  it("applyLayout ignora ids de fora e recusa revisão errada", async () => {
    const s = await snap(); const rev2 = s.workspace.revision;
    expect((await api("POST", `/v1/workspaces/${ws}/layout`, { expectedRevision: 0, moves: [] })).status).toBe(409);
    const ok = await api("POST", `/v1/workspaces/${ws}/layout`, { expectedRevision: rev2, moves: [{ nodeId: "deadbeefdeadbeef", geometry: { x: 1, y: 1, w: 50, h: 50 } }] });
    expect(ok.status).toBe(200); // id inexistente é ignorado, mas a revisão avança
  });
  it("move um desenho via patchDrawing (novos pontos) e recusa revisão errada / id inexistente", async () => {
    const rev0 = (await snap()).workspace.revision;
    const drw = (await api("POST", `/v1/workspaces/${ws}/drawings`, { expectedRevision: rev0, kind: "pen", points: [[0, 0], [10, 10]], color: "#e0453a", width: 3 })).json as { drawingId: string };
    const rev1 = (await snap()).workspace.revision;
    const moved = await api("PATCH", `/v1/drawings/${drw.drawingId}`, { expectedRevision: rev1, points: [[50, 50], [60, 60]] });
    expect(moved.status).toBe(200);
    expect((moved.json as { points: [number, number][] }).points).toEqual([[50, 50], [60, 60]]);
    expect((await api("PATCH", `/v1/drawings/${drw.drawingId}`, { expectedRevision: 0, points: [[1, 1], [2, 2]] })).status).toBe(409);
    expect((await api("PATCH", `/v1/drawings/deadbeefdeadbeef`, { expectedRevision: (await snap()).workspace.revision, points: [[1, 1], [2, 2]] })).status).toBe(404);
  });
  it("agrupa e desagrupa desenhos (groupId compartilhado)", async () => {
    const mk = async () => ((await api("POST", `/v1/workspaces/${ws}/drawings`, { expectedRevision: (await snap()).workspace.revision, kind: "pen", points: [[0, 0], [5, 5]], color: "#fff", width: 2 })).json as { drawingId: string }).drawingId;
    const a = await mk(); const b = await mk();
    const drw = async () => (await api("GET", `/v1/workspaces/${ws}`)).json as { drawings: { drawingId: string; groupId?: string }[] };
    const g = await api("POST", `/v1/workspaces/${ws}/drawings/group`, { expectedRevision: (await snap()).workspace.revision, drawingIds: [a, b], grouped: true });
    expect(g.status).toBe(200);
    let ds = (await drw()).drawings;
    const ga = ds.find((d) => d.drawingId === a)!.groupId, gb = ds.find((d) => d.drawingId === b)!.groupId;
    expect(ga).toBeTruthy(); expect(ga).toBe(gb);
    await api("POST", `/v1/workspaces/${ws}/drawings/group`, { expectedRevision: (await snap()).workspace.revision, drawingIds: [a, b], grouped: false });
    ds = (await drw()).drawings;
    expect(ds.find((d) => d.drawingId === a)!.groupId).toBeUndefined();
  });
});
