import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// #75 — Hooks de andar (setup / run / teardown, rodar/parar e logs ao vivo) na visão geral de andares.
const ROOT = join(import.meta.dirname, "../..");
const PORT = 48019;
let dataDir: string; let repo: string; let runtime: ChildProcess; let app: ElectronApplication; let page: Page; let token: string;
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const api = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : null });
  return r.status === 204 ? null : r.json();
};

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "mess-e2e-fhooks-"));
  repo = join(dataDir, "repo"); mkdirSync(repo);
  execFileSync("git", ["-C", repo, "init", "-q", "-b", "main"], { env: GIT_ENV });
  writeFileSync(join(repo, "README.md"), "# app\n");
  execFileSync("git", ["-C", repo, "add", "."], { env: GIT_ENV });
  execFileSync("git", ["-C", repo, "commit", "-q", "-m", "init"], { env: GIT_ENV });

  runtime = spawn("node", [join(ROOT, "apps/runtime/dist/index.js")], { env: { ...GIT_ENV, MESS_DATA_DIR: dataDir, MESS_PORT: String(PORT), SHELL: "/bin/sh" }, stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { await sleep(250); try { token = readFileSync(join(dataDir, "runtime.token"), "utf8").trim(); up = (await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: { authorization: `Bearer ${token}` } })).ok; } catch { /* subindo */ } }
  if (!up) throw new Error(`runtime de teste não subiu na porta ${PORT}`);

  const ground = (await api("POST", "/v1/workspaces", { name: "HooksProj", cwd: repo })) as { workspaceId: string };
  await api("POST", `/v1/workspaces/${ground.workspaceId}/floors`, {
    name: "Andar Hooks",
    hooks: { setup: 'echo "SETUP_E2E:$MESS_FLOOR_NAME"', run: 'echo "RUN_E2E_VIVO"' },
  });

  app = await electron.launch({ args: ["."], cwd: join(ROOT, "apps/desktop"), env: { ...process.env, MESS_DATA_DIR: dataDir, MESS_PORT: String(PORT) } });
  page = await app.firstWindow();
  await page.waitForSelector(".side li.ws:has-text('HooksProj')");
  await page.click(".side li.ws:has-text('HooksProj')");
}, 60_000);

afterAll(async () => {
  await app?.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
  await app?.close().catch(() => {});
  try { runtime?.kill(); } catch { /* */ }
  for (let i = 0; i < 15 && runtime && runtime.exitCode === null; i++) await sleep(100);
  if (runtime && runtime.exitCode === null) { try { runtime.kill("SIGKILL"); } catch { /* */ } }
  rmSync(dataDir, { recursive: true, force: true });
});

describe("Hooks de andar na interface (#75)", () => {
  it("abre a visão de andares, inspeciona o log do setup automático e roda a seção run ao vivo", async () => {
    await page.keyboard.press("Control+Shift+Backslash");
    await page.waitForSelector('[data-testid="overview"]');
    await page.click('[data-testid="floor-hooks-btn"]');
    await page.waitForSelector('[data-testid="floor-hooks-modal"]');

    await page.waitForFunction(() => (document.querySelector('[data-testid="hook-logs"]')?.textContent ?? "").includes("SETUP_E2E:Andar Hooks"), undefined, { timeout: 10_000 });
    await page.click('[data-testid="hook-run-run"]');
    await page.waitForFunction(() => (document.querySelector('[data-testid="hook-logs"]')?.textContent ?? "").includes("RUN_E2E_VIVO"), undefined, { timeout: 10_000 });
    expect(await page.locator('[data-testid="hook-state-run"]').innerText()).toContain("concluído");
  });
});
