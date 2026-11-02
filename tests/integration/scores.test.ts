import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// #71 — partituras: salvar seleção/espaço, listar, renomear, apagar, colocar em outro espaço (nós, comando, papel, skills, aparência, conexões, layout).
const ROOT = join(import.meta.dirname, "../..");
const PORT = 48009;
let dir: string; let rt: ChildProcess; let token: string;
const H = (json = false) => ({ authorization: `Bearer ${token}`, ...(json ? { "content-type": "application/json" } : {}) });
const api = async (method: string, path: string, body?: unknown) => { const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: H(body !== undefined), body: body !== undefined ? JSON.stringify(body) : null }); const t = await r.text(); return { status: r.status, json: t ? JSON.parse(t) : null }; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Snap = { workspace: { revision: number }; nodes: { nodeId: string; kind: string; title: string; roleId?: string; skillIds?: string[]; color?: string; icon?: string; content?: string; geometry: { x: number; y: number } }[]; connections: { sourceNodeId: string; targetNodeId: string; style?: string }[] };
const snap = async (ws: string) => (await api("GET", `/v1/workspaces/${ws}`)).json as Snap;
const rev = async (ws: string) => (await snap(ws)).workspace.revision;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "mess-scores-"));
  writeFileSync(join(dir, "claude"), "#!/bin/sh\nsleep 120\n"); chmodSync(join(dir, "claude"), 0o755);
  rt = spawn("node", [join(ROOT, "apps/runtime/dist/index.js")], { env: { ...process.env, MESS_DATA_DIR: dir, MESS_PORT: String(PORT), SHELL: "/bin/sh" }, stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { await sleep(200); try { token = readFileSync(join(dir, "runtime.token"), "utf8").trim(); up = (await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: H() })).ok; } catch { /* subindo */ } }
  if (!up) throw new Error(`runtime não subiu na ${PORT}`);
}, 30_000);
afterAll(() => { try { rt?.kill("SIGKILL"); } catch { /* */ } rmSync(dir, { recursive: true, force: true }); });

