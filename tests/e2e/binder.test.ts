import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// #74 — fichários com Electron real: criar pelo menu, abas/páginas, tirar página (vira nota), puxar notas selecionadas, soltar nota em cima,
// desmontar, cor uniforme, empilhar pela paleta, undo.
const ROOT = join(import.meta.dirname, "../..");
const PORT = 48013;
let dataDir: string; let runtime: ChildProcess; let app: ElectronApplication; let page: Page; let token: string; let ws: string;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const api = async (method: string, path: string, body?: unknown) => { const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : null }); const t = await r.text(); return t ? JSON.parse(t) : null; };
type N = { nodeId: string; kind: string; title: string; content?: string; geometry: { x: number; y: number; w: number; h: number } };
const nodes = async () => ((await api("GET", `/v1/workspaces/${ws}`)) as { nodes: N[] }).nodes;
const rev = async () => ((await api("GET", `/v1/workspaces/${ws}`)) as { workspace: { revision: number } }).workspace.revision;
const binder = async () => { const b = (await nodes()).find((n) => n.kind === "binder"); return b ? { node: b, data: JSON.parse(b.content ?? "{}") as { pages: { id: string; title: string; content: string }[]; active: string; color: string } } : null; };
const waitFor = async <T,>(fn: () => Promise<T | null | false>, ms = 8000): Promise<T> => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) throw new Error("timeout waitFor"); await sleep(150); } };
const canvasClick = async () => { await page.click("main.canvas .react-flow__pane", { position: { x: 30, y: 600 } }); };
const fit = async () => { await canvasClick(); await page.keyboard.press("Control+\\"); await sleep(450); }; // enquadra tudo (nós podem nascer fora da vista)

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "mess-bd-"));
  runtime = spawn("node", [join(ROOT, "apps/runtime/dist/index.js")], { env: { ...process.env, MESS_DATA_DIR: dataDir, MESS_PORT: String(PORT), SHELL: "/bin/sh" }, stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { await sleep(250); try { token = readFileSync(join(dataDir, "runtime.token"), "utf8").trim(); up = (await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: { authorization: `Bearer ${token}` } })).ok; } catch { /* subindo */ } }
  if (!up) throw new Error(`runtime de teste não subiu na porta ${PORT}`);
  ws = ((await api("POST", "/v1/workspaces", { name: "Fich", cwd: dataDir })) as { workspaceId: string }).workspaceId;
  app = await electron.launch({ args: ["."], cwd: join(ROOT, "apps/desktop"), env: { ...process.env, MESS_DATA_DIR: dataDir, MESS_PORT: String(PORT) } });
  page = await app.firstWindow();
  await page.waitForSelector(".side li.ws:has-text('Fich')"); await page.click(".side li.ws:has-text('Fich')"); await page.waitForSelector(".side li.ws.on:has-text('Fich')");
}, 60_000);
afterAll(async () => {
  await app?.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
  await app?.close().catch(() => {});
  try { runtime?.kill(); } catch { /* */ }
  for (let i = 0; i < 15 && runtime && runtime.exitCode === null; i++) await sleep(100);
  if (runtime && runtime.exitCode === null) { try { runtime.kill("SIGKILL"); } catch { /* */ } }
  rmSync(dataDir, { recursive: true, force: true });
}, 30_000);

