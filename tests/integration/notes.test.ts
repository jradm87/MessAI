import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const PORT = 47963;
let dir: string; let rt: ChildProcess; let token: string;
const api = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : null });
  return { status: r.status, json: r.status === 204 ? null : await r.json() };
};
const cli = (args: string[], env: Record<string, string>) => new Promise<{ code: number; out: string }>((res) => {
  const p = spawn(join(ROOT, "apps/cli/bin/mess"), args, { env: { ...process.env, ...env } }); let out = "";
  p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d)); p.on("exit", (code) => res({ code: code ?? 1, out }));
});
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "mess-notes-")); mkdirSync(join(dir, "proj"));
  rt = spawn("node", [join(ROOT, "apps/runtime/dist/index.js")], { env: { ...process.env, MESS_DATA_DIR: dir, MESS_PORT: String(PORT), SHELL: "/bin/sh" }, stdio: "ignore" });
  for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 200)); try { token = readFileSync(join(dir, "runtime.token"), "utf8").trim(); if ((await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: { authorization: `Bearer ${token}` } })).ok) break; } catch { /* subindo */ } }
}, 30_000);
afterAll(() => { rt?.kill(); rmSync(dir, { recursive: true, force: true }); });

type N = { nodeId: string; title: string; content?: string; filePath?: string; locked?: boolean; color?: string };
describe("notas em arquivo .md", () => {
  let ws: string, note: N, rev = 0; let env: Record<string, string>;
  const snap = async () => (await api("GET", `/v1/workspaces/${ws}`)).json as { workspace: { revision: number }; nodes: N[] };
  it("cria nota com .md no diretório do app e nome automático pela primeira linha", async () => {
    ws = ((await api("POST", "/v1/workspaces", { name: "N", cwd: join(dir, "proj") })).json as { workspaceId: string }).workspaceId;
    const r = (await api("POST", `/v1/workspaces/${ws}/nodes`, { expectedRevision: rev++, kind: "note", geometry: { x: 0, y: 0, w: 200, h: 100 }, content: "# Plano\n\ncorpo" })).json as { node: N };
    note = r.node;
    expect(note.title).toBe("Plano"); expect(note.filePath!.startsWith(join(dir, "notes", ws))).toBe(true);
    expect(readFileSync(note.filePath!, "utf8")).toBe("# Plano\n\ncorpo");
    const t = (await api("POST", `/v1/workspaces/${ws}/nodes`, { expectedRevision: rev++, kind: "terminal", title: "A", command: "cat", geometry: { x: 0, y: 0, w: 200, h: 100 } })).json as { node: { nodeId: string } };
    env = { MESS_SOCKET: join(dir, "agent.sock"), MESS_TOKEN: token, MESS_WORKSPACE_ID: ws, MESS_NODE_ID: t.node.nodeId };
  });
  it("editar conteúdo grava o arquivo e atualiza o título automático; renomear congela o título", async () => {
    await api("PATCH", `/v1/nodes/${note.nodeId}`, { expectedRevision: rev++, content: "Lista de compras\n- pão" });
    expect(readFileSync(note.filePath!, "utf8")).toBe("Lista de compras\n- pão");
    expect((await snap()).nodes.find((n) => n.nodeId === note.nodeId)!.title).toBe("Lista de compras");
    await api("PATCH", `/v1/nodes/${note.nodeId}`, { expectedRevision: rev++, title: "Minha nota" });
    await api("PATCH", `/v1/nodes/${note.nodeId}`, { expectedRevision: rev++, content: "outra coisa" });
    expect((await snap()).nodes.find((n) => n.nodeId === note.nodeId)!.title).toBe("Minha nota");
  });
  it("edição externa do arquivo aparece no snapshot", async () => {
    writeFileSync(note.filePath!, "editado no vim");
    const f = Date.now() / 1000 + 5; utimesSync(note.filePath!, f, f); // garante mtime maior
    expect((await snap()).nodes.find((n) => n.nodeId === note.nodeId)!.content).toBe("editado no vim");
  });
  it("bloqueio: agente não escreve (403), usuário sim; mess context avisa", async () => {
    await api("PATCH", `/v1/nodes/${note.nodeId}`, { expectedRevision: rev++, locked: true });
    const r = await cli(["note", "append", "Minha nota", "tentativa"], env);
    expect(r.code).not.toBe(0); expect(r.out).toContain("FORBIDDEN");
    expect((await api("PATCH", `/v1/nodes/${note.nodeId}`, { expectedRevision: rev++, content: "dono escreve" })).status).toBe(200);
    expect((await cli(["note", "path", "Minha nota"], env)).out.trim()).toBe(note.filePath);
    await api("PATCH", `/v1/nodes/${note.nodeId}`, { expectedRevision: rev++, locked: false });
    expect((await cli(["note", "append", "Minha nota", "agora pode"], env)).code).toBe(0); rev++; // a CLI também avança a revisão
    expect(readFileSync(note.filePath!, "utf8")).toBe("dono escreve\nagora pode");
  });
  it("mover para o projeto move o arquivo; apagar nó mantém arquivo do projeto", async () => {
    const dest = join(dir, "proj", "docs", "Minha nota.md");
    const old = note.filePath!;
    const r = await api("PATCH", `/v1/nodes/${note.nodeId}`, { expectedRevision: rev++, filePath: dest, color: "#4cd964" });
    expect(r.status).toBe(200); expect((r.json as N).filePath).toBe(dest); expect((r.json as N).color).toBe("#4cd964");
    expect(existsSync(old)).toBe(false); expect(readFileSync(dest, "utf8")).toBe("dono escreve\nagora pode");
    expect((await api("PATCH", `/v1/nodes/${note.nodeId}`, { expectedRevision: rev, filePath: dest.replace(".md", ".exe") })).status).toBe(400);
    await api("DELETE", `/v1/nodes/${note.nodeId}`, { expectedRevision: rev++ });
    expect(existsSync(dest)).toBe(true);
  });
  it("vincula .md existente sem copiar; nota do app é removida com o nó", async () => {
    const f = join(dir, "proj", "README.md"); writeFileSync(f, "# Leia-me\nconteúdo");
    const r = (await api("POST", `/v1/workspaces/${ws}/nodes`, { expectedRevision: rev++, kind: "note", geometry: { x: 0, y: 0, w: 200, h: 100 }, filePath: f })).json as { node: N };
    expect(r.node.title).toBe("Leia-me"); expect(r.node.content).toBe("# Leia-me\nconteúdo"); expect(r.node.filePath).toBe(f);
    expect((await api("POST", `/v1/workspaces/${ws}/nodes`, { expectedRevision: rev, kind: "note", geometry: { x: 0, y: 0, w: 200, h: 100 }, filePath: join(dir, "proj", "x.png") })).status).toBe(400);
    const app = (await api("POST", `/v1/workspaces/${ws}/nodes`, { expectedRevision: rev++, kind: "note", geometry: { x: 0, y: 0, w: 200, h: 100 }, content: "" })).json as { node: N };
    expect(app.node.title).toBe("Nota"); expect(existsSync(app.node.filePath!)).toBe(true);
    await api("DELETE", `/v1/nodes/${app.node.nodeId}`, { expectedRevision: rev++ });
    expect(existsSync(app.node.filePath!)).toBe(false);
  });
});
