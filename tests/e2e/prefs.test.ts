import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// #64 — janela de Preferências: engrenagem abre, abas (a última fica lembrada), Esc/Ctrl+, fecham/alternam,
// seletor de tema na aba Geral aplica `data-theme` e sincroniza com o botão da barra inferior (#54).
// #55 — Geral: cursor (data-cursor), evitar suspensão (inibidor real no processo principal), restaurar sessões
// (config do runtime), fechar para a bandeja (esconde em vez de fechar) e sair sem confirmação.
const ROOT = join(import.meta.dirname, "../..");
const PORT = 47959;
let dataDir: string; let runtime: ChildProcess; let app: ElectronApplication; let page: Page; let token: string;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const api = async (path: string) => (await fetch(`http://127.0.0.1:${PORT}${path}`, { headers: { authorization: `Bearer ${token}` } })).json();
const mainState = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => ({ url: w.webContents.getURL(), visible: w.isVisible(), destroyed: w.isDestroyed() })));

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
    // o botão da barra inferior também alimenta o seletor (mesma preferência) — com o modal aberto a barra fica coberta, então fecha antes
    await page.keyboard.press("Control+,");
    await page.waitForSelector('[data-testid="prefs"]', { state: "detached" });
    await page.click('[data-testid="theme-toggle"]'); // Escuro → Sistema
    await page.waitForFunction(() => localStorage.getItem("mess.theme") === "system");
    await page.keyboard.press("Control+,");
    await page.waitForSelector('[data-testid="theme-system"][aria-checked="true"]');
    await page.keyboard.press("Control+,");
    await page.waitForSelector('[data-testid="prefs"]', { state: "detached" });
  }, 20_000);
});

describe("Preferências → Geral (#55)", () => {
  it("cursor web/nativo aplica data-cursor; Evitar suspensão liga/desliga o inibidor real; Restaurar sessões grava no runtime", async () => {
    await page.click('[data-testid="settings"]');
    await page.waitForSelector('[data-testid="prefs-pane-general"]');
    expect(await page.evaluate(() => document.documentElement.getAttribute("data-cursor"))).toBe("web");
    await page.click('[data-testid="pref-cursor"]');
    await page.waitForFunction(() => document.documentElement.getAttribute("data-cursor") === "native");
    await page.click('[data-testid="pref-cursor"]');
    await page.waitForFunction(() => document.documentElement.getAttribute("data-cursor") === "web");
    // energia: Sempre → inibidor ativo no processo principal; Nunca → inativo
    await page.click('[data-testid="power-always"]');
    await page.waitForFunction(async () => (await window.messai.uiPrefsState!()).powerBlocking === true, undefined, { timeout: 5000 });
    await page.waitForSelector('[data-testid="power-status"]:has-text("ativo agora")');
    await page.click('[data-testid="power-never"]');
    await page.waitForFunction(async () => (await window.messai.uiPrefsState!()).powerBlocking === false, undefined, { timeout: 5000 });
    // restaurar sessões: config do runtime
    await page.waitForSelector('[data-testid="pref-restore"][aria-checked="true"]');
    await page.click('[data-testid="pref-restore"]');
    await page.waitForSelector('[data-testid="pref-restore"][aria-checked="false"]');
    for (let i = 0; i < 20 && ((await api("/v1/settings")) as { restoreSessions: boolean }).restoreSessions; i++) await sleep(150);
    expect(((await api("/v1/settings")) as { restoreSessions: boolean }).restoreSessions).toBe(false);
    await page.click('[data-testid="pref-restore"]');
    for (let i = 0; i < 20 && !((await api("/v1/settings")) as { restoreSessions: boolean }).restoreSessions; i++) await sleep(150);
    expect(((await api("/v1/settings")) as { restoreSessions: boolean }).restoreSessions).toBe(true);
    const prefs = JSON.parse(await page.evaluate(() => localStorage.getItem("mess.prefs") ?? "{}") as string) as Record<string, unknown>;
    expect(prefs).toMatchObject({ webCursor: true, powerMode: "never" });
  }, 30_000);

  it("Fechar para a bandeja: fechar a janela só a esconde; depois, sem confirmação ao sair, fechar encerra de verdade", async () => {
    await page.click('[data-testid="pref-tray"]');
    await page.waitForFunction(async () => (await window.messai.uiPrefsState!()).closeToTray === true, undefined, { timeout: 5000 });
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().endsWith("#hud"))!.close(); });
    await sleep(600);
    let st = await mainState();
    expect(st.length, "janela deveria continuar existindo (escondida)").toBe(1);
    expect(st[0]!.visible).toBe(false);
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]!.show(); });
    await sleep(300);
    st = await mainState(); expect(st[0]!.visible).toBe(true);
    // desliga bandeja e confirmação → fechar encerra sem tela de encerramento (runtime fica)
    await page.click('[data-testid="pref-tray"]');
    await page.click('[data-testid="pref-confirm-exit"]');
    await page.waitForFunction(async () => { const s = await window.messai.uiPrefsState!(); return s.closeToTray === false && s.confirmExit === false; }, undefined, { timeout: 5000 });
    const exited = new Promise<void>((r) => { app.process().once("exit", () => r()); });
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]!.close(); });
    await Promise.race([exited, sleep(8000).then(() => { throw new Error("app não encerrou ao fechar sem confirmação"); })]);
    expect((await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: { authorization: `Bearer ${token}` } })).ok).toBe(true); // runtime continua
  }, 30_000);
});