describe("partituras (#71)", () => {
  it("salva a seleção, recoloca em outro espaço com papel/skills/comando/conexão/layout; avisa o que faltou; CRUD", async () => {
    const role = (await api("POST", "/v1/roles", { name: "Revisor", instructions: "Revise." })).json as { roleId: string };
    const sk = (await api("POST", "/v1/skills", { name: "Rigor", instructions: "Com rigor." })).json as { skillId: string };
    const A = ((await api("POST", "/v1/workspaces", { name: "A", cwd: dir })).json as { workspaceId: string }).workspaceId;
    const B = ((await api("POST", "/v1/workspaces", { name: "B", cwd: dir })).json as { workspaceId: string }).workspaceId;
    const t = (await api("POST", `/v1/workspaces/${A}/nodes`, { expectedRevision: await rev(A), kind: "terminal", title: "Revisor", command: join(dir, "claude"), args: ["--x"], roleId: role.roleId, skillIds: [sk.skillId], color: "#ef5350", icon: "bug", geometry: { x: 1000, y: 500, w: 400, h: 260 } })).json as { node: { nodeId: string } };
    const n = (await api("POST", `/v1/workspaces/${A}/nodes`, { expectedRevision: await rev(A), kind: "note", title: "Plano", content: "# Plano\n1. a", geometry: { x: 1500, y: 560, w: 260, h: 160 } })).json as { node: { nodeId: string } };
    const outsider = (await api("POST", `/v1/workspaces/${A}/nodes`, { expectedRevision: await rev(A), kind: "note", title: "Fora", content: "x", geometry: { x: 0, y: 0, w: 100, h: 100 } })).json as { node: { nodeId: string } };
    await api("POST", `/v1/workspaces/${A}/connections`, { expectedRevision: await rev(A), sourceNodeId: n.node.nodeId, targetNodeId: t.node.nodeId });
    await api("POST", `/v1/workspaces/${A}/connections`, { expectedRevision: await rev(A), sourceNodeId: outsider.node.nodeId, targetNodeId: t.node.nodeId }); // pontas fora: não entra
    // salvar a seleção (2 nós)
    expect((await api("POST", `/v1/workspaces/${A}/scores`, { expectedRevision: 0, nodeIds: [], name: "x" })).status).toBe(409); // revisão velha
    const sc = (await api("POST", `/v1/workspaces/${A}/scores`, { expectedRevision: await rev(A), nodeIds: [t.node.nodeId, n.node.nodeId], name: "Time de revisão", description: "revisor + plano" })).json as { scoreId: string; nodes: { title: string; roleName?: string; skillNames?: string[]; command?: string; geometry: { x: number; y: number } }[]; connections: unknown[] };
    expect(sc.nodes).toHaveLength(2); expect(sc.connections).toHaveLength(1);
    const st = sc.nodes.find((x) => x.title === "Revisor")!; expect(st).toMatchObject({ roleName: "Revisor", skillNames: ["Rigor"], command: join(dir, "claude") }); expect(st.geometry).toMatchObject({ x: 0, y: 0 }); // relativo ao canto
    expect((await api("POST", `/v1/workspaces/${A}/scores`, { expectedRevision: await rev(A), name: "time de REVISÃO".replace("ã", "ã") })).status).toBe(201); // espaço todo, outro nome
    expect((await api("POST", `/v1/workspaces/${A}/scores`, { expectedRevision: await rev(A), name: "Time de revisão" })).status).toBe(409); // nome repetido
    expect(((await api("GET", "/v1/scores")).json as unknown[]).length).toBe(2);
    // colocar em B
    const at = { x: 200, y: 100 };
    const placed = (await api("POST", `/v1/workspaces/${B}/scores/${sc.scoreId}/place`, { expectedRevision: await rev(B), at })).json as { nodeIds: string[]; connectionIds: string[]; warnings: string[] };
    expect(placed.nodeIds).toHaveLength(2); expect(placed.connectionIds).toHaveLength(1); expect(placed.warnings).toEqual([]);
    const s = await snap(B);
    const nt = s.nodes.find((x) => x.title === "Revisor")!, nn = s.nodes.find((x) => x.title === "Plano")!;
    expect(nt).toMatchObject({ roleId: role.roleId, skillIds: [sk.skillId], color: "#ef5350", icon: "bug" }); expect(nt.geometry).toMatchObject({ x: 200, y: 100 });
    expect(nn.geometry).toMatchObject({ x: 700, y: 160 }); expect(nn.content).toBe("# Plano\n1. a");
    expect(s.connections).toHaveLength(1); expect(s.connections[0]).toMatchObject({ sourceNodeId: nn.nodeId, targetNodeId: nt.nodeId });
    // papel/skill removidos → avisos, nós sobem sem eles
    await api("DELETE", `/v1/roles/${role.roleId}`); await api("DELETE", `/v1/skills/${sk.skillId}`);
    const again = (await api("POST", `/v1/workspaces/${B}/scores/${sc.scoreId}/place`, { expectedRevision: await rev(B), at: { x: 0, y: 700 } })).json as { nodeIds: string[]; warnings: string[] };
    expect(again.nodeIds).toHaveLength(2); expect(again.warnings.join("|")).toMatch(/papel "Revisor" não existe/); expect(again.warnings.join("|")).toMatch(/habilidade "Rigor" não existe/);
    // CRUD
    expect(((await api("PATCH", `/v1/scores/${sc.scoreId}`, { name: "Time R2" })).json as { name: string }).name).toBe("Time R2");
    expect((await api("DELETE", `/v1/scores/${sc.scoreId}`)).status).toBe(204);
    expect((await api("POST", `/v1/workspaces/${B}/scores/${sc.scoreId}/place`, { expectedRevision: await rev(B), at })).status).toBe(404);
    expect((await api("DELETE", `/v1/scores/${sc.scoreId}`)).status).toBe(404);
  }, 40_000);
});