describe("fichários (#74)", () => {
  it("criar pelo menu +; adicionar página, escrever, trocar de aba; persiste no runtime", async () => {
    await page.click('[data-testid="add"]'); await page.click('[data-testid="add-binder"]');
    await page.waitForSelector('[data-testid="binder"]');
    expect((await binder())!.data.pages).toHaveLength(1);
    await page.fill('[data-testid="binder-text"]', "conteúdo da página 1");
    await page.click('[data-testid="binder-add"]');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="binder-tab"]').length === 2);
    await page.fill('[data-testid="binder-text"]', "segunda página");
    await waitFor(async () => { const b = await binder(); return b && b.data.pages[1]?.content === "segunda página" && b; });
    await page.click('[data-testid="binder-tab"] >> nth=0');
    expect(await page.inputValue('[data-testid="binder-text"]')).toBe("conteúdo da página 1");
    const b = await waitFor(async () => { const x = await binder(); return x && x.data.active === x.data.pages[0]!.id && x; }); expect(b.data.pages.map((p) => p.content)).toEqual(["conteúdo da página 1", "segunda página"]);
  }, 40_000);

  it("tirar página (vira nota ao lado) e desfazer; trazer para frente", async () => {
    await fit();
    await page.click('[data-testid="binder-tab"] >> nth=1', { button: "right" });
    await page.click('[data-testid="binder-spill"]');
    const after = await waitFor(async () => { const l = await nodes(); return l.some((n) => n.kind === "note") && l; });
    const note = after.find((n) => n.kind === "note")!; expect(note.content).toBe("segunda página");
    expect((await binder())!.data.pages).toHaveLength(1);
    await canvasClick(); await page.keyboard.press("Control+z");
    await waitFor(async () => (await nodes()).every((n) => n.kind !== "note") && (await binder())!.data.pages.length === 2);
    await fit();
    await page.click('[data-testid="binder-tab"] >> nth=1', { button: "right" });
    await page.click('[data-testid="binder-front"]');
    await waitFor(async () => (await binder())!.data.pages[0]!.content === "segunda página");
  }, 40_000);

  it("puxar notas selecionadas; soltar uma nota em cima; cor uniforme; desmontar", async () => {
    const b0 = (await binder())!;
    const n1 = (await api("POST", `/v1/workspaces/${ws}/nodes`, { expectedRevision: await rev(), kind: "note", title: "Solta A", content: "A!", geometry: { x: b0.node.geometry.x, y: b0.node.geometry.y + 500, w: 260, h: 160 } })) as { node: { nodeId: string } };
    await page.waitForSelector(`.react-flow__node[data-id="${n1.node.nodeId}"]`, { state: "attached" }); await fit();
    // seleciona a nota e puxa pelo botão do fichário
    await page.locator(`.react-flow__node[data-id="${n1.node.nodeId}"] .bar .title`).click();
    await page.locator('[data-testid="binder"] .bar').first().click({ position: { x: 150, y: 5 } }).catch(() => {});
    await page.locator(`.react-flow__node[data-id="${n1.node.nodeId}"] .bar .title`).click();
    await page.evaluate(() => (document.querySelector('[data-testid="binder-pull"]') as HTMLButtonElement).click());
    await waitFor(async () => (await binder())!.data.pages.some((p) => p.title === "Solta A") && (await nodes()).every((n) => n.nodeId !== n1.node.nodeId));
    expect((await binder())!.data.pages.find((p) => p.title === "Solta A")!.content).toBe("A!");
    // cor uniforme
    await page.click('[data-testid="binder"] button[title="Cor uniforme"]');
    await page.click('[data-testid="binder"] .color-menu .sw[title="#ef5350"]');
    await waitFor(async () => (await binder())!.data.color === "#ef5350");
    // desmontar: cada página vira nota (com a cor) e o fichário some; desfazer volta
    const npages = (await binder())!.data.pages.length;
    await page.click('[data-testid="binder-unstack"]');
    await waitFor(async () => !(await binder()) && (await nodes()).filter((n) => n.kind === "note").length === npages);
    await canvasClick(); await page.keyboard.press("Control+z");
    await waitFor(async () => (await binder()) && (await nodes()).every((n) => n.kind !== "note"), 12000);
    expect((await binder())!.data.pages).toHaveLength(npages);
  }, 60_000);

  it("empilhar notas selecionadas pela paleta cria um fichário com uma página por nota", async () => {
    const b = (await binder())!;
    await fit(); await page.click('[data-testid="binder-unstack"]'); await waitFor(async () => !(await binder()));
    const mk = async (t: string, x: number) => (await api("POST", `/v1/workspaces/${ws}/nodes`, { expectedRevision: await rev(), kind: "note", title: t, content: `corpo ${t}`, geometry: { x, y: b.node.geometry.y + 700, w: 260, h: 160 } })) as { node: { nodeId: string } };
    const x = await mk("Nota X", 0), y = await mk("Nota Y", 300);
    await page.waitForSelector(`.react-flow__node[data-id="${y.node.nodeId}"]`, { state: "attached" }); await fit();
    // seleção por retângulo (Shift+arrastar no fundo) em volta das duas notas
    const bx = (await page.locator(`.react-flow__node[data-id="${x.node.nodeId}"]`).boundingBox())!, by = (await page.locator(`.react-flow__node[data-id="${y.node.nodeId}"]`).boundingBox())!;
    await page.keyboard.down("Shift");
    await page.mouse.move(Math.min(bx.x, by.x) - 20, Math.min(bx.y, by.y) - 20); await page.mouse.down();
    await page.mouse.move(Math.max(bx.x + bx.width, by.x + by.width) + 20, Math.max(bx.y + bx.height, by.y + by.height) + 20, { steps: 8 }); await page.mouse.up();
    await page.keyboard.up("Shift");
    await page.waitForFunction(() => document.querySelectorAll(".react-flow__node.selected").length === 2, undefined, { timeout: 10_000 });
    await page.keyboard.press("Control+k"); await page.fill('[data-testid="palette-input"]', "empilhar");
    await page.waitForSelector('[data-testid="palette-item-action"]:has-text("Empilhar")'); await page.keyboard.press("Enter");
    const nb = await waitFor(async () => { const bb = await binder(); return bb && bb.data.pages.length >= 2 && bb; });
    expect(nb.data.pages.map((p) => p.title)).toEqual(expect.arrayContaining(["Nota X", "Nota Y"]));
    await waitFor(async () => (await nodes()).filter((n) => (n.title === "Nota X" || n.title === "Nota Y") && n.kind === "note").length === 0); // as notas somem depois que o fichário é criado
    await canvasClick(); await page.keyboard.press("Control+z"); // um Ctrl+Z desfaz o empilhar inteiro
    await waitFor(async () => !(await binder()) && (await nodes()).filter((n) => n.kind === "note" && (n.title === "Nota X" || n.title === "Nota Y")).length === 2, 15000);
  }, 60_000);

  it("arrastar uma nota e soltá-la em cima de um fichário a puxa para dentro (como página)", async () => {
    const bnd = (await api("POST", `/v1/workspaces/${ws}/nodes`, { expectedRevision: await rev(), kind: "binder", geometry: { x: 0, y: 2000, w: 420, h: 280 } })) as { node: { nodeId: string } };
    const nt = (await api("POST", `/v1/workspaces/${ws}/nodes`, { expectedRevision: await rev(), kind: "note", title: "Arrastada", content: "vou pro fichário", geometry: { x: 600, y: 2000, w: 260, h: 160 } })) as { node: { nodeId: string } };
    await page.waitForSelector(`.react-flow__node[data-id="${nt.node.nodeId}"]`, { state: "attached" }); await fit();
    const tb = (await page.locator(`.react-flow__node[data-id="${nt.node.nodeId}"] .bar .title`).boundingBox())!;
    const target = (await page.locator(`.react-flow__node[data-id="${bnd.node.nodeId}"] [data-testid="binder-text"]`).boundingBox())!;
    await page.mouse.move(tb.x + 5, tb.y + 5); await page.mouse.down();
    await page.mouse.move(tb.x + 8, tb.y + 5); await sleep(30);
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 30 }); await sleep(150);
    await page.mouse.up();
    const got = await waitFor(async () => { const l = await nodes(); const b = l.find((n) => n.nodeId === bnd.node.nodeId); return b && JSON.parse(b.content ?? "{}").pages?.some((p: { title: string }) => p.title === "Arrastada") && !l.some((n) => n.nodeId === nt.node.nodeId) && b; }, 12000);
    expect(JSON.parse(got.content!).pages.find((p: { title: string }) => p.title === "Arrastada").content).toBe("vou pro fichário");
  }, 50_000);
});

