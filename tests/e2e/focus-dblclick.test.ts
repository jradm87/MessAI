import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Duplo clique na barra de um item enquadra e centraliza o item na tela; no título continua renomeando.
const ROOT = join(import.meta.dirname, "../..");
const PORT = 47993;
let dataDir: string; let runtime: ChildProcess; let app: ElectronApplication; let page: Page; let token: string; let ws: string;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const api = async (method: string, path: string, body?: unknown) => (await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : null })).json();
const zoom = async () => page.evaluate(() => { const m = /scale\(([\d.]+)\)/.exec((document.querySelector(".react-flow__viewport") as HTMLElement).style.transform); return m ? Number(m[1]) : NaN; });
/** Distância (px) entre o centro do nó e o centro do canvas. */
const offCenter = async (sel: string) => {
  const pane = (await page.locator("main.canvas .react-flow").boundingBox())!;
  const n = (await page.locator(sel).boundingBox())!;
  return Math.hypot(n.x + n.width / 2 - (pane.x + pane.width / 2), n.y + n.height / 2 - (pane.y + pane.height / 2));
};

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "mess-focus-"));
  runtime = spawn("node", [join(ROOT, "apps/runtime/dist/index.js")], { env: { ...process.env, MESS_DATA_DIR: dataDir, MESS_PORT: String(PORT), SHELL: "/bin/sh" }, stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { await sleep(250); try { token = readFileSync(join(dataDir, "runtime.token"), "utf8").trim(); up = (await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: { authorization: `Bearer ${token}` } })).ok; } catch { /* subindo */ } }
  if (!up) throw new Error(`runtime de teste não subiu na porta ${PORT}`);
  app = await electron.launch({ args: ["."], cwd: join(ROOT, "apps/desktop"), env: { ...process.env, MESS_DATA_DIR: dataDir, MESS_PORT: String(PORT) } });
  page = await app.firstWindow();
  await page.waitForSelector(".side h1");
  ws = ((await api("POST", "/v1/workspaces", { name: "Foco", cwd: dataDir })) as { workspaceId: string }).workspaceId;
  await page.waitForSelector(".side li.ws:has-text('Foco')");
  await page.click(".side li.ws:has-text('Foco')");
  await page.waitForSelector(".side li.ws.on:has-text('Foco')");
}, 60_000);

afterAll(async () => {
  await app?.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
  await app?.close().catch(() => {});
  try { runtime?.kill(); } catch { /* */ }
  for (let i = 0; i < 15 && runtime && runtime.exitCode === null; i++) await sleep(100);
  if (runtime && runtime.exitCode === null) { try { runtime.kill("SIGKILL"); } catch { /* */ } }
  rmSync(dataDir, { recursive: true, force: true });
}, 30_000);

describe("Duplo clique na barra centraliza o item", () => {
  it("enquadra a nota longe da vista; no título abre a renomeação", async () => {
    await page.click("main.canvas .react-flow__pane", { position: { x: 30, y: 500 } });
    await page.keyboard.press("Control+Shift+D"); // nova nota
    await page.waitForSelector(".node.note");
    // afasta a vista: zoom pequeno e nota fora do centro
    await page.evaluate(() => { (document.querySelector("main.canvas .react-flow__pane") as HTMLElement).focus(); });
    await page.locator("main.canvas .react-flow__pane").hover({ position: { x: 40, y: 40 } });
    await page.keyboard.down("Alt"); for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 400); await page.keyboard.up("Alt");
    await sleep(400);
    const z0 = await zoom(); const d0 = await offCenter(".node.note");

    // área livre da barra: o espaçador entre o título e os botões
    const sp = (await page.locator(".node.note .bar .sp").boundingBox())!;
    const px = sp.x + sp.width / 2; const py = sp.y + sp.height / 2;
    await page.mouse.dblclick(px, py);
    await sleep(500);
    const z1 = await zoom(); const d1 = await offCenter(".node.note");
    expect(z1).toBeGreaterThan(z0);
    expect(d1).toBeLessThan(Math.max(20, d0 / 4));
    expect(await page.locator(".node.note .title-edit").count()).toBe(0);

    await page.dblclick(".node.note .bar .title");
    await page.waitForSelector(".node.note .title-edit");
    await page.keyboard.press("Escape");
  }, 30_000);

  it("minimapa: clique no item enquadra; clique no vazio centraliza sem mudar o zoom", async () => {
    const pane = page.locator("main.canvas .react-flow__pane");
    await pane.hover({ position: { x: 40, y: 40 } });
    await page.keyboard.down("Alt"); for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 400); await page.keyboard.up("Alt");
    await sleep(400);
    const z0 = await zoom(); const d0 = await offCenter(".node.note");
    await page.click(".react-flow__minimap-node");
    await sleep(500);
    expect(await zoom()).toBeGreaterThan(z0);
    expect(await offCenter(".node.note")).toBeLessThan(Math.max(20, d0 / 4));

    const tr = async () => page.evaluate(() => (document.querySelector(".react-flow__viewport") as HTMLElement).style.transform);
    const z1 = await zoom(); const t1 = await tr();
    const mm = (await page.locator(".react-flow__minimap svg").boundingBox())!;
    await page.mouse.click(mm.x + 6, mm.y + 6); // canto do minimapa, longe da nota
    await sleep(500);
    expect(await zoom()).toBeCloseTo(z1, 3);
    expect(await tr()).not.toBe(t1);
  }, 30_000);

  it("botão Centralizar mostra todos os itens, sem passar de 100%", async () => {
    await page.click("main.canvas .react-flow__pane", { position: { x: 30, y: 500 } });
    await page.keyboard.press("Control+Shift+D"); // segunda nota
    await page.waitForFunction(() => document.querySelectorAll(".node.note").length === 2);
    const sp = (await page.locator(".node.note .bar .sp").first().boundingBox())!;
    await page.mouse.dblclick(sp.x + sp.width / 2, sp.y + sp.height / 2); // aproxima numa nota
    await sleep(500);
    await page.click('[data-testid="fit-all"]');
    await sleep(500);
    expect(await zoom()).toBeLessThanOrEqual(1);
    const pane = (await page.locator("main.canvas .react-flow").boundingBox())!;
    for (const n of await page.locator(".node.note").all()) {
      const b = (await n.boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(pane.x); expect(b.y).toBeGreaterThanOrEqual(pane.y);
      expect(b.x + b.width).toBeLessThanOrEqual(pane.x + pane.width); expect(b.y + b.height).toBeLessThanOrEqual(pane.y + pane.height);
    }
  }, 30_000);
});
