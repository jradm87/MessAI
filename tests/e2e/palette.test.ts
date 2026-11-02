import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// #69 — paleta global (Ctrl+K) com Electron real: abre/fecha, pula para outro espaço, acha nó de outro espaço,
// acha conteúdo de nota (FTS5), executa ação, e lista quem espera você.
const ROOT = join(import.meta.dirname, "../..");
const PORT = 48003;
let dataDir: string; let runtime: ChildProcess; let app: ElectronApplication; let page: Page; let token: string;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const api = async (method: string, path: string, body?: unknown) => (await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : null })).json();
const open = async () => { await page.mouse.click(700, 60); await page.keyboard.press("Control+k"); await page.waitForSelector('[data-testid="palette"]'); };

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "mess-pal-"));
  runtime = spawn("node", [join(ROOT, "apps/runtime/dist/index.js")], { env: { ...process.env, MESS_DATA_DIR: dataDir, MESS_PORT: String(PORT), SHELL: "/bin/sh" }, stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { await sleep(250); try { token = readFileSync(join(dataDir, "runtime.token"), "utf8").trim(); up = (await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: { authorization: `Bearer ${token}` } })).ok; } catch { /* subindo */ } }
  if (!up) throw new Error(`runtime de teste não subiu na porta ${PORT}`);
  const w1 = (await api("POST", "/v1/workspaces", { name: "Alpha", cwd: dataDir })) as { workspaceId: string };
  const w2 = (await api("POST", "/v1/workspaces", { name: "Beta", cwd: dataDir })) as { workspaceId: string };
  await api("POST", `/v1/workspaces/${w1.workspaceId}/nodes`, { expectedRevision: 0, kind: "note", title: "Plano secreto", content: "migrar o banco de dados na sexta", geometry: { x: 0, y: 0, w: 260, h: 160 } });
  await api("POST", `/v1/workspaces/${w2.workspaceId}/nodes`, { expectedRevision: 0, kind: "note", title: "Anotações do Beta", content: "nada", geometry: { x: 0, y: 0, w: 260, h: 160 } });
  app = await electron.launch({ args: ["."], cwd: join(ROOT, "apps/desktop"), env: { ...process.env, MESS_DATA_DIR: dataDir, MESS_PORT: String(PORT) } });
  page = await app.firstWindow();
  await page.waitForSelector(".side li.ws:has-text('Alpha')");
  await page.click(".side li.ws:has-text('Alpha')");
}, 60_000);

afterAll(async () => {
  await app?.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
  await app?.close().catch(() => {});
  try { runtime?.kill(); } catch { /* */ }
  for (let i = 0; i < 15 && runtime && runtime.exitCode === null; i++) await sleep(100);
  if (runtime && runtime.exitCode === null) { try { runtime.kill("SIGKILL"); } catch { /* */ } }
  rmSync(dataDir, { recursive: true, force: true });
}, 30_000);

describe("Paleta global (#69)", () => {
  it("Ctrl+K abre; Esc fecha; digitar filtra; Enter em um espaço pula para ele", async () => {
    await open();
    await page.keyboard.press("Escape");
    await page.waitForSelector('[data-testid="palette"]', { state: "detached" });
    await open();
    await page.fill('[data-testid="palette-input"]', "beta");
    await page.waitForSelector('[data-testid="palette-item-workspace"]:has-text("Beta")');
    await page.keyboard.press("Enter");
    await page.waitForSelector(".side li.ws.on:has-text('Beta')", { timeout: 10_000 });
    await page.waitForSelector('[data-testid="palette"]', { state: "detached" });
  }, 30_000);

  it("acha nó de outro espaço pelo título e conteúdo de nota por FTS5; abrir leva ao espaço e seleciona o nó", async () => {
    await open();
    await page.fill('[data-testid="palette-input"]', "banco de dados");
    await page.waitForSelector('[data-testid="palette-item-content"]:has-text("Plano secreto")', { timeout: 10_000 });
    await page.keyboard.press("Enter");
    await page.waitForSelector(".side li.ws.on:has-text('Alpha')", { timeout: 10_000 });
    await page.waitForFunction(() => document.querySelector(".react-flow__node.selected")?.textContent?.includes("Plano secreto"), undefined, { timeout: 10_000 });
    await open();
    await page.fill('[data-testid="palette-input"]', "anotacoes"); // sem acento acha "Anotações"
    await page.waitForSelector('[data-testid="palette-item-node"]:has-text("Anotações do Beta")', { timeout: 10_000 });
    await page.keyboard.press("Escape");
  }, 40_000);

  it("ação executa (Novo espaço abre o diálogo); lista 'Esperando você' quando um terminal encerra", async () => {
    await open();
    await page.fill('[data-testid="palette-input"]', "novo espaço");
    await page.waitForSelector('[data-testid="palette-item-action"]:has-text("Novo espaço")');
    await page.keyboard.press("Enter");
    await page.waitForSelector('[data-testid="ws-dialog"]');
    await page.keyboard.press("Escape");
    // terminal que encerra → atenção "exited"
    const ws = ((await api("GET", "/v1/workspaces")) as { workspaceId: string; name: string }[]).find((w) => w.name === "Beta")!;
    const rev = ((await api("GET", `/v1/workspaces/${ws.workspaceId}`)) as { workspace: { revision: number } }).workspace.revision;
    const t = (await api("POST", `/v1/workspaces/${ws.workspaceId}/nodes`, { expectedRevision: rev, kind: "terminal", title: "Efêmero", command: "/bin/sh", args: ["-c", "exit 0"], geometry: { x: 400, y: 0, w: 300, h: 200 } })) as { node: { nodeId: string } };
    for (let i = 0; i < 30; i++) { const a = (await api("GET", "/v1/attention")) as { nodeId: string }[]; if (a.some((x) => x.nodeId === t.node.nodeId)) break; await sleep(200); }
    await open();
    await page.waitForSelector('[data-testid="palette-item-attention"]:has-text("Efêmero")', { timeout: 10_000 });
    await page.keyboard.press("Enter");
    await page.waitForSelector(".side li.ws.on:has-text('Beta')", { timeout: 10_000 });
    await page.waitForFunction(() => document.querySelector(".react-flow__node.selected")?.textContent?.includes("Efêmero"), undefined, { timeout: 10_000 });
  }, 50_000);
});
