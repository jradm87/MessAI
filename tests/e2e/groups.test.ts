import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// #78 — grupos de nós e encaixe magnético com Electron real: Ctrl+G agrupa 2 notas (contêiner com rótulo), arrastar uma move
// as duas, renomear pelo rótulo, Ctrl+Shift+G desagrupa; com o ímã ligado, arrastar encaixa a borda na do vizinho.
const ROOT = join(import.meta.dirname, "../..");
const PORT = 47995;
let dataDir: string; let runtime: ChildProcess; let app: ElectronApplication; let page: Page; let token: string; let ws: string;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const api = async (method: string, path: string, body?: unknown) => (await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : null })).json();
type Snap = { workspace: { revision: number }; nodes: { nodeId: string; title: string; groupId?: string; geometry: { x: number; y: number; w: number; h: number } }[]; groups: { groupId: string; label: string; color: string }[] };
const snap = async () => (await api("GET", `/v1/workspaces/${ws}`)) as Snap;
const rev = async () => (await snap()).workspace.revision;
const byTitle = async (t: string) => (await snap()).nodes.find((n) => n.title === t)!;
const canvasClick = async () => { await page.click("main.canvas .react-flow__pane", { position: { x: 30, y: 500 } }); };
const dragBar = async (title: string, dx: number, dy: number) => {
  const bar = page.locator(`.react-flow__node-note:has-text("${title}") .bar .title`); const b = (await bar.boundingBox())!;
  await page.mouse.move(b.x + 5, b.y + 5); await page.mouse.down();
  // O React Flow fixa o ponto de referência do arrasto no PRIMEIRO move que EXCEDE o limiar (1 px): o nó fica defasado do
  // ponteiro pelo tamanho desse passo. Primeiro passo de 3 px (defasagem ~2 unidades); depois 40 passos até o destino.
  await page.mouse.move(b.x + 5 + Math.sign(dx || 1) * 3, b.y + 5); await sleep(30);
  for (let i = 1; i <= 40; i++) await page.mouse.move(b.x + 5 + (dx * i) / 40, b.y + 5 + (dy * i) / 40);
  await sleep(150);
  await page.mouse.up();
};

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "mess-groups-e2e-"));
  runtime = spawn("node", [join(ROOT, "apps/runtime/dist/index.js")], { env: { ...process.env, MESS_DATA_DIR: dataDir, MESS_PORT: String(PORT), SHELL: "/bin/sh" }, stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { await sleep(250); try { token = readFileSync(join(dataDir, "runtime.token"), "utf8").trim(); up = (await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: { authorization: `Bearer ${token}` } })).ok; } catch { /* subindo */ } }
  if (!up) throw new Error(`runtime de teste não subiu na porta ${PORT}`);
  app = await electron.launch({ args: ["."], cwd: join(ROOT, "apps/desktop"), env: { ...process.env, MESS_DATA_DIR: dataDir, MESS_PORT: String(PORT) } });
  page = await app.firstWindow();
  await page.waitForSelector(".side h1");
  ws = ((await api("POST", "/v1/workspaces", { name: "Grp", cwd: dataDir })) as { workspaceId: string }).workspaceId;
  await page.waitForSelector(".side li.ws:has-text('Grp')"); await page.click(".side li.ws:has-text('Grp')"); await page.waitForSelector(".side li.ws.on:has-text('Grp')");
  for (const [t, x, y] of [["A", 0, 0], ["B", 400, 0], ["C", 0, 400], ["D", 520, 400]] as const) await api("POST", `/v1/workspaces/${ws}/nodes`, { expectedRevision: await rev(), kind: "note", title: t, content: "", geometry: { x, y, w: 260, h: 160 } });
  await page.waitForSelector('.react-flow__node-note:has-text("D")', { state: "attached" });
  await canvasClick(); await page.keyboard.press("Control+\\"); await sleep(500); // enquadra tudo
}, 60_000);

afterAll(async () => {
  await app?.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
  await app?.close().catch(() => {});
  try { runtime?.kill(); } catch { /* */ }
  for (let i = 0; i < 15 && runtime && runtime.exitCode === null; i++) await sleep(100);
  if (runtime && runtime.exitCode === null) { try { runtime.kill("SIGKILL"); } catch { /* */ } }
  rmSync(dataDir, { recursive: true, force: true });
}, 30_000);

