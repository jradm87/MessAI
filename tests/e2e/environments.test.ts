import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EnvVarEntry, Workspace } from "@messai/contracts";

// #72 — Editor de Ambientes (Preferências → Geral → Ambientes).
const ROOT = join(import.meta.dirname, "../..");
const PORT = 48027;
let dataDir: string;
let runtime: ChildProcess;
let app: ElectronApplication;
let page: Page;
let token: string;
let wsId: string;

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
  dataDir = mkdtempSync(join(tmpdir(), "mess-e2e-env-"));
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

  wsId = ((await api("POST", "/v1/workspaces", { name: "EnvUI", cwd: wsDir })) as Workspace).workspaceId;

  app = await electron.launch({
    args: ["."],
    cwd: join(ROOT, "apps/desktop"),
    env: { ...process.env, MESS_DATA_DIR: dataDir, MESS_PORT: String(PORT) },
  });
  page = await app.firstWindow();
  await page.waitForSelector(".side li.ws:has-text('EnvUI')");
  await page.click(".side li.ws:has-text('EnvUI')");
}, 60_000);

afterAll(async () => {
  await app?.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
  await app?.close().catch(() => {});
  try { runtime?.kill(); } catch { /* */ }
  for (let i = 0; i < 15 && runtime && runtime.exitCode === null; i++) await sleep(100);
  if (runtime && runtime.exitCode === null) { try { runtime.kill("SIGKILL"); } catch { /* */ } }
  rmSync(dataDir, { recursive: true, force: true });
});

describe("Ambientes na tela de Preferências (#72)", () => {
  it("adiciona variáveis globais e por espaço, mascara segredos e salva no runtime", async () => {
    await page.click('[data-testid="settings"]');
    await page.waitForSelector('[data-testid="prefs"]');
    await page.click('[data-testid="prefs-tab-general"]');
    await page.waitForSelector('[data-testid="env-scope"]');

    // Adiciona uma variável sensível global
    await page.click('[data-testid="env-add"]');
    await page.fill('[data-testid="env-key-0"]', "STRIPE_API_KEY");
    await page.fill('[data-testid="env-val-0"]', "sk_live_999");

    // Como o nome contém API_KEY, o campo deve ficar mascarado (type="password")
    expect(await page.getAttribute('[data-testid="env-val-0"]', "type")).toBe("password");

    await page.click('[data-testid="env-save"]');
    await page.waitForSelector('[data-testid="env-status"]');

    const globalVars = (await api("GET", "/v1/environments/global")) as EnvVarEntry[];
    expect(globalVars).toEqual([{ key: "STRIPE_API_KEY", value: "sk_live_999", secret: true }]);

    // Muda para o escopo do espaço EnvUI e importa via Colar .env
    await page.selectOption('[data-testid="env-scope"]', wsId);
    await page.click('[data-testid="env-paste-toggle"]');
    await page.fill('[data-testid="env-paste-input"]', "PORT_APP=3000\nDB_TOKEN=tok_abc");
    await page.click('[data-testid="env-paste-apply"]');
    await page.click('[data-testid="env-save"]');
    await page.waitForSelector('[data-testid="env-status"]');

    const wsVars = (await api("GET", `/v1/workspaces/${wsId}/env`)) as EnvVarEntry[];
    expect(wsVars).toEqual([
      { key: "PORT_APP", value: "3000" },
      { key: "DB_TOKEN", value: "tok_abc", secret: true },
    ]);
  });
});
