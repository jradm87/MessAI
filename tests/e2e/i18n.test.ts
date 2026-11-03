import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Workspace } from "@messai/contracts";

// #51 — Internacionalização (múltiplos idiomas) em Preferências → Geral → Sistema → Idioma.
const ROOT = join(import.meta.dirname, "../..");
const PORT = 48036;
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
  dataDir = mkdtempSync(join(tmpdir(), "mess-e2e-i18n-"));
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

  await api("POST", "/v1/workspaces", { name: "LangSpace", cwd: wsDir }) as Workspace;

  app = await electron.launch({
    args: ["."],
    cwd: join(ROOT, "apps/desktop"),
    env: { ...process.env, MESS_DATA_DIR: dataDir, MESS_PORT: String(PORT) },
  });
  page = await app.firstWindow();
  await page.waitForSelector(".side li.ws:has-text('LangSpace')");
}, 45_000);

afterAll(async () => {
  await app?.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
  await app?.close().catch(() => {});
  try { runtime?.kill(); } catch { /* */ }
  for (let i = 0; i < 15 && runtime && runtime.exitCode === null; i++) await sleep(100);
  if (runtime && runtime.exitCode === null) { try { runtime.kill("SIGKILL"); } catch { /* */ } }
  rmSync(dataDir, { recursive: true, force: true });
});

describe("E2E #51 — Internacionalização (pt-BR / en-US)", () => {
  it("troca o idioma em Preferências → Geral → Idioma para English (US) e atualiza a interface", async () => {
    expect(await page.textContent('[data-testid="add"]')).toBe("+ Adicionar");

    await page.click('[data-testid="settings"]');
    await page.waitForSelector('[data-testid="pref-language"]');
    expect(await page.textContent('[data-testid="prefs-heading"]')).toBe("Preferências");

    await page.selectOption('[data-testid="pref-language"]', "en-US");
    expect(await page.textContent('[data-testid="prefs-heading"]')).toBe("Preferences");
    expect(await page.evaluate(() => document.documentElement.lang)).toBe("en-US");

    await page.click('[data-testid="prefs-close"]');
    expect(await page.textContent('[data-testid="add"]')).toBe("+ Add");

    // Volta para pt-BR
    await page.click('[data-testid="settings"]');
    await page.selectOption('[data-testid="pref-language"]', "pt-BR");
    expect(await page.textContent('[data-testid="prefs-heading"]')).toBe("Preferências");
  }, 30_000);
});
