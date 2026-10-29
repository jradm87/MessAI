import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
const cli = (args: string[], env: Record<string, string>) => new Promise<{ code: number; out: string }>((res) => {
  const p = spawn(join(ROOT, "apps/cli/bin/mess"), args, { env: { ...process.env, ...env } }); let out = "";
  p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d)); p.on("exit", (code) => res({ code: code ?? 1, out }));
});
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const PORT = 47961;
let dir: string; let rt: ChildProcess; let token: string;
const H = () => ({ authorization: `Bearer ${token}`, "content-type": "application/json" });
const api = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: body ? H() : { authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : null });
  return { status: r.status, json: r.status === 204 ? null : await r.json() };
};
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "mess-cp-"));
  mkdirSync(join(dir, "proj/src/deep"), { recursive: true }); mkdirSync(join(dir, "proj/node_modules/x"), { recursive: true });
  writeFileSync(join(dir, "proj/README.md"), "# x"); writeFileSync(join(dir, "proj/src/deep/main.ts"), ""); writeFileSync(join(dir, "proj/node_modules/x/index.js"), "");
  rt = spawn("node", [join(ROOT, "apps/runtime/dist/index.js")], { env: { ...process.env, MESS_DATA_DIR: dir, MESS_PORT: String(PORT), SHELL: "/bin/sh" }, stdio: "ignore" });
  for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 200)); try { token = readFileSync(join(dir, "runtime.token"), "utf8").trim(); if ((await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: H() })).ok) break; } catch { /* subindo */ } }
}, 30_000);
afterAll(() => { rt?.kill(); rmSync(dir, { recursive: true, force: true }); });

describe("compositor: arquivos e anexos", () => {
  let ws: string, node: string;
  it("lista arquivos relativos ao cwd do terminal, ignorando node_modules", async () => {
    ws = ((await api("POST", "/v1/workspaces", { name: "Cp", cwd: join(dir, "proj") })).json as { workspaceId: string }).workspaceId;
    const r = (await api("POST", `/v1/workspaces/${ws}/nodes`, { expectedRevision: 0, kind: "terminal", title: "T", command: "cat", geometry: { x: 0, y: 0, w: 400, h: 300 } })).json as { node: { nodeId: string } };
    node = r.node.nodeId;
    const all = (await api("GET", `/v1/nodes/${node}/files`)).json as { path: string; dir: boolean }[];
    const paths = all.map((f) => f.path);
    expect(paths).toContain("README.md"); expect(paths).toContain("src/deep/main.ts"); expect(paths).toContain("src");
    expect(paths.some((p) => p.includes("node_modules"))).toBe(false);
    const q = (await api("GET", `/v1/nodes/${node}/files?q=main`)).json as { path: string }[];
    expect(q.map((f) => f.path)).toEqual(["src/deep/main.ts"]);
  });
  it("salva anexo em disco com permissão restrita e devolve o caminho", async () => {
    const r = await api("POST", `/v1/workspaces/${ws}/attachments`, { name: "foto estranha?.png", dataBase64: Buffer.from("png-fake").toString("base64") });
    expect(r.status).toBe(201);
    const a = r.json as { path: string; size: number };
    expect(a.size).toBe(8); expect(existsSync(a.path)).toBe(true); expect(a.path.startsWith(join(dir, "attachments", ws))).toBe(true);
    expect(a.path.endsWith("foto_estranha_.png")).toBe(true);
    expect((await api("POST", `/v1/workspaces/${ws}/attachments`, { name: "x", dataBase64: "" })).status).toBe(400);
  });

  it("chat: cliente posta como usuário, agente responde com mess say, histórico e limpar", async () => {
    const env = { MESS_SOCKET: join(dir, "agent.sock"), MESS_TOKEN: token, MESS_WORKSPACE_ID: ws, MESS_NODE_ID: node };
    const u = await api("POST", `/v1/nodes/${node}/chat`, { text: "oi, tudo bem?" });
    expect(u.status).toBe(201); expect(u.json).toMatchObject({ role: "user", thread: 1 });
    const r = await cli(["say", "**tudo** ótimo", "--thread", "2"], env);
    expect(r.code).toBe(0); expect(r.out).toContain("tópico 2");
    const all = (await api("GET", `/v1/nodes/${node}/chat`)).json as { role: string; thread: number; text: string }[];
    expect(all.map((m) => [m.role, m.thread])).toEqual([["user", 1], ["agent", 2]]);
    const t2 = (await api("GET", `/v1/nodes/${node}/chat?thread=2`)).json as { text: string }[];
    expect(t2).toHaveLength(1); expect(t2[0]!.text).toBe("**tudo** ótimo");
    const h = await cli(["chat"], env); expect(h.out).toContain("você: **tudo** ótimo"); expect(h.out).toContain("usuário: oi");
    expect((await api("DELETE", `/v1/nodes/${node}/chat?thread=2`)).json).toEqual({ removed: 1 });
    expect(((await api("GET", `/v1/nodes/${node}/chat`)).json as unknown[]).length).toBe(1);
    // chat só em terminais
    const note = (await api("POST", `/v1/workspaces/${ws}/nodes`, { expectedRevision: 1, kind: "note", title: "N", geometry: { x: 0, y: 0, w: 200, h: 100 } })).json as { node: { nodeId: string } };
    expect((await api("POST", `/v1/nodes/${note.node.nodeId}/chat`, { text: "x" })).status).toBe(400);
  });
});
