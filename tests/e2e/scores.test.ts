import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// #71 — Partituras com Electron real: salvar a seleção pela paleta, listar, colocar em OUTRO espaço, desfazer a colocação, renomear e apagar.
const ROOT = join(import.meta.dirname, "../..");
const PORT = 48011;
let dataDir: string; let runtime: ChildProcess; let app: ElectronApplication; let page: Page; let token: string; let A: string; let B: string;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const api = async (method: string, path: string, body?: unknown) => { const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : null }); const t = await r.text(); return t ? JSON.parse(t) : null; };
type Snap = { workspace: { revision: number }; nodes: { nodeId: string; kind: string; title: string }[]; connections: unknown[] };
const snap = async (ws: string) => (await api("GET", `/v1/workspaces/${ws}`)) as Snap;
const openScores = async () => { await page.mouse.click(700, 60); await page.keyboard.press("Control+k"); await page.fill('[data-testid="palette-input"]', "partituras"); await page.waitForSelector('[data-testid="palette-item-action"]:has-text("Partituras")'); await page.keyboard.press("Enter"); await page.waitForSelector('[data-testid="scores-dialog"]'); };

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "mess-sc-"));
  runtime = spawn("node", [join(ROOT, "apps/runtime/dist/index.js")], { env: { ...process.env, MESS_DATA_DIR: dataDir, MESS_PORT: String(PORT), SHELL: "/bin/sh" }, stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { await sleep(250); try { token = readFileSync(join(dataDir, "runtime.token"), "utf8").trim(); up = (await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: { authorization: `Bearer ${token}` } })).ok; } catch { /* subindo */ } }
  if (!up) throw new Error(`runtime de teste não subiu na porta ${PORT}`);
  A = ((await api("POST", "/v1/workspaces", { name: "Origem", cwd: dataDir })) as { workspaceId: string }).workspaceId;
  B = ((await api("POST", "/v1/workspaces", { name: "Destino", cwd: dataDir })) as { workspaceId: string }).workspaceId;
  const n1 = (await api("POST", `/v1/workspaces/${A}/nodes`, { expectedRevision: (await snap(A)).workspace.revision, kind: "note", title: "Nota 1", content: "a", geometry: { x: 0, y: 0, w: 260, h: 160 } })) as { node: { nodeId: string } };
  const t1 = (await api("POST", `/v1/workspaces/${A}/nodes`, { expectedRevision: (await snap(A)).workspace.revision, kind: "terminal", title: "Shell X", command: "/bin/sh", geometry: { x: 400, y: 0, w: 300, h: 200 } })) as { node: { nodeId: string } };
  await api("POST", `/v1/workspaces/${A}/connections`, { expectedRevision: (await snap(A)).workspace.revision, sourceNodeId: n1.node.nodeId, targetNodeId: t1.node.nodeId });
  app = await electron.launch({ args: ["."], cwd: join(ROOT, "apps/desktop"), env: { ...process.env, MESS_DATA_DIR: dataDir, MESS_PORT: String(PORT) } });
  page = await app.firstWindow();
  await page.waitForSelector(".side li.ws:has-text('Origem')"); await page.click(".side li.ws:has-text('Origem')");
  await page.waitForSelector('.react-flow__node:has-text("Shell X")', { state: "attached" });
}, 60_000);
afterAll(async () => {
  await app?.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
  await app?.close().catch(() => {});
  try { runtime?.kill(); } catch { /* */ }
  for (let i = 0; i < 15 && runtime && runtime.exitCode === null; i++) await sleep(100);
  if (runtime && runtime.exitCode === null) { try { runtime.kill("SIGKILL"); } catch { /* */ } }
  rmSync(dataDir, { recursive: true, force: true });
}, 30_000);

describe("Partituras (#71)", () => {
  it("salvar o espaço todo, colocar em outro espaço (nós + conexão), desfazer a colocação; renomear e apagar", async () => {
    await openScores();
    await page.fill('[data-testid="score-name"]', "Dupla");
    await page.click('[data-testid="score-save"]');
    await page.waitForSelector('[data-testid="score-row"]:has-text("Dupla")');
    expect(await page.locator('[data-testid="score-row"] small').textContent()).toContain("2 nó(s)");
    await page.keyboard.press("Escape");
    await page.waitForSelector('[data-testid="scores-dialog"]', { state: "detached" });
    // vai ao Destino e coloca
    await page.click(".side li.ws:has-text('Destino')");
    await page.waitForSelector(".side li.ws.on:has-text('Destino')");
    await openScores();
    await page.click('[data-testid="score-place-Dupla"]');
    await page.waitForSelector('[data-testid="scores-dialog"]', { state: "detached", timeout: 15_000 });
    for (let i = 0; i < 30 && (await snap(B)).nodes.length < 2; i++) await sleep(200);
    let s = await snap(B);
    expect(s.nodes.map((n) => n.title).sort()).toEqual(["Nota 1", "Shell X"]); expect(s.connections).toHaveLength(1);
    await page.waitForSelector('.react-flow__node:has-text("Shell X") .st.running', { state: "attached", timeout: 10_000 });
    // desfazer a colocação
    await page.mouse.click(700, 60); await page.keyboard.press("Control+z");
    for (let i = 0; i < 40 && (await snap(B)).nodes.length > 0; i++) await sleep(200);
    s = await snap(B); expect(s.nodes).toHaveLength(0);
    // renomear e apagar
    await openScores();
    await page.click('[data-testid="score-row"] button[title="Renomear"]');
    await page.keyboard.press("Control+a"); await page.keyboard.type("Dupla v2"); await page.keyboard.press("Enter");
    await page.waitForSelector('[data-testid="score-row"]:has-text("Dupla v2")');
    page.once("dialog", (d) => void d.accept());
    await page.click('[data-testid="score-row"] button[title="Apagar"]');
    await page.waitForSelector('[data-testid="score-row"]', { state: "detached" });
    expect(((await api("GET", "/v1/scores")) as unknown[]).length).toBe(0);
  }, 60_000);
});
