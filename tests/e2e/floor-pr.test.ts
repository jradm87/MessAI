import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FloorPrState, Workspace } from "@messai/contracts";

// #31 — Pull request nos andares (+ hosts Git configuráveis) pela visão geral de andares.
const ROOT = join(import.meta.dirname, "../..");
const PORT = 48025;
let dataDir: string; let repo: string; let runtime: ChildProcess; let app: ElectronApplication; let page: Page; let token: string;
let groundId: string; let floorId: string;
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const api = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : null });
  return r.status === 204 ? null : r.json();
};

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "mess-e2e-fpr-"));
  repo = join(dataDir, "repo"); mkdirSync(repo);
  execFileSync("git", ["-C", repo, "init", "-q", "-b", "main"], { env: GIT_ENV });
  execFileSync("git", ["-C", repo, "remote", "add", "origin", "git@github.com:jradm87/MessAI.git"], { env: GIT_ENV });
  writeFileSync(join(repo, "README.md"), "# app\n");
  execFileSync("git", ["-C", repo, "add", "README.md"], { env: GIT_ENV });
  execFileSync("git", ["-C", repo, "commit", "-q", "-m", "init"], { env: GIT_ENV });

  runtime = spawn("node", [join(ROOT, "apps/runtime/dist/index.js")], { env: { ...GIT_ENV, MESS_DATA_DIR: dataDir, MESS_PORT: String(PORT), SHELL: "/bin/sh" }, stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    await sleep(250);
    try {
      token = readFileSync(join(dataDir, "runtime.token"), "utf8").trim();
      up = (await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: { authorization: `Bearer ${token}` } })).ok;
    } catch { /* subindo */ }
  }
  if (!up) throw new Error(`runtime de teste não subiu na porta ${PORT}`);

  groundId = ((await api("POST", "/v1/workspaces", { name: "PrProj", cwd: repo })) as Workspace).workspaceId;
  floorId = ((await api("POST", `/v1/workspaces/${groundId}/floors`, { name: "Andar PR", branch: "feat/pr-ui" })) as Workspace).workspaceId;

  app = await electron.launch({ args: ["."], cwd: join(ROOT, "apps/desktop"), env: { ...process.env, MESS_DATA_DIR: dataDir, MESS_PORT: String(PORT) } });
  page = await app.firstWindow();
  await page.waitForSelector(".side li.ws:has-text('PrProj')");
  await page.click(".side li.ws:has-text('PrProj')");
}, 60_000);

afterAll(async () => {
  await app?.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
  await app?.close().catch(() => {});
  try { runtime?.kill(); } catch { /* */ }
  for (let i = 0; i < 15 && runtime && runtime.exitCode === null; i++) await sleep(100);
  if (runtime && runtime.exitCode === null) { try { runtime.kill("SIGKILL"); } catch { /* */ } }
  rmSync(dataDir, { recursive: true, force: true });
});

describe("Pull request nos andares na interface (#31)", () => {
  it("abre o modal de PR no andar, cria um Pull Request, exibe selos de revisão/checks e faz merge rápido", async () => {
    await page.keyboard.press("Control+Shift+Backslash");
    await page.waitForSelector('[data-testid="floor-pr-btn"]');
    await page.click('[data-testid="floor-pr-btn"]');
    await page.waitForSelector('[data-testid="floor-pr-modal"]');

    await page.fill('[data-testid="pr-title-input"]', "feat: PR direto do andar");
    await page.fill('[data-testid="pr-body-input"]', "Descrição do PR");
    await page.click('[data-testid="pr-create-submit"]');

    await page.waitForSelector('[data-testid="pr-modal-state"]');
    expect(await page.textContent('[data-testid="pr-modal-state"]')).toContain("PR #1 · open");

    // Verifica selos na visão geral do andar ao fundo
    await page.waitForSelector('[data-testid="floor-pr-badge"]');
    expect(await page.textContent('[data-testid="floor-pr-review"]')).toContain("revisão pendente");
    expect(await page.textContent('[data-testid="floor-pr-checks"]')).toContain("checks verdes");

    // Ação rápida: Fazer Merge do PR
    await page.click('[data-testid="pr-action-merge"]');
    await page.waitForFunction(async (p) => {
      const r = await fetch(`http://127.0.0.1:${p.port}/v1/workspaces/${p.floorId}/pr`, { headers: { authorization: `Bearer ${p.token}` } });
      const st = (await r.json()) as FloorPrState;
      return st.state === "merged";
    }, { port: PORT, floorId, token }, { timeout: 10_000 });

    expect(await page.textContent('[data-testid="floor-pr-badge"]')).toContain("PR #1 · merged");
    expect(await page.textContent('[data-testid="floor-pr-review"]')).toContain("aprovado");
  });
});
