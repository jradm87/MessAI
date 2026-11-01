import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// #62 — Preferências → Dados com Electron real: local/uso, criar backup aparece na lista, restaurar (confirmação literal)
// derruba o runtime, o app sobe outro e recarrega com o estado do backup; reset com confirmação literal.
const ROOT = join(import.meta.dirname, "../..");
const PORT = 47985;
let dataDir: string; let runtime: ChildProcess; let app: ElectronApplication; let page: Page; let token: string;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const api = async (method: string, path: string, body?: unknown) => (await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : null })).json();

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "mess-dprefs-"));
  runtime = spawn("node", [join(ROOT, "apps/runtime/dist/index.js")], { env: { ...process.env, MESS_DATA_DIR: dataDir, MESS_PORT: String(PORT), SHELL: "/bin/sh" }, stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { await sleep(250); try { token = readFileSync(join(dataDir, "runtime.token"), "utf8").trim(); up = (await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: { authorization: `Bearer ${token}` } })).ok; } catch { /* subindo */ } }
  if (!up) throw new Error(`runtime de teste não subiu na porta ${PORT}`);
  app = await electron.launch({ args: ["."], cwd: join(ROOT, "apps/desktop"), env: { ...process.env, MESS_DATA_DIR: dataDir, MESS_PORT: String(PORT) } });
  page = await app.firstWindow();
  await page.waitForSelector(".side h1");
}, 60_000);

afterAll(async () => {
  // o app pode ter subido um runtime próprio depois do restore: derruba pelo endpoint (mata agentes) e depois o nosso
  try { await fetch(`http://127.0.0.1:${PORT}/v1/shutdown`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ killAgents: true }) }); } catch { /* */ }
  await app?.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
  await app?.close().catch(() => {});
  try { runtime?.kill(); } catch { /* */ }
  for (let i = 0; i < 15 && runtime && runtime.exitCode === null; i++) await sleep(100);
  if (runtime && runtime.exitCode === null) { try { runtime.kill("SIGKILL"); } catch { /* */ } }
  await sleep(500);
  rmSync(dataDir, { recursive: true, force: true });
}, 40_000);

const openData = async () => {
  if (!(await page.locator('[data-testid="prefs"]').count())) { await page.click('[data-testid="settings"]'); await page.waitForSelector('[data-testid="prefs"]'); }
  await page.click('[data-testid="prefs-tab-data"]');
  await page.waitForSelector('[data-testid="data-dir"]');
};

describe("Dados (#62)", () => {
  it("mostra local (env) e uso; Criar backup lista o backup com contagens; Mudar… bloqueado por vir da env", async () => {
    await api("POST", "/v1/workspaces", { name: "Antes", cwd: dataDir });
    await page.waitForSelector(".side li.ws:has-text('Antes')");
    await openData();
    expect(await page.locator('[data-testid="data-dir"]').textContent()).toBe(dataDir);
    await page.waitForSelector('[data-testid="data-usage"]:has-text("no total")');
    expect(await page.locator('[data-testid="data-move"]').isDisabled()).toBe(true);
    await page.click('[data-testid="backup-create"]');
    await page.waitForSelector('[data-testid="backup-row"]');
    expect(await page.locator('[data-testid="backup-row"]').count()).toBe(1);
    expect(await page.locator('[data-testid="backup-row"] small').textContent()).toMatch(/\d+ espaço\(s\), \d+ nó\(s\)/);
    const d = (await api("GET", "/v1/data")) as { backups: { name: string }[] };
    expect(d.backups).toHaveLength(1);
  }, 30_000);

  it("restaurar: exige digitar RESTAURAR; o runtime sai, o app sobe outro e recarrega com o estado do backup", async () => {
    await api("POST", "/v1/workspaces", { name: "Depois", cwd: dataDir });
    await page.waitForSelector(".side li.ws:has-text('Depois')");
    await openData();
    const name = ((await api("GET", "/v1/data")) as { backups: { name: string }[] }).backups[0]!.name;
    await page.click(`[data-testid="backup-restore-${name}"]`);
    await page.waitForSelector('[data-testid="restore-confirm"]');
    expect(await page.locator('[data-testid="restore-go"]').isDisabled()).toBe(true);
    await page.fill('[data-testid="restore-typed"]', "restaurar");
    expect(await page.locator('[data-testid="restore-go"]').isDisabled()).toBe(true); // literal exato
    await page.fill('[data-testid="restore-typed"]', "RESTAURAR");
    await page.click('[data-testid="restore-go"]');
    // a janela recarrega depois que o app sobe o runtime de novo: "Depois" (criado após o backup) some
    await page.waitForSelector(".side li.ws:has-text('Depois')", { state: "detached", timeout: 50_000 });
    await page.waitForSelector(".side li.ws:has-text('Antes')", { timeout: 20_000 });
    expect(await page.locator('[data-testid="data-busy"]').count()).toBe(0);
    const ws = (await api("GET", "/v1/workspaces")) as { name: string }[];
    expect(ws.map((w) => w.name)).toContain("Antes"); expect(ws.map((w) => w.name)).not.toContain("Depois");
  }, 60_000);

  it("reset: botão só libera com APAGAR; após confirmar, volta só com o espaço padrão", async () => {
    await openData();
    expect(await page.locator('[data-testid="reset-go"]').isDisabled()).toBe(true);
    await page.fill('[data-testid="reset-typed"]', "APAGAR");
    expect(await page.locator('[data-testid="reset-go"]').isDisabled()).toBe(false);
    page.once("dialog", (d) => void d.accept());
    await page.click('[data-testid="reset-go"]');
    await page.waitForSelector(".side li.ws:has-text('Antes')", { state: "detached", timeout: 50_000 });
    await page.waitForSelector(".side h1", { timeout: 20_000 });
    for (let i = 0; i < 40; i++) { try { const ws = (await api("GET", "/v1/workspaces")) as { name: string }[]; if (ws.length === 1 && !ws.some((w) => w.name === "Antes")) break; } catch { /* runtime subindo */ } await sleep(300); }
    const ws = (await api("GET", "/v1/workspaces")) as { name: string }[];
    expect(ws.some((w) => w.name === "Antes")).toBe(false); expect(ws).toHaveLength(1);
  }, 60_000);
});
