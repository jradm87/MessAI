import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// #61 Atualizações (modo dev: honesto sobre não suportar; toggle persiste) · #63 Sobre (versão/build, relatório de problema
// com seções opcionais e sem segredos, atalho para Código aberto).
const ROOT = join(import.meta.dirname, "../..");
const PORT = 47977;
let dataDir: string; let runtime: ChildProcess; let app: ElectronApplication; let page: Page; let token: string;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "mess-about-"));
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

const openTab = async (id: string) => {
  if (!(await page.locator('[data-testid="prefs"]').count())) { await page.click('[data-testid="settings"]'); await page.waitForSelector('[data-testid="prefs"]'); }
  await page.click(`[data-testid="prefs-tab-${id}"]`);
  await page.waitForSelector(`[data-testid="prefs-pane-${id}"]`);
};

describe("Atualizações (#61) e Sobre (#63)", () => {
  it("Atualizações em modo dev: diz que só existe empacotado, Verificar fica desabilitado, toggle automático persiste e chega ao main", async () => {
    await openTab("updates");
    await page.waitForSelector('[data-testid="upd-status"]:has-text("só existe no app empacotado")');
    expect(await page.locator('[data-testid="upd-check"]').isDisabled()).toBe(true);
    const st = (await page.evaluate(() => window.messai.updateState!())) as { supported: boolean; status: string; current: string };
    expect(st).toMatchObject({ supported: false, status: "unsupported" }); expect(st.current).toMatch(/^\d+\.\d+\.\d+/);
    await page.click('[data-testid="upd-auto"]');
    await page.waitForSelector('[data-testid="upd-auto"][aria-checked="false"]');
    expect(JSON.parse(await page.evaluate(() => localStorage.getItem("mess.prefs") ?? "{}") as string)).toMatchObject({ updateAuto: false });
    await page.click('[data-testid="upd-auto"]');
    await page.waitForSelector('[data-testid="upd-auto"][aria-checked="true"]');
  }, 20_000);

  it("Sobre: versão/build do app e do runtime; relatório com seções escolhidas, sem token; botão de agradecimentos vai para Código aberto", async () => {
    await openTab("about");
    await page.waitForSelector('[data-testid="about-version"]:has-text("runtime build")', { timeout: 10_000 }); // health do runtime chega assíncrono
    const v = await page.locator('[data-testid="about-version"]').textContent();
    expect(v).toMatch(/versão \d+\.\d+\.\d+ · build \d+ · runtime build \d+/);
    await page.fill('[data-testid="about-desc"]', "o canvas travou");
    await page.click('[data-testid="about-opt-log"]'); // liga o log
    await page.click('[data-testid="about-generate"]');
    await page.waitForSelector('[data-testid="about-report"]');
    const r = (await page.locator('[data-testid="about-report"]').textContent()) ?? "";
    expect(r).toContain("# MessAI — relatório de problema");
    expect(r).toContain("o canvas travou");
    expect(r).toContain("## Versões"); expect(r).toContain("## Runtime"); expect(r).toContain("## Provedores"); expect(r).toContain("## Tamanho do workspace"); expect(r).toContain("## runtime.log");
    expect(r).toContain("- claude:");
    expect(r).not.toContain(token); // o token do runtime jamais entra
    await page.click('[data-testid="about-ack"]');
    await page.waitForSelector('[data-testid="prefs-pane-opensource"]');
    await page.keyboard.press("Escape");
  }, 30_000);

  it("Código aberto (#60): licença Apache-2.0, lista gerada de terceiros com busca e contagem por licença, componentes de sistema", async () => {
    await openTab("opensource");
    await page.waitForSelector('[data-testid="os-table"] [data-testid="os-row"]');
    expect(await page.locator('[data-testid="prefs-pane-opensource"]').textContent()).toContain("Apache-2.0");
    const total = await page.locator('[data-testid="os-row"]').count();
    expect(total).toBeGreaterThan(100);
    expect(await page.locator('[data-testid="os-counts"]').textContent()).toMatch(/MIT: \d+/);
    await page.fill('[data-testid="os-search"]', "@xyflow/react"); // casa o pacote e quem depende dele (via)
    await page.waitForFunction((t) => { const n = document.querySelectorAll('[data-testid="os-row"]').length; return n > 0 && n < t; }, total);
    const names = await page.locator('[data-testid="os-row"] b').allTextContents();
    expect(names).toContain("@xyflow/react");
    expect(await page.locator('[data-testid="os-row"]', { hasText: "@xyflow/react" }).first().textContent()).toContain("MIT");
    expect(await page.locator('[data-testid="os-system"]').count()).toBeGreaterThanOrEqual(4);
    await page.keyboard.press("Escape");
  }, 20_000);
});
