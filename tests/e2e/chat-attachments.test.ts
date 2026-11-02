import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// #79 — Anexos no chat como cards: abrir (viewer inline), arrastar pro canvas (vira nota) ou pra árvore (copia arquivo), e excluir.
const ROOT = join(import.meta.dirname, "../..");
const PORT = 48013;
let dataDir: string; let cwd: string; let runtime: ChildProcess; let app: ElectronApplication; let page: Page; let token: string; let WS: string; let termId: string;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const api = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : null });
  return r.status === 204 ? null : r.json();
};
type Snap = { workspace: { revision: number }; nodes: { nodeId: string; kind: string; title: string; content?: string }[] };
const snap = async () => (await api("GET", `/v1/workspaces/${WS}`)) as Snap;

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "mess-ca-"));
  cwd = join(dataDir, "proj"); mkdirSync(cwd, { recursive: true });
  runtime = spawn("node", [join(ROOT, "apps/runtime/dist/index.js")], { env: { ...process.env, MESS_DATA_DIR: dataDir, MESS_PORT: String(PORT), SHELL: "/bin/sh" }, stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { await sleep(250); try { token = readFileSync(join(dataDir, "runtime.token"), "utf8").trim(); up = (await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: { authorization: `Bearer ${token}` } })).ok; } catch { /* subindo */ } }
  if (!up) throw new Error(`runtime de teste não subiu na porta ${PORT}`);
  WS = ((await api("POST", "/v1/workspaces", { name: "ChatAtt", cwd })) as { workspaceId: string }).workspaceId;
  const t = (await api("POST", `/v1/workspaces/${WS}/nodes`, { expectedRevision: 0, kind: "terminal", title: "Agente", command: "cat", geometry: { x: 0, y: 0, w: 500, h: 360 } })) as { node: { nodeId: string } };
  termId = t.node.nodeId;
  await api("POST", `/v1/workspaces/${WS}/nodes`, { expectedRevision: 1, kind: "tree", title: "Arquivos", geometry: { x: 560, y: 0, w: 320, h: 320 } });
  const srcFile = join(dataDir, "nota-anexo.md");
  writeFileSync(srcFile, "# Guia Rápido\n\nConteúdo do anexo.\n");
  await api("POST", `/v1/nodes/${termId}/chat`, { text: "Aqui está o arquivo.", attachments: [{ path: srcFile, name: "nota-anexo.md" }] });
  app = await electron.launch({ args: ["."], cwd: join(ROOT, "apps/desktop"), env: { ...process.env, MESS_DATA_DIR: dataDir, MESS_PORT: String(PORT) } });
  page = await app.firstWindow();
  await page.waitForSelector(".side li.ws:has-text('ChatAtt')"); await page.click(".side li.ws:has-text('ChatAtt')");
  await page.waitForSelector('.react-flow__node:has-text("Agente")', { state: "attached" });
}, 60_000);
afterAll(async () => {
  await app?.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
  await app?.close().catch(() => {});
  try { runtime?.kill(); } catch { /* */ }
  for (let i = 0; i < 15 && runtime && runtime.exitCode === null; i++) await sleep(100);
  if (runtime && runtime.exitCode === null) { try { runtime.kill("SIGKILL"); } catch { /* */ } }
  rmSync(dataDir, { recursive: true, force: true });
});

describe("Chat: anexos como cards (#79)", () => {
  it("mostra o card no chat e abre a visualização ao clicar", async () => {
    const term = page.locator('.react-flow__node:has-text("Agente")').first();
    await term.click();
    await page.keyboard.press("Control+j");
    await page.waitForSelector('[data-testid="chat-att-card"]');
    expect(await page.locator('[data-testid="chat-att-card"]').innerText()).toContain("nota-anexo.md");
    await page.click('[data-testid="chat-att-open"]');
    await page.waitForSelector('[data-testid="chat-att-viewer"]');
    expect(await page.locator('[data-testid="chat-att-viewer"]').innerText()).toContain("Guia Rápido");
    await page.click('[data-testid="chat-att-viewer"] button:has-text("Fechar")');
    await page.waitForSelector('[data-testid="chat-att-viewer"]', { state: "detached" });
  });
  it("arrastar o card para o canvas cria uma nota; arrastar para a árvore salva o arquivo no espaço", async () => {
    await page.evaluate(() => {
      const card = document.querySelector('[data-testid="chat-att-card"]') as HTMLElement;
      const dt = new DataTransfer();
      card.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: dt }));
      const canvas = document.querySelector("main.canvas") as HTMLElement;
      canvas.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt, clientX: 400, clientY: 500 }));
      canvas.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt, clientX: 400, clientY: 500 }));
      const tree = document.querySelector('[data-testid="tree-body"]') as HTMLElement;
      tree.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
      tree.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
    });
    for (let i = 0; i < 30 && !(await snap()).nodes.some((n) => n.kind === "note"); i++) await sleep(150);
    const note = (await snap()).nodes.find((n) => n.kind === "note");
    expect(note?.content).toContain("Guia Rápido");
    for (let i = 0; i < 20 && !existsSync(join(cwd, "nota-anexo.md")); i++) await sleep(100);
    expect(readFileSync(join(cwd, "nota-anexo.md"), "utf8")).toContain("Conteúdo do anexo.");
  });
  it("excluir remove o card do chat", async () => {
    await page.click('[data-testid="chat-att-delete"]');
    await page.waitForSelector('[data-testid="chat-att-card"]', { state: "detached" });
  });
});
