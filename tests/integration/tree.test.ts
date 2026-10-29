import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const PORT = 47967;
let dir: string; let rt: ChildProcess; let token: string; let ws: string;
const api = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : null });
  return { status: r.status, json: r.status === 204 ? null : await r.json() };
};
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "messy-tree-"));
  mkdirSync(join(dir, "proj/src/deep"), { recursive: true }); mkdirSync(join(dir, "proj/node_modules/x"), { recursive: true });
  writeFileSync(join(dir, "proj/README.md"), "# Projeto\n\nolá mundo\n"); writeFileSync(join(dir, "proj/src/deep/main.ts"), "export const answer = 42;\n"); writeFileSync(join(dir, "proj/bin.dat"), Buffer.from([1, 0, 2, 0, 3])); writeFileSync(join(dir, "proj/node_modules/x/i.js"), "answer");
  writeFileSync(join(dir, "segredo.txt"), "fora do espaço");
  rt = spawn("node", [join(ROOT, "apps/runtime/dist/index.js")], { env: { ...process.env, MESSY_DATA_DIR: dir, MESSY_PORT: String(PORT), SHELL: "/bin/sh" }, stdio: "ignore" });
  for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 200)); try { token = readFileSync(join(dir, "runtime.token"), "utf8").trim(); if ((await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: { authorization: `Bearer ${token}` } })).ok) break; } catch { /* subindo */ } }
  ws = ((await api("POST", "/v1/workspaces", { name: "Tree", cwd: join(dir, "proj") })).json as { workspaceId: string }).workspaceId;
}, 30_000);
afterAll(() => { rt?.kill(); rmSync(dir, { recursive: true, force: true }); });

type E = { name: string; path: string; dir: boolean; size: number };
describe("árvore de arquivos", () => {
  it("lista diretórios primeiro, navega e recusa sair da raiz", async () => {
    const root = (await api("GET", `/v1/workspaces/${ws}/tree`)).json as E[];
    expect(root.map((e) => e.name)).toEqual(["node_modules", "src", "bin.dat", "README.md"]);
    const src = (await api("GET", `/v1/workspaces/${ws}/tree?path=src`)).json as E[];
    expect(src).toEqual([expect.objectContaining({ name: "deep", path: "src/deep", dir: true })]);
    expect((await api("GET", `/v1/workspaces/${ws}/tree?path=..`)).status).toBe(400);
    expect((await api("GET", `/v1/workspaces/${ws}/tree?path=src/../../`)).status).toBe(400);
    expect((await api("GET", `/v1/workspaces/${ws}/file?path=../segredo.txt`)).status).toBe(400);
    expect((await api("GET", `/v1/workspaces/${ws}/tree?path=nao-existe`)).status).toBe(404);
  });
  it("lê texto, detecta binário e cria nó tree com conteúdo padrão", async () => {
    const f = (await api("GET", `/v1/workspaces/${ws}/file?path=src/deep/main.ts`)).json as { text: string; binary: boolean; truncated: boolean };
    expect(f).toMatchObject({ binary: false, truncated: false, text: "export const answer = 42;\n" });
    expect(((await api("GET", `/v1/workspaces/${ws}/file?path=bin.dat`)).json as { binary: boolean }).binary).toBe(true);
    expect((await api("GET", `/v1/workspaces/${ws}/file?path=src`)).status).toBe(400);
    const n = (await api("POST", `/v1/workspaces/${ws}/nodes`, { expectedRevision: 0, kind: "tree", geometry: { x: 0, y: 0, w: 300, h: 400 } })).json as { node: { kind: string; title: string; content: string } };
    expect(n.node).toMatchObject({ kind: "tree", title: "Arquivos" }); expect(JSON.parse(n.node.content)).toEqual({ root: "", mode: "list" });
  });
  it("mkdir, touch, write, rename e delete confinados", async () => {
    expect((await api("POST", `/v1/workspaces/${ws}/fs`, { op: "mkdir", path: "docs/guias" })).status).toBe(200);
    expect((await api("POST", `/v1/workspaces/${ws}/fs`, { op: "touch", path: "docs/guias/novo.md" })).status).toBe(200);
    expect((await api("POST", `/v1/workspaces/${ws}/fs`, { op: "touch", path: "docs/guias/novo.md" })).status).toBe(409);
    expect((await api("POST", `/v1/workspaces/${ws}/fs`, { op: "write", path: "docs/guias/novo.md", text: "# novo" })).status).toBe(200);
    expect(readFileSync(join(dir, "proj/docs/guias/novo.md"), "utf8")).toBe("# novo");
    expect((await api("POST", `/v1/workspaces/${ws}/fs`, { op: "rename", path: "docs/guias/novo.md", to: "docs/renomeado.md" })).json).toEqual({ path: "docs/renomeado.md" });
    expect((await api("POST", `/v1/workspaces/${ws}/fs`, { op: "delete", path: "../segredo.txt" })).status).toBe(400);
    expect((await api("POST", `/v1/workspaces/${ws}/fs`, { op: "delete", path: "" })).status).toBe(400);
    expect(existsSync(join(dir, "segredo.txt"))).toBe(true);
    expect((await api("POST", `/v1/workspaces/${ws}/fs`, { op: "delete", path: "docs" })).status).toBe(200);
    expect(existsSync(join(dir, "proj/docs"))).toBe(false);
  });
  it("busca por nome ignora node_modules; busca por conteúdo traz linha", async () => {
    const byName = (await api("GET", `/v1/workspaces/${ws}/search?q=main`)).json as { path: string }[];
    expect(byName.map((h) => h.path)).toEqual(["src/deep/main.ts"]);
    const byContent = (await api("GET", `/v1/workspaces/${ws}/search?q=answer&content=1`)).json as { path: string; line: number; text: string }[];
    expect(byContent).toEqual([{ path: "src/deep/main.ts", line: 1, text: "export const answer = 42;" }]);
    expect((await api("GET", `/v1/workspaces/${ws}/search?q=`)).json).toEqual([]);
  });
});
