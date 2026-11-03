import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Workspace } from "@messai/contracts";

// #84 — Descarregar e recarregar espaços e terminais para poupar recursos.
const ROOT = join(import.meta.dirname, "../..");
const PORT = 48031;
let dataDir: string;
let runtime: ChildProcess;
let app: ElectronApplication;
let page: Page;
let token: string;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const api = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : null,
  });
  return r.status === 204 ? null : r.json();
};

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "mess-e2e-unload-"));
  const wsDir = join(dataDir, "ws");
  mkdirSync(wsDir);

  runtime = spawn("node", [join(ROOT, "apps/runtime/dist/index.js")], {
    env: { ...process.env, MESS_DATA_DIR: dataDir, MESS_PORT: String(PORT), SHELL: "/bin/sh" },
    stdio: "ignore",
  });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    await sleep(250);
    try {
      token = readFileSync(join(dataDir, "runtime.token"), "utf8").trim();
      up = (await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: { authorization: `Bearer ${token}` } })).ok;
    } catch { /* subindo */ }
  }
  if (!up) throw new Error(`runtime de teste não subiu na porta ${PORT}`);

  const ws = (await api("POST", "/v1/workspaces", { name: "HeavyProj", cwd: wsDir })) as Workspace;
  await api("POST", `/v1/workspaces/${ws.workspaceId}/nodes`, {
    expectedRevision: 0,
    kind: "terminal",
    title: "AgentTerm",
    geometry: { x: 40, y: 40, w: 600, h: 360 },
  });

  app = await electron.launch({
    args: ["."],
    cwd: join(ROOT, "apps/desktop"),
    env: { ...process.env, MESS_DATA_DIR: dataDir, MESS_PORT: String(PORT) },
  });
  page = await app.firstWindow();
  await page.waitForSelector(".side li.ws:has-text('HeavyProj')");
  await page.click(".side li.ws:has-text('HeavyProj')");
  await page.waitForSelector('[data-testid="term-unload-btn"]', { timeout: 20_000 });
}, 45_000);

afterAll(async () => {
  await app?.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
  await app?.close().catch(() => {});
  try { runtime?.kill(); } catch { /* */ }
  for (let i = 0; i < 15 && runtime && runtime.exitCode === null; i++) await sleep(100);
  if (runtime && runtime.exitCode === null) { try { runtime.kill("SIGKILL"); } catch { /* */ } }
  rmSync(dataDir, { recursive: true, force: true });
});

describe("E2E #84 — Descarregar e recarregar espaços e terminais", () => {
  it("descarrega terminal individual, recarrega, e descarrega/recarrega espaço na sidebar", async () => {
    // 1. Descarrega o terminal individual pela barra do nó
    await page.locator('[data-testid="term-unload-btn"]').click();
    await page.waitForSelector('[data-testid="term-reload-btn"]', { timeout: 5_000 });

    // 2. Recarrega o terminal individual
    await page.locator('[data-testid="term-reload-btn"]').click();
    await page.waitForSelector('[data-testid="term-unload-btn"]', { timeout: 5_000 });

    // 3. Descarrega o espaço inteiro pelo menu de contexto da sidebar
    await page.locator(".side li.ws:has-text('HeavyProj')").click({ button: "right" });
    await page.locator('[data-testid="ctx-ws-unload"]').click();
    await page.waitForSelector('[data-testid="ws-unloaded-badge"]', { timeout: 5_000 });

    // 4. Recarrega o espaço pelo menu de contexto
    await page.locator(".side li.ws:has-text('HeavyProj')").click({ button: "right" });
    await page.locator('[data-testid="ctx-ws-reload"]').click();
    await page.waitForSelector('[data-testid="ws-unloaded-badge"]', { state: "detached", timeout: 5_000 });
    expect(await page.locator('[data-testid="ws-unloaded-badge"]').count()).toBe(0);
  }, 30_000);
});
