import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// #78 — grupos de nós pela API: criar/editar/adicionar/remover/desagrupar; apagar membro limpa; grupo vazio some sozinho.
const ROOT = join(import.meta.dirname, "../..");
const PORT = 47991;
let dir: string; let rt: ChildProcess; let token: string; let ws: string;
const H = (json = false) => ({ authorization: `Bearer ${token}`, ...(json ? { "content-type": "application/json" } : {}) });
const api = async (method: string, path: string, body?: unknown) => { const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: H(body !== undefined), body: body !== undefined ? JSON.stringify(body) : null }); return { status: r.status, json: r.status === 204 ? null : await r.json().catch(() => null) }; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Snap = { workspace: { revision: number }; nodes: { nodeId: string; title: string; groupId?: string }[]; groups: { groupId: string; label: string; color: string }[] };
const snap = async () => (await api("GET", `/v1/workspaces/${ws}`)).json as Snap;
const rev = async () => (await snap()).workspace.revision;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "mess-groups-"));
  rt = spawn("node", [join(ROOT, "apps/runtime/dist/index.js")], { env: { ...process.env, MESS_DATA_DIR: dir, MESS_PORT: String(PORT), SHELL: "/bin/sh" }, stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { await sleep(200); try { token = readFileSync(join(dir, "runtime.token"), "utf8").trim(); up = (await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: H() })).ok; } catch { /* subindo */ } }
  if (!up) throw new Error(`runtime não subiu na ${PORT}`);
  ws = ((await api("POST", "/v1/workspaces", { name: "G", cwd: dir })).json as { workspaceId: string }).workspaceId;
}, 30_000);
afterAll(() => { try { rt?.kill("SIGKILL"); } catch { /* */ } rmSync(dir, { recursive: true, force: true }); });

describe("grupos de nós (#78)", () => {
  it("cria com rótulo/cor, membros ganham groupId; PATCH edita e move membros; vazio some; DELETE desagrupa; validações", async () => {
    const mk = async (title: string) => ((await api("POST", `/v1/workspaces/${ws}/nodes`, { expectedRevision: await rev(), kind: "note", title, content: "", geometry: { x: 0, y: 0, w: 100, h: 100 } })).json as { node: { nodeId: string } }).node.nodeId;
    const a = await mk("A"), b = await mk("B"), c = await mk("C");
    expect((await api("POST", `/v1/workspaces/${ws}/groups`, { expectedRevision: await rev(), nodeIds: ["nao-existe"] })).status).toBe(400); // nenhum nó válido
    const g = (await api("POST", `/v1/workspaces/${ws}/groups`, { expectedRevision: await rev(), nodeIds: [a, b, "nao-existe"], label: "Backend", color: "#ef5350" })).json as { group: { groupId: string; label: string; color: string } };
    expect(g.group).toMatchObject({ label: "Backend", color: "#ef5350" });
    let s = await snap();
    expect(s.groups.map((x) => x.groupId)).toEqual([g.group.groupId]);
    expect(s.nodes.find((n) => n.nodeId === a)!.groupId).toBe(g.group.groupId); expect(s.nodes.find((n) => n.nodeId === c)!.groupId).toBeUndefined();
    // PATCH: rótulo, adiciona C, remove B
    const p = (await api("PATCH", `/v1/groups/${g.group.groupId}`, { expectedRevision: await rev(), label: "Back", addNodeIds: [c], removeNodeIds: [b] })).json as { group: { label: string } | null };
    expect(p.group?.label).toBe("Back");
    s = await snap();
    expect(s.nodes.find((n) => n.nodeId === b)!.groupId).toBeUndefined(); expect(s.nodes.find((n) => n.nodeId === c)!.groupId).toBe(g.group.groupId);
    // nó entra/sai pelo PATCH do nó; grupo inexistente → 404
    expect((await api("PATCH", `/v1/nodes/${b}`, { expectedRevision: await rev(), groupId: "nao-existe" })).status).toBe(404);
    await api("PATCH", `/v1/nodes/${b}`, { expectedRevision: await rev(), groupId: g.group.groupId });
    expect((await snap()).nodes.filter((n) => n.groupId === g.group.groupId)).toHaveLength(3);
    // apagar um membro limpa a adesão; sair de todos esvazia e o grupo some sozinho
    await api("DELETE", `/v1/nodes/${a}`, { expectedRevision: await rev() });
    expect((await snap()).nodes.filter((n) => n.groupId === g.group.groupId)).toHaveLength(2);
    await api("PATCH", `/v1/nodes/${b}`, { expectedRevision: await rev(), groupId: null });
    const last = (await api("PATCH", `/v1/groups/${g.group.groupId}`, { expectedRevision: await rev(), removeNodeIds: [c] })).json as { group: null | object };
    expect(last.group).toBeNull(); // ficou vazio → removido
    expect((await snap()).groups).toEqual([]);
    // novo grupo e DELETE (desagrupar): nós ficam, groupId some
    const g2 = (await api("POST", `/v1/workspaces/${ws}/groups`, { expectedRevision: await rev(), nodeIds: [b, c] })).json as { group: { groupId: string } };
    expect((await api("DELETE", `/v1/groups/${g2.group.groupId}`, { expectedRevision: await rev() })).status).toBe(204);
    s = await snap();
    expect(s.groups).toEqual([]); expect(s.nodes).toHaveLength(2); expect(s.nodes.every((n) => !n.groupId)).toBe(true);
    expect((await api("DELETE", `/v1/groups/${g2.group.groupId}`, { expectedRevision: await rev() })).status).toBe(404);
    expect((await api("POST", `/v1/workspaces/${ws}/groups`, { expectedRevision: 0, nodeIds: [b] })).status).toBe(409); // revisão velha
  }, 30_000);
});
