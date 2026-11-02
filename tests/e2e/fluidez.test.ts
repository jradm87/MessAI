import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// #42 — render incremental: eventos de snapshot (criar/editar OUTRO nó) não re-renderizam os terminais/notas que não mudaram.
const ROOT = join(import.meta.dirname, "../..");
const PORT = 48005;
let dataDir: string; let runtime: ChildProcess; let app: ElectronApplication; let page: Page; let token: string; let ws: string;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const api = async (method: string, path: string, body?: unknown) => (await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : null })).json();
const rev = async () => ((await api("GET", `/v1/workspaces/${ws}`)) as { workspace: { revision: number } }).workspace.revision;
const renders = () => page.evaluate(() => ({ ...(window as unknown as { __messRenders: Record<string, number> }).__messRenders }));

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "mess-flu-"));
  runtime = spawn("node", [join(ROOT, "apps/runtime/dist/index.js")], { env: { ...process.env, MESS_DATA_DIR: dataDir, MESS_PORT: String(PORT), SHELL: "/bin/sh" }, stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { await sleep(250); try { token = readFileSync(join(dataDir, "runtime.token"), "utf8").trim(); up = (await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: { authorization: `Bearer ${token}` } })).ok; } catch { /* subindo */ } }
  if (!up) throw new Error(`runtime de teste não subiu na porta ${PORT}`);
  app = await electron.launch({ args: ["."], cwd: join(ROOT, "apps/desktop"), env: { ...process.env, MESS_DATA_DIR: dataDir, MESS_PORT: String(PORT) } });
  page = await app.firstWindow();
  await page.waitForSelector(".side h1");
  ws = ((await api("POST", "/v1/workspaces", { name: "Flu", cwd: dataDir })) as { workspaceId: string }).workspaceId;
  await page.waitForSelector(".side li.ws:has-text('Flu')"); await page.click(".side li.ws:has-text('Flu')");
}, 60_000);
afterAll(async () => {
  await app?.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
  await app?.close().catch(() => {});
  try { runtime?.kill(); } catch { /* */ }
  for (let i = 0; i < 15 && runtime && runtime.exitCode === null; i++) await sleep(100);
  if (runtime && runtime.exitCode === null) { try { runtime.kill("SIGKILL"); } catch { /* */ } }
  rmSync(dataDir, { recursive: true, force: true });
}, 30_000);

describe("render incremental (#42)", () => {
  it("criar/editar outros nós não re-renderiza terminal nem nota que não mudaram; o nó editado re-renderiza", async () => {
    const t = (await api("POST", `/v1/workspaces/${ws}/nodes`, { expectedRevision: await rev(), kind: "terminal", title: "T", command: "/bin/sh", geometry: { x: 0, y: 0, w: 400, h: 260 } })) as { node: { nodeId: string } };
    const n1 = (await api("POST", `/v1/workspaces/${ws}/nodes`, { expectedRevision: await rev(), kind: "note", title: "N1", content: "um", geometry: { x: 500, y: 0, w: 260, h: 160 } })) as { node: { nodeId: string } };
    await page.waitForSelector(`.react-flow__node[data-id="${n1.node.nodeId}"]`, { state: "attached" });
    await page.waitForSelector(`.react-flow__node[data-id="${t.node.nodeId}"] .st.running`, { state: "attached", timeout: 10_000 });
    await sleep(1500); // assenta (resize observers, sessão running, polls)
    const before = await renders();
    // 5 mutações em OUTROS nós: cada uma gera um snapshot
    for (let i = 0; i < 3; i++) await api("POST", `/v1/workspaces/${ws}/nodes`, { expectedRevision: await rev(), kind: "note", title: `Extra ${i}`, content: "x", geometry: { x: 900 + i * 300, y: 0, w: 260, h: 160 } });
    await page.waitForSelector('.react-flow__node:has-text("Extra 2")', { state: "attached" });
    await api("PATCH", `/v1/nodes/${n1.node.nodeId}`, { expectedRevision: await rev(), content: "dois" });
    await page.waitForFunction((id) => document.querySelector(`.react-flow__node[data-id="${id}"]`)?.textContent?.includes("dois"), n1.node.nodeId, { timeout: 10_000 });
    await sleep(800);
    const after = await renders();
    const dT = (after[t.node.nodeId] ?? 0) - (before[t.node.nodeId] ?? 0);
    expect(dT, `terminal re-renderizou ${dT}x com mutações em outros nós`).toBeLessThanOrEqual(1);
    expect((after[n1.node.nodeId] ?? 0) - (before[n1.node.nodeId] ?? 0), "a nota editada deve re-renderizar").toBeGreaterThan(0);
  }, 60_000);
});
