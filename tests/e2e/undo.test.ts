import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// #77 — desfazer/refazer com Electron real: criar nota (Ctrl+Z apaga, Ctrl+Shift+Z recria), renomear, arrastar (volta à posição),
// excluir nó com conexão (undo recria nó E conexão), botões da barra, Ctrl+Y.
const ROOT = join(import.meta.dirname, "../..");
const PORT = 47989;
let dataDir: string; let runtime: ChildProcess; let app: ElectronApplication; let page: Page; let token: string; let ws: string;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const api = async (method: string, path: string, body?: unknown) => (await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : null })).json();
type Snap = { workspace: { revision: number }; nodes: { nodeId: string; kind: string; title: string; content?: string; geometry: { x: number; y: number } }[]; connections: { sourceNodeId: string; targetNodeId: string }[] };
const snap = async () => (await api("GET", `/v1/workspaces/${ws}`)) as Snap;
const rev = async () => (await snap()).workspace.revision;
const canvasClick = async () => { await page.click("main.canvas .react-flow__pane", { position: { x: 30, y: 500 } }); };

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "mess-undo-"));
  runtime = spawn("node", [join(ROOT, "apps/runtime/dist/index.js")], { env: { ...process.env, MESS_DATA_DIR: dataDir, MESS_PORT: String(PORT), SHELL: "/bin/sh" }, stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { await sleep(250); try { token = readFileSync(join(dataDir, "runtime.token"), "utf8").trim(); up = (await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: { authorization: `Bearer ${token}` } })).ok; } catch { /* subindo */ } }
  if (!up) throw new Error(`runtime de teste não subiu na porta ${PORT}`);
  app = await electron.launch({ args: ["."], cwd: join(ROOT, "apps/desktop"), env: { ...process.env, MESS_DATA_DIR: dataDir, MESS_PORT: String(PORT) } });
  page = await app.firstWindow();
  await page.waitForSelector(".side h1");
  ws = ((await api("POST", "/v1/workspaces", { name: "Undo", cwd: dataDir })) as { workspaceId: string }).workspaceId;
  await page.waitForSelector(".side li.ws:has-text('Undo')");
  await page.click(".side li.ws:has-text('Undo')");
  await page.waitForSelector(".side li.ws.on:has-text('Undo')");
}, 60_000);

afterAll(async () => {
  await app?.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
  await app?.close().catch(() => {});
  try { runtime?.kill(); } catch { /* */ }
  for (let i = 0; i < 15 && runtime && runtime.exitCode === null; i++) await sleep(100);
  if (runtime && runtime.exitCode === null) { try { runtime.kill("SIGKILL"); } catch { /* */ } }
  rmSync(dataDir, { recursive: true, force: true });
}, 30_000);

