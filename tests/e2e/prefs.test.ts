import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// #64 — janela de Preferências: engrenagem abre, abas (a última fica lembrada), Esc/Ctrl+, fecham/alternam,
// seletor de tema na aba Geral aplica `data-theme` e sincroniza com o botão da barra inferior (#54).
const ROOT = join(import.meta.dirname, "../..");
const PORT = 47959;
let dataDir: string; let runtime: ChildProcess; let app: ElectronApplication; let page: Page; let token: string;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "mess-prefs-"));
  runtime = spawn("node", [join(ROOT, "apps/runtime/dist/index.js")], { env: { ...process.env, MESS_DATA_DIR: dataDir, MESS_PORT: String(PORT), SHELL: "/bin/sh" }, stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { await sleep(250); try { token = readFileSync(join(dataDir, "runtime.token"), "utf8").trim(); up = (await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: { authorization: `Bearer ${token}` } })).ok; } catch { /* subindo */ } }
  if (!up) throw new Error(`runtime de teste não subiu na porta ${PORT}`);
  app = await electron.launch({ args: ["."], cwd: join(ROOT, "apps/desktop"), env: { ...process.env, MESS_DATA_DIR: dataDir, MESS_PORT: String(PORT) } });
  page = await app.firstWindow();
  await page.waitForSelector(".side h1");
}, 60_000);

afterAll(async () => {
  await app?.evaluate(({ app: a }) => a.exit(0)).catch(() => {}); // a janela principal intercepta o fechar (tela de encerramento)
  await app?.close().catch(() => {});
  try { runtime?.kill(); } catch { /* */ }
  for (let i = 0; i < 15 && runtime && runtime.exitCode === null; i++) await sleep(100);
  if (runtime && runtime.exitCode === null) { try { runtime.kill("SIGKILL"); } catch { /* */ } }
  rmSync(dataDir, { recursive: true, force: true });
}, 30_000);

describe("Preferências (#64)", () => {
  it("engrenagem abre na aba Geral; trocar de aba é lembrado ao fechar (Esc) e reabrir", async () => {
    await page.click('[data-testid="settings"]');
    await page.waitForSelector('[data-testid="prefs"]');
    await page.waitForSelector('[data-testid="prefs-pane-general"]');
    expect(await page.locator('[data-testid="prefs-tab-general"]').getAttribute("aria-selected")).toBe("true");
    await page.click('[data-testid="prefs-tab-data"]');
    await page.waitForSelector('[data-testid="prefs-pane-data"] [data-testid="prefs-soon"]'); // aba ainda não construída diz isso, não finge
    await page.keyboard.press("Escape");
    await page.waitForSelector('[data-testid="prefs"]', { state: "detached" });
    expect(JSON.parse(await page.evaluate(() => localStorage.getItem("mess.prefs") ?? "{}") as string)).toMatchObject({ prefsTab: "data" });
    await page.click('[data-testid="settings"]');
    await page.waitForSelector('[data-testid="prefs-pane-data"]');
    await page.click('[data-testid="prefs-close"]');
    await page.waitForSelector('[data-testid="prefs"]', { state: "detached" });
  }, 20_000);

  it("Ctrl+, alterna a janela; seletor de tema aplica data-theme e o botão da barra inferior acompanha", async () => {
    await page.mouse.click(700, 60); // tira o foco de inputs
    await page.keyboard.press("Control+,");
    await page.waitForSelector('[data-testid="prefs"]');
    await page.click('[data-testid="prefs-tab-general"]');
    await page.waitForSelector('[data-testid="theme-picker"]');
    await page.click('[data-testid="theme-light"]');
    await page.waitForFunction(() => document.documentElement.getAttribute("data-theme") === "light");
    expect(await page.locator('[data-testid="theme-light"]').getAttribute("aria-checked")).toBe("true");
    expect(await page.evaluate(() => localStorage.getItem("mess.theme"))).toBe("light");
    expect(await page.getAttribute('[data-testid="theme-toggle"]', "title")).toContain("Claro");
    await page.click('[data-testid="theme-dark"]');
    await page.waitForFunction(() => document.documentElement.getAttribute("data-theme") === "dark");
    // o botão da barra inferior também alimenta o seletor (mesma preferência)
    await page.click('[data-testid="theme-toggle"]'); // Escuro → Sistema
    await page.waitForFunction(() => document.querySelector('[data-testid="theme-system"]')?.getAttribute("aria-checked") === "true");
    await page.keyboard.press("Control+,");
    await page.waitForSelector('[data-testid="prefs"]', { state: "detached" });
  }, 20_000);
});
