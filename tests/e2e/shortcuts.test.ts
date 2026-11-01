import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// #58 — Atalhos editáveis com Electron real: remapear por captura vale no app (o antigo deixa de valer), limpar desliga,
// conflito é mostrado, restaurar volta ao padrão, tooltip acompanha, persiste em mess.prefs.keymap.
const ROOT = join(import.meta.dirname, "../..");
const PORT = 47975;
let dataDir: string; let runtime: ChildProcess; let app: ElectronApplication; let page: Page; let token: string;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "mess-keys-"));
  runtime = spawn("node", [join(ROOT, "apps/runtime/dist/index.js")], { env: { ...process.env, MESS_DATA_DIR: dataDir, MESS_PORT: String(PORT), SHELL: "/bin/sh" }, stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { await sleep(250); try { token = readFileSync(join(dataDir, "runtime.token"), "utf8").trim(); up = (await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: { authorization: `Bearer ${token}` } })).ok; } catch { /* subindo */ } }
  if (!up) throw new Error(`runtime de teste não subiu na porta ${PORT}`);
  app = await electron.launch({ args: ["."], cwd: join(ROOT, "apps/desktop"), env: { ...process.env, MESS_DATA_DIR: dataDir, MESS_PORT: String(PORT) } });
  page = await app.firstWindow();
  await page.waitForSelector(".side h1");
}, 60_000);

afterAll(async () => {
  await app?.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
  await app?.close().catch(() => {});
  try { runtime?.kill(); } catch { /* */ }
  for (let i = 0; i < 15 && runtime && runtime.exitCode === null; i++) await sleep(100);
  if (runtime && runtime.exitCode === null) { try { runtime.kill("SIGKILL"); } catch { /* */ } }
  rmSync(dataDir, { recursive: true, force: true });
}, 30_000);

const minimapOn = () => page.locator(".react-flow__minimap").count().then((n) => n > 0);
const openShortcuts = async () => {
  if (!(await page.locator('[data-testid="prefs"]').count())) { await page.click('[data-testid="settings"]'); await page.waitForSelector('[data-testid="prefs"]'); }
  await page.click('[data-testid="prefs-tab-shortcuts"]');
  await page.waitForSelector('[data-testid="ks-minimap.toggle"]');
};
const closePrefs = async () => { await page.keyboard.press("Escape"); await page.waitForSelector('[data-testid="prefs"]', { state: "detached" }); await page.mouse.click(700, 60); };

describe("Atalhos (#58)", () => {
  it("padrão Ctrl+Shift+M alterna o minimapa; remapear por captura para Ctrl+Shift+Y passa a valer e o antigo não", async () => {
    await page.mouse.click(700, 60);
    const before = await minimapOn();
    await page.keyboard.press("Control+Shift+M"); await sleep(200);
    expect(await minimapOn()).toBe(!before);
    await page.keyboard.press("Control+Shift+M"); await sleep(200);
    expect(await minimapOn()).toBe(before);
    await openShortcuts();
    await page.fill('[data-testid="ks-search"]', "minimapa");
    expect(await page.locator('[data-testid="ks-combo-minimap.toggle"]').textContent()).toBe("Ctrl+Shift+M");
    await page.click('[data-testid="ks-combo-minimap.toggle"]');
    await page.waitForSelector('[data-testid="ks-combo-minimap.toggle"]:has-text("pressione")');
    await page.keyboard.press("Control+Shift+Y");
    await page.waitForSelector('[data-testid="ks-combo-minimap.toggle"]:has-text("Ctrl+Shift+Y")');
    expect(JSON.parse(JSON.parse(await page.evaluate(() => localStorage.getItem("mess.prefs") ?? "{}") as string).keymap as string)).toEqual({ "minimap.toggle": { key: "y", ctrl: true, shift: true, alt: false } });
    await closePrefs();
    await page.keyboard.press("Control+Shift+M"); await sleep(200);
    expect(await minimapOn()).toBe(before); // antigo não vale mais
    await page.keyboard.press("Control+Shift+Y"); await sleep(200);
    expect(await minimapOn()).toBe(!before); // novo vale
    await page.keyboard.press("Control+Shift+Y"); await sleep(200);
    expect(await page.getAttribute('[data-testid="hud-toggle"] ~ .bb-circle', "title")).toContain("Ctrl+Shift+Y"); // tooltip do botão do minimapa acompanha
  }, 30_000);

  it("limpar desliga o atalho; conflito aparece quando duas ações dividem a combinação; restaurar padrões volta tudo", async () => {
    await openShortcuts();
    await page.fill('[data-testid="ks-search"]', "");
    await page.click('[data-testid="ks-clear-minimap.toggle"]');
    await page.waitForSelector('[data-testid="ks-combo-minimap.toggle"]:has-text("sem atalho")');
    await closePrefs();
    const before = await minimapOn();
    await page.keyboard.press("Control+Shift+Y"); await page.keyboard.press("Control+Shift+M"); await sleep(200);
    expect(await minimapOn()).toBe(before); // nada alterna
    // conflito: nova nota → Ctrl+T (igual a novo terminal)
    await openShortcuts();
    await page.click('[data-testid="ks-combo-note.new"]');
    await page.keyboard.press("Control+T");
    await page.waitForSelector('[data-testid="ks-note.new"].conf');
    await page.waitForSelector('[data-testid="ks-terminal.new"].conf small:has-text("Nova nota")');
    // restaurar padrões
    page.once("dialog", (d) => void d.accept());
    await page.click('[data-testid="ks-reset-all"]');
    await page.waitForSelector('[data-testid="ks-combo-minimap.toggle"]:has-text("Ctrl+Shift+M")');
    expect(await page.locator('[data-testid="ks-note.new"].conf').count()).toBe(0);
    expect(JSON.parse(await page.evaluate(() => localStorage.getItem("mess.prefs") ?? "{}") as string).keymap ?? "").toBe("");
    await closePrefs();
  }, 30_000);
});
