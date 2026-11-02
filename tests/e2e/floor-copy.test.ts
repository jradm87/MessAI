import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Workspace } from "@messai/contracts";

// #81 — Andares: cópia isolada (CoW/independente) e pastas excluídas pelo diálogo de criação.
const ROOT = join(import.meta.dirname, "../..");
const PORT = 48021;
let dataDir: string; let repo: string; let runtime: ChildProcess; let app: ElectronApplication; let page: Page; let token: string; let groundId: string;
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const api = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : null });
  return r.status === 204 ? null : r.json();
};

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "mess-e2e-fcopy-"));
  repo = join(dataDir, "repo"); mkdirSync(repo);
  execFileSync("git", ["-C", repo, "init", "-q", "-b", "main"], { env: GIT_ENV });
  writeFileSync(join(repo, "README.md"), "# app\n");
  mkdirSync(join(repo, "node_modules/foo"), { recursive: true });
  writeFileSync(join(repo, "node_modules/foo/index.js"), "1\n");
  execFileSync("git", ["-C", repo, "add", "README.md"], { env: GIT_ENV });
  execFileSync("git", ["-C", repo, "commit", "-q", "-m", "init"], { env: GIT_ENV });

  runtime = spawn("node", [join(ROOT, "apps/runtime/dist/index.js")], { env: { ...GIT_ENV, MESS_DATA_DIR: dataDir, MESS_PORT: String(PORT), SHELL: "/bin/sh" }, stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { await sleep(250); try { token = readFileSync(join(dataDir, "runtime.token"), "utf8").trim(); up = (await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: { authorization: `Bearer ${token}` } })).ok; } catch { /* subindo */ } }
  if (!up) throw new Error(`runtime de teste não subiu na porta ${PORT}`);

  groundId = ((await api("POST", "/v1/workspaces", { name: "CopyProj", cwd: repo })) as Workspace).workspaceId;

  app = await electron.launch({ args: ["."], cwd: join(ROOT, "apps/desktop"), env: { ...process.env, MESS_DATA_DIR: dataDir, MESS_PORT: String(PORT) } });
  page = await app.firstWindow();
  await page.waitForSelector(".side li.ws:has-text('CopyProj')");
  await page.click(".side li.ws:has-text('CopyProj')");
}, 60_000);

afterAll(async () => {
  await app?.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
  await app?.close().catch(() => {});
  try { runtime?.kill(); } catch { /* */ }
  for (let i = 0; i < 15 && runtime && runtime.exitCode === null; i++) await sleep(100);
  if (runtime && runtime.exitCode === null) { try { runtime.kill("SIGKILL"); } catch { /* */ } }
  rmSync(dataDir, { recursive: true, force: true });
});

describe("Cópia isolada de andar na interface (#81)", () => {
  it("abre o diálogo de novo andar, escolhe Cópia isolada com pastas excluídas e cria o andar", async () => {
    await page.keyboard.press("Control+Shift+Backslash");
    await page.waitForSelector('[data-testid="ov-new"]');
    await page.click('[data-testid="ov-new"]');
    await page.waitForSelector('[data-testid="floor-dialog"]');

    await page.fill('[data-testid="floor-name"]', "Clone Isolado");
    await page.click('[data-testid="floor-adv-toggle"]');
    await page.click('[data-testid="floor-type-copy"]');
    await page.waitForSelector('[data-testid="floor-cow-badge"]');
    expect(await page.locator('[data-testid="floor-excludes"]').inputValue()).toContain("node_modules");

    await page.click('[data-testid="floor-submit"]');
    await page.waitForFunction(async (p) => {
      const r = await fetch(`http://127.0.0.1:${p.port}/v1/workspaces/${p.groundId}/floors`, { headers: { authorization: `Bearer ${p.token}` } });
      const list = (await r.json()) as { name: string }[];
      return list.some((f) => f.name === "Clone Isolado");
    }, { port: PORT, groundId, token }, { timeout: 10_000 });

    const floors = (await api("GET", `/v1/workspaces/${groundId}/floors`)) as Workspace[];
    const created = floors.find((f) => f.name === "Clone Isolado")!;
    expect(created.floorType).toBe("copy");
    expect(existsSync(join(created.cwd, "README.md"))).toBe(true);
    expect(existsSync(join(created.cwd, "node_modules"))).toBe(false);
  });
});
