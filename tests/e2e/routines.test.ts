import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Workspace } from "@messai/contracts";

// #27 — Rotinas agendadas e recorrentes na interface.
const ROOT = join(import.meta.dirname, "../..");
const PORT = 48035;
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
  dataDir = mkdtempSync(join(tmpdir(), "mess-e2e-routines-"));
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

  await api("POST", "/v1/workspaces", { name: "CronSpace", cwd: wsDir }) as Workspace;

  app = await electron.launch({
    args: ["."],
    cwd: join(ROOT, "apps/desktop"),
    env: { ...process.env, MESS_DATA_DIR: dataDir, MESS_PORT: String(PORT) },
  });
  page = await app.firstWindow();
  await page.waitForSelector(".side li.ws:has-text('CronSpace')");
  await page.click(".side li.ws:has-text('CronSpace')");
}, 45_000);

afterAll(async () => {
  await app?.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
  await app?.close().catch(() => {});
  try { runtime?.kill(); } catch { /* */ }
  for (let i = 0; i < 15 && runtime && runtime.exitCode === null; i++) await sleep(100);
  if (runtime && runtime.exitCode === null) { try { runtime.kill("SIGKILL"); } catch { /* */ } }
  rmSync(dataDir, { recursive: true, force: true });
});

describe("E2E #27 — Rotinas agendadas na interface", () => {
  it("abre o diálogo de rotinas, cria uma rotina, executa agora e verifica a saída", async () => {
    await page.click('[data-testid="routines-open-btn"]');
    await page.waitForSelector('[data-testid="routines-dialog"]');

    await page.fill('[data-testid="routine-name-input"]', "Check Health");
    await page.fill('[data-testid="routine-payload-input"]', "echo ROUTINE_E2E_OK");
    await page.fill('[data-testid="routine-interval-input"]', "60");
    await page.click('[data-testid="routine-create-btn"]');

    await page.waitForSelector('[data-testid="routine-row"]');
    await page.click('[data-testid="routine-run-btn"]');

    await page.waitForSelector('[data-testid="routine-last-output"]');
    expect(await page.textContent('[data-testid="routine-last-output"]')).toContain("ROUTINE_E2E_OK");
    expect(await page.textContent('[data-testid="routine-run-count"]')).toBe("1");
  }, 30_000);
});
