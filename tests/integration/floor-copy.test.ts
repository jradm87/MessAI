import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FloorCopyInfo, Workspace } from "@messai/contracts";

const ROOT = join(import.meta.dirname, "../..");
const PORT = 48020;
let dir: string; let repo: string; let rt: ChildProcess; let token: string;
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const git = (...a: string[]) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", env: GIT_ENV }).trim();
const api = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : null });
  return { status: r.status, json: r.status === 204 ? null : await r.json() };
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "mess-floor-copy-")); repo = join(dir, "repo"); mkdirSync(repo);
  git("init", "-q", "-b", "main");
  writeFileSync(join(repo, "README.md"), "# projeto\n");
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src/index.ts"), "export const x = 1;\n");
  mkdirSync(join(repo, "node_modules/pkg"), { recursive: true });
  writeFileSync(join(repo, "node_modules/pkg/index.js"), "module.exports = {};\n");
  mkdirSync(join(repo, "target/debug"), { recursive: true });
  writeFileSync(join(repo, "target/debug/bin"), "bin\n");
  git("add", "README.md", "src/index.ts"); git("commit", "-q", "-m", "inicial");

  rt = spawn("node", [join(ROOT, "apps/runtime/dist/index.js")], { env: { ...GIT_ENV, MESS_DATA_DIR: dir, MESS_PORT: String(PORT), SHELL: "/bin/sh" }, stdio: "ignore" });
  for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 200)); try { token = readFileSync(join(dir, "runtime.token"), "utf8").trim(); if ((await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: { authorization: `Bearer ${token}` } })).ok) break; } catch { /* subindo */ } }
}, 30_000);
afterAll(() => { rt?.kill(); rmSync(dir, { recursive: true, force: true }); });

describe("Andares: cópia isolada (CoW/independente) e pastas excluídas (#81)", () => {
  let ground: string;

  it("detecta suporte a CoW e lista pastas excluídas e presentes no projeto", async () => {
    ground = ((await api("POST", "/v1/workspaces", { name: "RepoIsolado", cwd: repo })).json as Workspace).workspaceId;
    const infoRes = await api("GET", `/v1/workspaces/${ground}/floor-copy-info`);
    expect(infoRes.status).toBe(200);
    const info = infoRes.json as FloorCopyInfo;
    expect(typeof info.cowSupported).toBe("boolean");
    expect(info.defaultExcludes).toContain("node_modules");
    expect(info.defaultExcludes).toContain("target");
    expect(info.presentDirs).toEqual(["node_modules", "src", "target"]);

    const put = await api("PUT", `/v1/workspaces/${ground}/floor-copy-info`, { excludeDirs: ["node_modules", "target", "custom_cache"] });
    expect(put.status).toBe(200);
    expect((put.json as FloorCopyInfo).excludeDirs).toEqual(["node_modules", "target", "custom_cache"]);
  });

  it("cria andar como cópia isolada com .git próprio e pula pastas excluídas", async () => {
    const r = await api("POST", `/v1/workspaces/${ground}/floors`, {
      name: "Experimento Isolado",
      floorType: "copy",
      excludeDirs: ["node_modules", "target"],
    });
    expect(r.status).toBe(201);
    const floor = r.json as Workspace;
    expect(floor.floorType).toBe("copy");
    expect(["cow", "independent"]).toContain(floor.copyMode);
    expect(floor.excludeDirs).toEqual(["node_modules", "target"]);

    expect(existsSync(join(floor.cwd, "README.md"))).toBe(true);
    expect(existsSync(join(floor.cwd, "src/index.ts"))).toBe(true);
    expect(existsSync(join(floor.cwd, "node_modules"))).toBe(false);
    expect(existsSync(join(floor.cwd, "target"))).toBe(false);
    // .git é um diretório real independente, não arquivo de worktree
    expect(statSync(join(floor.cwd, ".git")).isDirectory()).toBe(true);
    expect(git("worktree", "list")).not.toContain(floor.cwd);
    expect(git("branch", "--list", "experimento-isolado")).toBe("");
    expect(execFileSync("git", ["-C", floor.cwd, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8", env: GIT_ENV }).trim()).toBe("experimento-isolado");

    const del = await api("DELETE", `/v1/workspaces/${floor.workspaceId}`);
    expect(del.status).toBe(204);
    expect(existsSync(floor.cwd)).toBe(false);
  });

  it("permite cancelar a criação de uma cópia isolada em andamento e limpa o diretório parcial", async () => {
    const createPromise = api("POST", `/v1/workspaces/${ground}/floors`, {
      name: "Copia Cancelada",
      floorType: "copy",
      copyDelayMs: 120,
    });
    await new Promise((r) => setTimeout(r, 80));
    const cancelRes = await api("POST", `/v1/workspaces/${ground}/floors/cancel`, {});
    expect(cancelRes.status).toBe(200);
    expect((cancelRes.json as { cancelled: boolean }).cancelled).toBe(true);

    const res = await createPromise;
    expect(res.status).toBe(409);
    expect(existsSync(join(dir, "floors", ground, "copia-cancelada"))).toBe(false);
  });
});
