import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// #80 — Monitor de processos do terminal, métrica ao vivo no nó e limite de memória.
const ROOT = join(import.meta.dirname, "../..");
const PORT = 48017;
let dataDir: string; let runtime: ChildProcess; let app: ElectronApplication; let page: Page; let token: string; let WS: string;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const api = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : null });
  return r.status === 204 ? null : r.json();
};

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "mess-pr-"));
  runtime = spawn("node", [join(ROOT, "apps/runtime/dist/index.js")], { env: { ...process.env, MESS_DATA_DIR: dataDir, MESS_PORT: String(PORT), SHELL: "/bin/sh" }, stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { await sleep(250); try { token = readFileSync(join(dataDir, "runtime.token"), "utf8").trim(); up = (await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: { authorization: `Bearer ${token}` } })).ok; } catch { /* subindo */ } }
  if (!up) throw new Error(`runtime de teste não subiu na porta ${PORT}`);
  WS = ((await api("POST", "/v1/workspaces", { name: "ProcWs", cwd: dataDir })) as { workspaceId: string }).workspaceId;
  await api("POST", `/v1/workspaces/${WS}/nodes`, { expectedRevision: 0, kind: "terminal", title: "NodeTerm", command: "node", args: ["-e", "setInterval(()=>{}, 1000)"], geometry: { x: 0, y: 0, w: 500, h: 340 } });
  app = await electron.launch({ args: ["."], cwd: join(ROOT, "apps/desktop"), env: { ...process.env, MESS_DATA_DIR: dataDir, MESS_PORT: String(PORT) } });
  page = await app.firstWindow();
  await page.waitForSelector(".side li.ws:has-text('ProcWs')"); await page.click(".side li.ws:has-text('ProcWs')");
  await page.waitForSelector('.react-flow__node:has-text("NodeTerm")', { state: "attached" });
}, 60_000);
afterAll(async () => {
  await app?.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
  await app?.close().catch(() => {});
  try { runtime?.kill(); } catch { /* */ }
  for (let i = 0; i < 15 && runtime && runtime.exitCode === null; i++) await sleep(100);
  if (runtime && runtime.exitCode === null) { try { runtime.kill("SIGKILL"); } catch { /* */ } }
  rmSync(dataDir, { recursive: true, force: true });
});

describe("Monitor de processos e limite de memória (#80)", () => {
  it("exibe a métrica de memória ao vivo na barra do nó, abre o painel de processos, define limite baixo e mostra aviso de estouro", async () => {
    await page.waitForSelector('[data-testid="term-mem-pill"]', { timeout: 10_000 });
    expect(await page.locator('[data-testid="term-mem-pill"]').innerText()).toContain("MB");

    await page.click('[data-testid="term-procs-btn"]');
    await page.waitForSelector('[data-testid="term-procs-panel"]');
    await page.waitForSelector('[data-testid="proc-row"]');
    expect(await page.locator('[data-testid="proc-row"]').count()).toBeGreaterThanOrEqual(1);

    // Define limite de 1 MB (processo node usa > 20 MB → estoura imediatamente)
    await page.fill('[data-testid="node-mem-limit"]', "1");
    await page.waitForSelector('[data-testid="term-mem-warn"]', { timeout: 10_000 });
    expect(await page.locator('[data-testid="term-mem-pill"]').getAttribute("class")).toContain("over");
  });
});