describe("Desfazer/refazer (#77)", () => {
  it("criar nota: Ctrl+Z apaga, Ctrl+Shift+Z recria; botões acompanham", async () => {
    await canvasClick();
    expect(await page.locator('[data-testid="undo"]').isDisabled()).toBe(true);
    await page.keyboard.press("Control+Shift+D"); // nova nota
    await page.waitForSelector(".node.note");
    expect((await snap()).nodes.filter((n) => n.kind === "note")).toHaveLength(1);
    await page.waitForFunction(() => !(document.querySelector('[data-testid="undo"]') as HTMLButtonElement).disabled);
    await canvasClick(); await page.keyboard.press("Control+z");
    await page.waitForSelector(".node.note", { state: "detached", timeout: 10_000 });
    expect((await snap()).nodes.filter((n) => n.kind === "note")).toHaveLength(0);
    await page.waitForFunction(() => !(document.querySelector('[data-testid="redo"]') as HTMLButtonElement).disabled);
    await page.keyboard.press("Control+Shift+Z");
    await page.waitForSelector(".node.note", { timeout: 10_000 });
    expect((await snap()).nodes.filter((n) => n.kind === "note")).toHaveLength(1);
    await page.waitForSelector(".toast:has-text('Refeito: criar nota')");
  }, 30_000);

  it("renomear e desfazer; arrastar e desfazer volta à posição", async () => {
    const before = (await snap()).nodes.find((n) => n.kind === "note")!;
    await page.dblclick(".node.note .bar .title");
    await page.fill(".node.note .title-edit", "Renomeada"); await page.keyboard.press("Enter");
    await page.waitForSelector(".node.note .bar .title:has-text('Renomeada')");
    await canvasClick(); await page.keyboard.press("Control+z");
    await page.waitForSelector(`.node.note .bar .title:has-text('${before.title}')`, { timeout: 10_000 });
    // arrastar pela barra
    const bar = page.locator(".node.note .bar .title"); const b = (await bar.boundingBox())!;
    await page.mouse.move(b.x + 5, b.y + 5); await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(b.x + 5 + i * 15, b.y + 5 + i * 12);
    await page.mouse.up();
    for (let i = 0; i < 20; i++) { const n = (await snap()).nodes.find((x) => x.kind === "note")!; if (n.geometry.x !== before.geometry.x) break; await sleep(150); }
    const moved = (await snap()).nodes.find((x) => x.kind === "note")!;
    expect(moved.geometry.x).not.toBe(before.geometry.x);
    await canvasClick(); await page.keyboard.press("Control+z");
    for (let i = 0; i < 20; i++) { const n = (await snap()).nodes.find((x) => x.kind === "note")!; if (n.geometry.x === before.geometry.x) break; await sleep(150); }
    const back = (await snap()).nodes.find((x) => x.kind === "note")!;
    expect(back.geometry).toEqual(before.geometry);
    await page.waitForSelector(".toast:has-text('Desfeito: mover 1 nó')");
  }, 40_000);

  it("excluir nó conectado: um Ctrl+Z recria o nó com conteúdo E a conexão; Ctrl+Y refaz a exclusão", async () => {
    const r0 = await rev();
    const a = (await api("POST", `/v1/workspaces/${ws}/nodes`, { expectedRevision: r0, kind: "note", title: "Alvo", content: "conteúdo importante", geometry: { x: 600, y: 300, w: 260, h: 160 } })) as { node: { nodeId: string } };
    const other = (await snap()).nodes.find((n) => n.kind === "note" && n.nodeId !== a.node.nodeId)!;
    await api("POST", `/v1/workspaces/${ws}/connections`, { expectedRevision: await rev(), sourceNodeId: other.nodeId, targetNodeId: a.node.nodeId });
    const node = page.locator(`.react-flow__node[data-id="${a.node.nodeId}"]`);
    await node.waitFor({ state: "attached" });
    await page.waitForSelector(".react-flow__edge", { state: "attached" });
    await canvasClick(); await page.keyboard.press("Control+\\"); await sleep(400); // enquadra
    await node.locator(".bar .title").click();
    await page.keyboard.press("Delete");
    await node.waitFor({ state: "detached", timeout: 10_000 });
    expect((await snap()).connections).toHaveLength(0);
    await canvasClick(); await page.keyboard.press("Control+z");
    await page.waitForFunction(() => document.querySelectorAll(".node.note").length === 2, undefined, { timeout: 15_000 });
    for (let i = 0; i < 30; i++) { if ((await snap()).connections.length === 1) break; await sleep(200); }
    const s = await snap();
    const back = s.nodes.find((n) => n.title === "Alvo")!;
    expect(back).toBeTruthy(); expect(back.content).toBe("conteúdo importante"); expect(back.nodeId).not.toBe(a.node.nodeId); // id novo
    expect(s.connections).toHaveLength(1); expect(s.connections[0]!.targetNodeId).toBe(back.nodeId); // reconectado ao id novo
    await page.keyboard.press("Control+y"); // refaz a exclusão (apelido fixo)
    await page.waitForFunction(() => document.querySelectorAll(".node.note").length === 1, undefined, { timeout: 15_000 });
    expect((await snap()).nodes.find((n) => n.title === "Alvo")).toBeUndefined();
    await page.click('[data-testid="undo"]'); // botão da barra
    await page.waitForFunction(() => document.querySelectorAll(".node.note").length === 2, undefined, { timeout: 15_000 });
  }, 60_000);
});
