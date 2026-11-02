import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// #47 — presença: ícones de agente na barra inferior com estado (rodando/encerrado) e contagem; selo de atenção na sidebar
// para OUTRO espaço (e somado no térreo quando é andar).
const ROOT = join(import.meta.dirname, "../..");
const PORT = 48007;
let dataDir: string; let runtime: ChildProcess; let app: ElectronApplication; let page: Page; let token: string;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const api = async (method: string, path: string, body?: unknown) => { const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : null }); const t = await r.text(); return t ? JSON.parse(t) : null; };
const rev = async (ws: string) => ((await api("GET", `/v1/workspaces/${ws}`)) as { workspace: { revision: number } }).workspace.revision;

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "mess-pres-"));
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

describe("presença (#47)", () => {
  it("barra inferior: ícone do agente com estado rodando → encerrado e contagem", async () => {
    const a = ((await api("POST", "/v1/workspaces", { name: "Presente", cwd: dataDir })) as { workspaceId: string }).workspaceId;
    await page.waitForSelector(".side li.ws:has-text('Presente')"); await page.click(".side li.ws:has-text('Presente')");
    const mk = async (title: string) => (await api("POST", `/v1/workspaces/${a}/nodes`, { expectedRevision: await rev(a), kind: "terminal", title, command: "/bin/sh", geometry: { x: 0, y: 0, w: 300, h: 200 } })) as { node: { nodeId: string }; session: { sessionId: string } };
    const t1 = await mk("claude 1"); await mk("claude 2");
    await page.waitForSelector('[data-testid="bb-agent"][data-state="running"]', { timeout: 10_000 });
    expect(await page.locator('[data-testid="bb-agent"] .pr-count').textContent()).toBe("2");
    expect(await page.getAttribute('[data-testid="bb-agent"]', "title")).toContain("×2");
    await api("POST", `/v1/sessions/${t1.session.sessionId}/stop`);
    await page.waitForSelector('[data-testid="bb-agent"][data-state="dead"]', { timeout: 10_000 });
  }, 40_000);

  it("sidebar: selo de atenção em OUTRO espaço (terminal que encerrou) e somado no térreo quando é andar", async () => {
    const b = ((await api("POST", "/v1/workspaces", { name: "Outro", cwd: dataDir })) as { workspaceId: string }).workspaceId;
    await api("POST", `/v1/workspaces/${b}/nodes`, { expectedRevision: await rev(b), kind: "terminal", title: "Efêmero", command: "/bin/sh", args: ["-c", "exit 0"], geometry: { x: 0, y: 0, w: 300, h: 200 } });
    await page.waitForSelector(".side li.ws:has-text('Outro') [data-testid='ws-signal']", { timeout: 15_000 });
    expect(await page.locator(".side li.ws:has-text('Outro') [data-testid='ws-signal']").getAttribute("title")).toContain("encerrado");
    // o espaço atual (Presente) também tem um encerrado do teste anterior; e o selo some quando o nó é apagado
    const nodes = ((await api("GET", `/v1/workspaces/${b}`)) as { nodes: { nodeId: string }[] }).nodes;
    await api("DELETE", `/v1/nodes/${nodes[0]!.nodeId}`, { expectedRevision: await rev(b) });
    await page.waitForSelector(".side li.ws:has-text('Outro') [data-testid='ws-signal']", { state: "detached", timeout: 15_000 });
  }, 40_000);
});
