import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// #67 — HUD flutuante do companheiro, com Electron real: segunda janela (#hud), cartão ao fim do turno
// de um agente falso, "Ir ao terminal" seleciona o nó na janela principal, toggle fecha e persiste.
const ROOT = join(import.meta.dirname, "../..");
const PORT = 47957;
let dataDir: string; let runtime: ChildProcess; let app: ElectronApplication; let page: Page; let token: string;
const H = () => ({ authorization: `Bearer ${token}`, "content-type": "application/json" });
const api = async (method: string, path: string, body?: unknown) => (await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: H(), body: body ? JSON.stringify(body) : null })).json();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hudPage = () => app.windows().find((w) => w.url().endsWith("#hud"));

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "mess-hud-"));
  writeFileSync(join(dataDir, "claude"), `#!/bin/sh\nread line\nsleep 0.2\necho "trabalhando no pedido: $line"\nsleep 0.1\necho "pronto: resultado-final-42"\nsleep 120\n`);
  chmodSync(join(dataDir, "claude"), 0o755);
  runtime = spawn("node", [join(ROOT, "apps/runtime/dist/index.js")], { env: { ...process.env, MESS_DATA_DIR: dataDir, MESS_PORT: String(PORT), SHELL: "/bin/sh", MESS_OLLAMA_URL: "http://127.0.0.1:1" }, stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { await sleep(250); try { token = readFileSync(join(dataDir, "runtime.token"), "utf8").trim(); up = (await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: H() })).ok; } catch { /* subindo */ } }
  if (!up) throw new Error(`runtime de teste não subiu na porta ${PORT}`);
  app = await electron.launch({ args: ["."], cwd: join(ROOT, "apps/desktop"), env: { ...process.env, MESS_DATA_DIR: dataDir, MESS_PORT: String(PORT) } });
  app.process().stdout?.on("data", (d: Buffer) => { for (const l of d.toString().split("\n")) if (l.trim()) mainLog.push(l); });
  app.process().stderr?.on("data", (d: Buffer) => { for (const l of d.toString().split("\n")) if (l.trim()) mainLog.push(`ERR ${l}`); });
  page = await app.firstWindow();
  await page.waitForSelector(".side h1");
}, 60_000);
const mainLog: string[] = [];

afterAll(async () => {
  // A janela principal intercepta o fechar (tela de encerramento), então `app.close()` penduraria: sai pelo processo principal.
  await app?.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
  await app?.close().catch(() => {});
  try { runtime?.kill(); } catch { /* */ }
  for (let i = 0; i < 15 && runtime && runtime.exitCode === null; i++) await sleep(100);
  if (runtime && runtime.exitCode === null) { try { runtime.kill("SIGKILL"); } catch { /* */ } }
  rmSync(dataDir, { recursive: true, force: true });
}, 30_000);

