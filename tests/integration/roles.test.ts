import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const PORT = 47962;
let dir: string; let rt: ChildProcess; let token: string;
const api = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : null });
  return { status: r.status, json: r.status === 204 ? null : await r.json() };
};
const wait = async (pred: () => Promise<boolean>, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await pred()) return true; await new Promise((r) => setTimeout(r, 150)); } return false; };
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "mess-roles-"));
  mkdirSync(join(dir, "proj/.maestri/roles/revisor"), { recursive: true });
  writeFileSync(join(dir, "proj/.maestri/roles/revisor/role.json"), JSON.stringify({ name: "Revisor", badge: "RV", prompt: "Revise sem alterar código." }));
  rt = spawn("node", [join(ROOT, "apps/runtime/dist/index.js")], { env: { ...process.env, MESS_DATA_DIR: dir, MESS_PORT: String(PORT), SHELL: "/bin/sh" }, stdio: "ignore" });
  for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 200)); try { token = readFileSync(join(dir, "runtime.token"), "utf8").trim(); if ((await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: { authorization: `Bearer ${token}` } })).ok) break; } catch { /* subindo */ } }
}, 30_000);
afterAll(() => { rt?.kill(); rmSync(dir, { recursive: true, force: true }); });

describe("papéis (responsabilidades)", () => {
  let ws: string, role: { roleId: string };
  it("CRUD com nome único e badge padrão", async () => {
    ws = ((await api("POST", "/v1/workspaces", { name: "R", cwd: join(dir, "proj") })).json as { workspaceId: string }).workspaceId;
    const r = await api("POST", "/v1/roles", { name: "Dev backend", instructions: "Foque em APIs." });
    expect(r.status).toBe(201); role = r.json as { roleId: string }; expect(r.json).toMatchObject({ badge: "DE" });
    expect((await api("POST", "/v1/roles", { name: "dev BACKEND", instructions: "" })).status).toBe(409);
    expect((await api("PATCH", `/v1/roles/${role.roleId}`, { badge: "api" })).json).toMatchObject({ badge: "API" });
  });
  it("descobre role.json do projeto (compatível com .maestri) e exporta como .messai", async () => {
    const d = (await api("POST", "/v1/roles/discover", { dir: join(dir, "proj") })).json as { imported: { name: string; badge: string; instructions: string }[] };
    expect(d.imported).toHaveLength(1); expect(d.imported[0]).toMatchObject({ name: "Revisor", badge: "RV", instructions: "Revise sem alterar código." });
    const e = (await api("POST", `/v1/roles/${role.roleId}/export`, { dir: join(dir, "proj") })).json as { path: string };
    expect(e.path).toBe(join(dir, "proj/.messai/roles/dev-backend/role.json")); expect(existsSync(e.path)).toBe(true);
    expect(JSON.parse(readFileSync(e.path, "utf8"))).toEqual({ name: "Dev backend", badge: "API", instructions: "Foque em APIs." });
  });
  it("injeta MESS_ROLE e instruções no ambiente do terminal na partida", async () => {
    const out = join(dir, "env.txt");
    const r = await api("POST", `/v1/workspaces/${ws}/nodes`, { expectedRevision: 0, kind: "terminal", title: "T", command: "sh", args: ["-c", `printf '%s|%s' "$MESS_ROLE" "$MESS_ROLE_INSTRUCTIONS" > ${out}`], geometry: { x: 0, y: 0, w: 400, h: 300 }, roleId: role.roleId });
    expect(r.status).toBe(201); expect((r.json as { node: { roleId: string } }).node.roleId).toBe(role.roleId);
    expect(await wait(async () => existsSync(out))).toBe(true);
    expect(readFileSync(out, "utf8")).toBe("Dev backend|Sua responsabilidade neste terminal: Dev backend.\nFoque em APIs.");
    expect((await api("POST", `/v1/workspaces/${ws}/nodes`, { expectedRevision: 1, kind: "terminal", title: "X", geometry: { x: 0, y: 0, w: 400, h: 300 }, roleId: "nao-existe" })).status).toBe(404);
  });
  it("reatribuir papel em terminal rodando reinicia só o processo (mesma sessão, pid novo)", async () => {
    const r = (await api("POST", `/v1/workspaces/${ws}/nodes`, { expectedRevision: 1, kind: "terminal", title: "Cat", command: "cat", geometry: { x: 0, y: 0, w: 400, h: 300 } })).json as { node: { nodeId: string }; session: { sessionId: string; pid: number } };
    expect(await wait(async () => ((await api("GET", `/v1/sessions/${r.session.sessionId}`)).json as { state: string }).state === "running")).toBe(true);
    const pid1 = ((await api("GET", `/v1/sessions/${r.session.sessionId}`)).json as { pid: number }).pid;
    const p = await api("PATCH", `/v1/nodes/${r.node.nodeId}`, { expectedRevision: 2, roleId: role.roleId });
    expect(p.status).toBe(200); expect((p.json as { roleId: string }).roleId).toBe(role.roleId);
    expect(await wait(async () => { const s = (await api("GET", `/v1/sessions/${r.session.sessionId}`)).json as { state: string; pid: number | null }; return s.state === "running" && !!s.pid && s.pid !== pid1; })).toBe(true);
    await new Promise((x) => setTimeout(x, 600)); // a saída do processo antigo não pode derrubar o novo
    expect(((await api("GET", `/v1/sessions/${r.session.sessionId}`)).json as { state: string }).state).toBe("running");
    // apagar o papel limpa os nós
    expect((await api("DELETE", `/v1/roles/${role.roleId}`)).status).toBe(204);
    const snap = (await api("GET", `/v1/workspaces/${ws}`)).json as { nodes: { roleId?: string }[] };
    expect(snap.nodes.every((n) => !n.roleId)).toBe(true);
  });
});