describe("Grupos de nós (#78)", () => {
  it("Ctrl+G agrupa A e B; arrastar A move B junto; renomear pelo rótulo; Ctrl+Shift+G desagrupa; undo recria o grupo", async () => {
    // seleção por retângulo (Shift+arrastar no fundo) envolvendo A e B
    const ba = (await page.locator('.react-flow__node-note:has-text("A")').boundingBox())!, bb = (await page.locator('.react-flow__node-note:has-text("B")').boundingBox())!;
    await page.keyboard.down("Shift");
    await page.mouse.move(ba.x - 30, ba.y - 30); await page.mouse.down();
    await page.mouse.move(bb.x + bb.width + 30, bb.y + bb.height + 30, { steps: 8 }); await page.mouse.up();
    await page.keyboard.up("Shift");
    await page.waitForFunction(() => document.querySelectorAll(".react-flow__node.selected").length === 2, undefined, { timeout: 10_000 });
    await page.keyboard.press("Control+g");
    await page.waitForSelector('[data-testid="ngroup"]', { timeout: 10_000 });
    let s = await snap(); expect(s.groups).toHaveLength(1);
    const gid = s.groups[0]!.groupId;
    expect(s.nodes.filter((n) => n.groupId === gid).map((n) => n.title).sort()).toEqual(["A", "B"]);
    expect(await page.locator('[data-testid="ngroup-name"]').textContent()).toContain("Grupo");
    // arrastar A (clique seleciona o grupo inteiro) move B pelo mesmo delta
    await canvasClick();
    const a0 = await byTitle("A"), b0 = await byTitle("B");
    await dragBar("A", 90, 60);
    for (let i = 0; i < 30; i++) { const b = await byTitle("B"); if (b.geometry.x !== b0.geometry.x) break; await sleep(150); }
    const a1 = await byTitle("A"), b1 = await byTitle("B");
    expect(a1.geometry.x).not.toBe(a0.geometry.x);
    expect(b1.geometry.x - b0.geometry.x).toBe(a1.geometry.x - a0.geometry.x); expect(b1.geometry.y - b0.geometry.y).toBe(a1.geometry.y - a0.geometry.y);
    // renomear pelo rótulo
    await page.dblclick('[data-testid="ngroup-name"]');
    await page.fill('[data-testid="ngroup-rename"]', "Backend"); await page.keyboard.press("Enter");
    for (let i = 0; i < 20; i++) { if ((await snap()).groups[0]?.label === "Backend") break; await sleep(150); }
    expect((await snap()).groups[0]!.label).toBe("Backend");
    await page.waitForSelector('[data-testid="ngroup-name"]:has-text("Backend")');
    // desagrupar
    await page.locator('.react-flow__node-note:has-text("A") .bar .title').click();
    await page.keyboard.press("Control+Shift+G");
    await page.waitForSelector('[data-testid="ngroup"]', { state: "detached", timeout: 10_000 });
    s = await snap(); expect(s.groups).toHaveLength(0); expect(s.nodes.every((n) => !n.groupId)).toBe(true);
    // undo recria o grupo com o rótulo
    await canvasClick(); await page.keyboard.press("Control+z");
    await page.waitForSelector('[data-testid="ngroup-name"]:has-text("Backend")', { timeout: 10_000 });
    expect((await snap()).groups[0]!.label).toBe("Backend");
  }, 60_000);

  it("ímã ligado (tecla M): arrastar encaixa a borda esquerda de D na borda direita de C; desligado, fica onde soltou", async () => {
    const c = await byTitle("C"); const d0 = await byTitle("D"); // C: x 0..260; D começa em 520
    await canvasClick();
    expect(await page.getAttribute('[data-testid="snap-toggle"]', "class")).not.toContain("on");
    await page.keyboard.press("m"); // liga o encaixe
    await page.waitForFunction(() => document.querySelector('[data-testid="snap-toggle"]')!.className.includes("on"));
    const zoom = (await page.evaluate(() => { const m = /scale\(([-0-9.]+)\)/.exec((document.querySelector(".react-flow__viewport") as HTMLElement).style.transform); return m ? Number(m[1]) : 1; })) as number;
    const target = c.geometry.x + c.geometry.w + 2; // 2 unidades à direita da borda (+~2 de defasagem do arrasto): dentro do limiar (~6 no zoom atual)
    await dragBar("D", (target - d0.geometry.x) * zoom, 0);
    for (let i = 0; i < 30; i++) { const d = await byTitle("D"); if (d.geometry.x !== d0.geometry.x) break; await sleep(150); }
    const d1 = await byTitle("D");
    const dom = await page.evaluate((id) => (document.querySelector(`.react-flow__node[data-id="${id}"]`) as HTMLElement | null)?.style.transform ?? "?", d1.nodeId);
    expect(d1.geometry.x, `zoom=${zoom} alvo=${target} d0=${d0.geometry.x} d1=${d1.geometry.x} dom=${dom}`).toBe(c.geometry.x + c.geometry.w); // encaixou exatamente na borda
    await page.waitForSelector(".toast:has-text('Encaixe magnético ligado')", { state: "detached", timeout: 10_000 }).catch(() => {});
    // desliga pelo botão e arrasta 7 unidades: fica onde soltou (sem encaixar de volta)
    await page.click('[data-testid="snap-toggle"]');
    await page.waitForFunction(() => !document.querySelector('[data-testid="snap-toggle"]')!.className.includes("on"));
    const d2 = await byTitle("D");
    await dragBar("D", 7 * zoom, 0);
    for (let i = 0; i < 30; i++) { const d = await byTitle("D"); if (d.geometry.x !== d2.geometry.x) break; await sleep(150); }
    const d3 = await byTitle("D");
    expect(d3.geometry.x).not.toBe(c.geometry.x + c.geometry.w);
    expect(Math.abs(d3.geometry.x - (d2.geometry.x + 7))).toBeLessThanOrEqual(2);
    expect(JSON.parse(await page.evaluate(() => localStorage.getItem("mess.prefs") ?? "{}") as string)).toMatchObject({ snapMagnetic: false });
  }, 40_000);
});
