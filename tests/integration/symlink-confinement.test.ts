import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isWithinCanonicalRoot } from "@messai/domain";
import type { SearchHit, TreeEntry, Workspace } from "@messai/contracts";

const ROOT = join(import.meta.dirname, "../..");
const PORT = 48037;
let dir: string;
let wsDir: string;
let outsideDir: string;
let rt: ChildProcess;
let token: string;
let ws: Workspace;

const api = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : null,
  });
  return { status: r.status, json: r.status === 204 ? null : await r.json() };
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "mess-symlink-"));
  wsDir = join(dir, "workspace");
  outsideDir = join(dir, "workspace-outside"); // prefixo colidente para testar startsWith vs componentes
  mkdirSync(wsDir);
  mkdirSync(outsideDir);

  writeFileSync(join(wsDir, "inside.txt"), "INSIDE_OK", "utf8");
  writeFileSync(join(outsideDir, "secret.txt"), "TOP_SECRET_OUTSIDE", "utf8");
  writeFileSync(join(outsideDir, "keep.txt"), "DO_NOT_DELETE", "utf8");

  // Symlinks dentro do workspace apontando para fora
  symlinkSync(join(outsideDir, "secret.txt"), join(wsDir, "link-file.txt"));
  symlinkSync(outsideDir, join(wsDir, "link-dir"));

  // Symlink legítimo apontando para dentro do próprio workspace
  symlinkSync(join(wsDir, "inside.txt"), join(wsDir, "link-inside.txt"));

  rt = spawn("node", [join(ROOT, "apps/runtime/dist/index.js")], {
    env: { ...process.env, MESS_DATA_DIR: dir, MESS_PORT: String(PORT), SHELL: "/bin/sh" },
    stdio: "ignore",
  });
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 200));
    try {
      token = readFileSync(join(dir, "runtime.token"), "utf8").trim();
      if ((await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: { authorization: `Bearer ${token}` } })).ok) break;
    } catch { /* subindo */ }
  }
  ws = (await api("POST", "/v1/workspaces", { name: "SecWs", cwd: wsDir })).json as Workspace;
}, 30_000);

afterAll(() => {
  rt?.kill();
  rmSync(dir, { recursive: true, force: true });
});

describe("[MESS-01] Confinamento real do filesystem e symlinks (#86)", () => {
  it("isWithinCanonicalRoot valida ancestralidade por componentes (não startsWith)", () => {
    expect(isWithinCanonicalRoot("/tmp/ws", "/tmp/ws")).toBe(true);
    expect(isWithinCanonicalRoot("/tmp/ws", "/tmp/ws/a/b.txt")).toBe(true);
    expect(isWithinCanonicalRoot("/tmp/ws", "/tmp/ws-outside/secret.txt")).toBe(false);
    expect(isWithinCanonicalRoot("/tmp/ws", "/tmp/other")).toBe(false);
  });

  it("bloqueia leitura de arquivo e listagem de diretório via symlink apontando para fora", async () => {
    // Leitura legítima funciona
    const okRead = await api("GET", `/v1/workspaces/${ws.workspaceId}/file?path=inside.txt`);
    expect(okRead.status).toBe(200);

    // Leitura via symlink para fora é bloqueada com 403 FORBIDDEN
    const badFile = await api("GET", `/v1/workspaces/${ws.workspaceId}/file?path=link-file.txt`);
    expect(badFile.status).toBe(403);

    const badNested = await api("GET", `/v1/workspaces/${ws.workspaceId}/file?path=link-dir/secret.txt`);
    expect(badNested.status).toBe(403);

    // Listagem de diretório via symlink para fora é bloqueada com 403 FORBIDDEN
    const badTree = await api("GET", `/v1/workspaces/${ws.workspaceId}/tree?path=link-dir`);
    expect(badTree.status).toBe(403);

    // Listagem da raiz omite symlinks que apontam para fora
    const rootTree = (await api("GET", `/v1/workspaces/${ws.workspaceId}/tree`)).json as TreeEntry[];
    expect(rootTree.some((e) => e.name === "inside.txt")).toBe(true);
    expect(rootTree.some((e) => e.name === "link-file.txt")).toBe(false);
    expect(rootTree.some((e) => e.name === "link-dir")).toBe(false);
  });

  it("bloqueia write, touch, mkdir, rename e delete que atravessem symlinks para fora", async () => {
    // write sobre symlink de arquivo externo
    const w1 = await api("POST", `/v1/workspaces/${ws.workspaceId}/fs`, {
      op: "write",
      path: "link-file.txt",
      text: "HACKED",
    });
    expect(w1.status).toBe(403);
    expect(readFileSync(join(outsideDir, "secret.txt"), "utf8")).toBe("TOP_SECRET_OUTSIDE");

    // write dentro de symlink de diretório externo
    const w2 = await api("POST", `/v1/workspaces/${ws.workspaceId}/fs`, {
      op: "write",
      path: "link-dir/pwned.txt",
      text: "HACKED",
    });
    expect(w2.status).toBe(403);
    expect(existsSync(join(outsideDir, "pwned.txt"))).toBe(false);

    // touch dentro de symlink de diretório externo
    const t1 = await api("POST", `/v1/workspaces/${ws.workspaceId}/fs`, {
      op: "touch",
      path: "link-dir/touched.txt",
    });
    expect(t1.status).toBe(403);
    expect(existsSync(join(outsideDir, "touched.txt"))).toBe(false);

    // mkdir dentro de symlink de diretório externo
    const m1 = await api("POST", `/v1/workspaces/${ws.workspaceId}/fs`, {
      op: "mkdir",
      path: "link-dir/sub",
    });
    expect(m1.status).toBe(403);
    expect(existsSync(join(outsideDir, "sub"))).toBe(false);

    // rename para dentro de symlink externo
    const r1 = await api("POST", `/v1/workspaces/${ws.workspaceId}/fs`, {
      op: "rename",
      path: "inside.txt",
      to: "link-dir/moved.txt",
    });
    expect(r1.status).toBe(403);
    expect(existsSync(join(wsDir, "inside.txt"))).toBe(true);

    // delete através de symlink externo não apaga arquivo externo
    const d1 = await api("POST", `/v1/workspaces/${ws.workspaceId}/fs`, {
      op: "delete",
      path: "link-dir/keep.txt",
    });
    expect(d1.status).toBe(403);
    expect(existsSync(join(outsideDir, "keep.txt"))).toBe(true);
  });

  it("search não vaza nomes nem conteúdos de arquivos apontados por symlinks externos", async () => {
    const byName = (await api("GET", `/v1/workspaces/${ws.workspaceId}/search?q=secret`)).json as SearchHit[];
    expect(byName).toEqual([]);

    const byContent = (await api("GET", `/v1/workspaces/${ws.workspaceId}/search?q=TOP_SECRET_OUTSIDE&content=1`)).json as SearchHit[];
    expect(byContent).toEqual([]);
  });
});
