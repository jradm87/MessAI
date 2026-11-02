import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// #70 Bandas e #29 Maestro com Electron real: criar banda pela paleta, escolher membros, perguntar em lote, ver os selos; ligar o Modo Maestro no nó.
const ROOT = join(import.meta.dirname, "../..");
const PORT = 48012;
let dataDir: string; let runtime: ChildProcess; let app: ElectronApplication; let page: Page; let token: string; let WS: string;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const api = async (method: string, path: string, body?: unknown) => { const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : null }); return r.status === 204 ? null : r.json(); };
type Snap = { workspace: { revision: number }; nodes: { nodeId: string; title: string; maestro?: boolean }[]; bands?: { name: string; nodeIds: string[] }[] };
const snap = async () => (await api("GET", `/v1/workspaces/${WS}`)) as Snap;
const openBands = async () => { await page.mouse.click(700, 60); await page.keyboard.press("Control+k"); await page.fill('[data-testid="palette-input"]', "bandas"); await page.waitForSelector('[data-testid="palette-item-action"]:has-text("Bandas")'); await page.keyboard.press("Enter"); await page.waitForSelector('[data-testid="bands-dialog"]'); };

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "mess-bd-"));
  runtime = spawn("node", [join(ROOT, "apps/runtime/dist/index.js")], { env: { ...process.env, MESS_DATA_DIR: dataDir, MESS_PORT: String(PORT), SHELL: "/bin/sh" }, stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { await sleep(250); try { token = readFileSync(join(dataDir, "runtime.token"), "utf8").trim(); up = (await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: { authorization: `Bearer ${token}` } })).ok; } catch { /* subindo */ } }
  if (!up) throw new Error(`runtime de teste não subiu na porta ${PORT}`);
  WS = ((await api("POST", "/v1/workspaces", { name: "Banda", cwd: dataDir })) as { workspaceId: string }).workspaceId;
  for (const [i, title] of ["Alfa", "Beta"].entries()) await api("POST", `/v1/workspaces/${WS}/nodes`, { expectedRevision: (await snap()).workspace.revision, kind: "terminal", title, command: "cat", geometry: { x: i * 420, y: 0, w: 380, h: 240 } });
  app = await electron.launch({ args: ["."], cwd: join(ROOT, "apps/desktop"), env: { ...process.env, MESS_DATA_DIR: dataDir, MESS_PORT: String(PORT) } });
  page = await app.firstWindow();
  await page.waitForSelector(".side li.ws:has-text('Banda')"); await page.click(".side li.ws:has-text('Banda')");
  await page.waitForSelector('.react-flow__node:has-text("Beta")', { state: "attached" });
}, 60_000);
afterAll(async () => {
  await app?.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
  await app?.close().catch(() => {});
  try { runtime?.kill(); } catch { /* */ }
  for (let i = 0; i < 15 && runtime && runtime.exitCode === null; i++) await sleep(100);
  if (runtime && runtime.exitCode === null) { try { runtime.kill("SIGKILL"); } catch { /* */ } }
  rmSync(dataDir, { recursive: true, force: true });
});

describe("Bandas (#70) e Maestro (#29)", () => {
  it("cria a banda, escolhe os membros, pergunta em lote e mostra os selos nos nós", async () => {
    await openBands();
    await page.fill('[data-testid="band-name"]', "Dupla");
    await page.click('[data-testid="band-create"]');
    await page.waitForSelector('[data-testid="band-card"]:has-text("Dupla")');
    await page.click('.band-chip:has-text("Alfa")'); await page.click('.band-chip:has-text("Beta")');
    await page.waitForFunction(() => document.querySelectorAll(".band-chip.on").length === 2);
    await sleep(700); // cat precisa estar de pé para receber
    await page.fill('[data-testid="band-text"]', "ola-banda");
    await page.click('[data-testid="band-ask"]');
    await page.waitForSelector('[data-testid="band-results"]', { timeout: 20_000 });
    const out = await page.locator('[data-testid="band-results"]').innerText();
    expect(out).toContain("Alfa"); expect(out).toContain("Beta"); expect(out).toContain("ola-banda");
    await page.keyboard.press("Escape");
    await page.waitForSelector('[data-testid="bands-dialog"]', { state: "detached" });
    // selos nos dois terminais
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="band-pill"]').length === 2);
    expect(await page.locator('.react-flow__node.selectable, .react-flow__node').filter({ has: page.locator('[data-testid="band-pill"]') }).count()).toBe(2);
    expect((await snap()).bands?.[0]?.nodeIds).toHaveLength(2);
  });
  it("transmitir não espera resposta", async () => {
    await openBands();
    await page.fill('[data-testid="band-text"]', "aviso-geral");
    await page.click('[data-testid="band-say"]');
    await page.waitForSelector('[data-testid="band-results"]');
    expect(await page.locator('[data-testid="band-results"]').innerText()).toContain("transmitido");
    await page.keyboard.press("Escape");
  });
  it("Modo Maestro: o botão do nó liga o condutor (selo + persistido)", async () => {
    const node = page.locator('.react-flow__node:has-text("Alfa")').first();
    await node.locator('[data-testid="maestro-toggle"]').click();
    await page.waitForSelector('[data-testid="maestro-pill"]');
    expect((await snap()).nodes.find((n) => n.title === "Alfa")?.maestro).toBe(true);
    await node.locator('[data-testid="maestro-toggle"]').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="maestro-pill"]').length === 0);
    expect((await snap()).nodes.find((n) => n.title === "Alfa")?.maestro).toBeFalsy();
  });
});