describe("HUD flutuante do companheiro (#67)", () => {
  it("toggle abre a segunda janela na rota #hud, vazia e com status do modelo local", async () => {
    expect(hudPage()).toBeUndefined();
    await page.click('[data-testid="hud-toggle"]');
    for (let i = 0; i < 40 && !hudPage(); i++) await sleep(250);
    const hud = hudPage(); expect(hud, "janela #hud não abriu").toBeTruthy();
    await hud!.waitForSelector('[data-testid="hud"]');
    await hud!.waitForSelector(".hud-empty");
    await hud!.waitForSelector(".hud-foot:has-text('sem modelo local')"); // Ollama na porta morta → degradação honesta
    expect(await page.getAttribute('[data-testid="hud-toggle"]', "class")).toContain("on");
    expect(await page.evaluate(() => localStorage.getItem("mess.hud"))).toBe("1");
  }, 30_000);

  it("agente conclui um turno → cartão com nome do nó, espaço e última tela; 'Ir ao terminal' seleciona o nó e dispensa", async () => {
    const ws = (await api("POST", "/v1/workspaces", { name: "HudWs", cwd: dataDir })) as { workspaceId: string };
    await page.waitForSelector(".side li.ws:has-text('HudWs')");
    const r = (await api("POST", `/v1/workspaces/${ws.workspaceId}/nodes`, { expectedRevision: 0, kind: "terminal", title: "Agente HUD", command: join(dataDir, "claude"), geometry: { x: 0, y: 0, w: 400, h: 300 } })) as { node: { nodeId: string }; session: { sessionId: string } };
    expect(r.session?.sessionId).toBeTruthy();
    await sleep(800);
    const sock = new WebSocket(`ws://127.0.0.1:${PORT}/v1/ws?token=${token}`);
    await new Promise<void>((res) => { sock.onopen = () => res(); });
    sock.send(JSON.stringify({ type: "attach", sessionId: r.session.sessionId }));
    sock.send(JSON.stringify({ type: "acquireLease", sessionId: r.session.sessionId }));
    sock.send(JSON.stringify({ type: "input", sessionId: r.session.sessionId, data: "faz o relatório\r" }));
    const hud = hudPage()!;
    const card = hud.locator('[data-testid="hud-card"]');
    await card.waitFor({ timeout: 15_000 }); // ~0,3 s de trabalho + 1,5 s de quiescência + rótulos
    await hud.waitForSelector('[data-testid="hud-card"] .t:has-text("Agente HUD")');
    await hud.waitForSelector('[data-testid="hud-card"] .m:has-text("HudWs")');
    expect(await card.locator(".hud-screen").textContent()).toContain("resultado-final-42");
    expect(await hud.locator(".hud-count").textContent()).toBe("1");
    sock.close();
    // Ir ao terminal: janela principal troca para o espaço e seleciona o nó; o cartão some do HUD.
    const logs: string[] = []; page.on("console", (m) => logs.push(`[main] ${m.text()}`)); hud.on("console", (m) => logs.push(`[hud] ${m.text()}`));
    // O espaço padrão ("cjunior") é o atual: HudWs NÃO está aberto — "Ir ao terminal" precisa trocar de espaço e selecionar.
    expect(await page.locator(".side li.ws.on").textContent()).not.toContain("HudWs");
    await card.locator("button:has-text('Ir ao terminal')").click();
    await page.waitForSelector(".side li.ws.on:has-text('HudWs')", { timeout: 10_000 });
    await page.waitForFunction((id) => document.querySelector(".react-flow__node.selected")?.getAttribute("data-id") === id, r.node.nodeId, { timeout: 10_000 }).catch(async (e) => {
      const info = await page.evaluate(() => ({ onFocus: typeof window.messai.onFocusNode, sel: document.querySelector(".react-flow__node.selected")?.getAttribute("data-id"), nodes: [...document.querySelectorAll(".react-flow__node")].map((n) => n.getAttribute("data-id")), ws: document.querySelector(".side li.ws.on")?.textContent }));
      const hinfo = await hud.evaluate(() => ({ hudFocus: typeof window.messai.hudFocus, cards: document.querySelectorAll('[data-testid="hud-card"]').length }));
      throw new Error(`nó não selecionado: ${JSON.stringify(info)} hud=${JSON.stringify(hinfo)} logs=${logs.slice(-10).join(" | ")} :: ${String(e).slice(0, 100)}`);
    });
    await card.waitFor({ state: "detached" });
    await hud.waitForSelector(".hud-empty");
  }, 40_000);

  it("toggle de novo fecha a janela e persiste a preferência desligada", async () => {
    await page.click('[data-testid="hud-toggle"]');
    for (let i = 0; i < 40 && hudPage(); i++) await sleep(250);
    expect(hudPage()).toBeUndefined();
    await page.waitForFunction(() => !document.querySelector('[data-testid="hud-toggle"]')!.className.includes("on"));
    expect(await page.evaluate(() => localStorage.getItem("mess.hud"))).toBe("0");
  }, 20_000);
});
