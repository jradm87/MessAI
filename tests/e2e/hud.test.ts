import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

// #67 — HUD flutuante do companheiro, com Electron real: segunda janela (#hud); agente falso conclui um turno →
// cartão com resumo + próximo passo (Ollama FALSO, determinístico); "Aplicar próximo passo" entrega ao agente;
// "Ir ao terminal" troca de espaço e seleciona o nó; toggle fecha e persiste; posição da janela é lembrada.
const ROOT = join(import.meta.dirname, "../..");
const PORT = 47957; const OLLAMA_PORT = 47958;
let dataDir: string; let runtime: ChildProcess; let ollama: Server; let app: ElectronApplication; let page: Page; let token: string;
const mainLog: string[] = [];
const H = () => ({ authorization: `Bearer ${token}`, "content-type": "application/json" });
const api = async (method: string, path: string, body?: unknown) => (await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: H(), body: body ? JSON.stringify(body) : null })).json();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hudPage = () => app.windows().find((w) => w.url().endsWith("#hud"));
const hudBounds = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith("#hud"))!.getBounds());

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "mess-hud-"));
  // Agente falso em loop: cada linha recebida vira um "turno" (trabalha, responde, assenta).
  writeFileSync(join(dataDir, "claude"), `#!/bin/sh\nwhile read line; do\n  sleep 0.2\n  echo "trabalhando no pedido: $line"\n  sleep 0.1\n  echo "pronto: resultado-final-42"\ndone\n`);
  chmodSync(join(dataDir, "claude"), 0o755);
  // Ollama falso: 1 modelo, resumo fixo — testa o caminho completo do #66/#67 sem depender de modelo real.
  ollama = createServer((req, res) => {
    req.on("data", () => {}); // descarta o corpo
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/api/tags") { res.end(JSON.stringify({ models: [{ name: "fake:1" }] })); return; }
      if (req.url === "/api/generate") { res.end(JSON.stringify({ response: JSON.stringify({ summary: "Relatório gerado com 3 seções", nextStep: "rodar os testes" }) })); return; }
      res.statusCode = 404; res.end("{}");
    });
  });
  await new Promise<void>((r) => ollama.listen(OLLAMA_PORT, "127.0.0.1", r));
  runtime = spawn("node", [join(ROOT, "apps/runtime/dist/index.js")], { env: { ...process.env, MESS_DATA_DIR: dataDir, MESS_PORT: String(PORT), SHELL: "/bin/sh", MESS_OLLAMA_URL: `http://127.0.0.1:${OLLAMA_PORT}` }, stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { await sleep(250); try { token = readFileSync(join(dataDir, "runtime.token"), "utf8").trim(); up = (await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: H() })).ok; } catch { /* subindo */ } }
  if (!up) throw new Error(`runtime de teste não subiu na porta ${PORT}`);
  app = await electron.launch({ args: ["."], cwd: join(ROOT, "apps/desktop"), env: { ...process.env, MESS_DATA_DIR: dataDir, MESS_PORT: String(PORT) } });
  app.process().stdout?.on("data", (d: Buffer) => { for (const l of d.toString().split("\n")) if (l.trim()) mainLog.push(l); });
  app.process().stderr?.on("data", (d: Buffer) => { for (const l of d.toString().split("\n")) if (l.trim() && !l.includes("Gtk-WARNING")) mainLog.push(`ERR ${l}`); });
  page = await app.firstWindow();
  await page.waitForSelector(".side h1");
}, 60_000);

afterAll(async () => {
  // A janela principal intercepta o fechar (tela de encerramento), então `app.close()` penduraria: sai pelo processo principal.
  await app?.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
  await app?.close().catch(() => {});
  try { runtime?.kill(); } catch { /* */ }
  for (let i = 0; i < 15 && runtime && runtime.exitCode === null; i++) await sleep(100);
  if (runtime && runtime.exitCode === null) { try { runtime.kill("SIGKILL"); } catch { /* */ } }
  await new Promise<void>((r) => (ollama ? ollama.close(() => r()) : r()));
  rmSync(dataDir, { recursive: true, force: true });
}, 30_000);

describe("HUD flutuante do companheiro (#67)", () => {
  it("toggle abre a segunda janela na rota #hud, vazia e com o modelo local no rodapé", async () => {
    expect(hudPage()).toBeUndefined();
    await page.click('[data-testid="hud-toggle"]');
    for (let i = 0; i < 40 && !hudPage(); i++) await sleep(250);
    const hud = hudPage(); expect(hud, "janela #hud não abriu").toBeTruthy();
    await hud!.waitForSelector('[data-testid="hud"]');
    await hud!.waitForSelector(".hud-empty");
    await hud!.waitForSelector(".hud-foot:has-text('modelo local: fake:1')");
    expect(await page.getAttribute('[data-testid="hud-toggle"]', "class")).toContain("on");
    expect(await page.evaluate(() => localStorage.getItem("mess.hud"))).toBe("1");
  }, 30_000);

  it("turno concluído → cartão com nome/espaço/resumo/próximo passo; Aplicar entrega ao agente; Ir ao terminal troca de espaço e seleciona", async () => {
    const ws = (await api("POST", "/v1/workspaces", { name: "HudWs", cwd: dataDir })) as { workspaceId: string };
    await page.waitForSelector(".side li.ws:has-text('HudWs')");
    const r = (await api("POST", `/v1/workspaces/${ws.workspaceId}/nodes`, { expectedRevision: 0, kind: "terminal", title: "Agente HUD", command: join(dataDir, "claude"), geometry: { x: 0, y: 0, w: 400, h: 300 } })) as { node: { nodeId: string }; session: { sessionId: string } };
    expect(r.session?.sessionId).toBeTruthy();
    await sleep(800);
    type Ev = { type: string; event?: { nodeId: string; screen: string } };
    const events: Ev[] = [];
    const sock = new WebSocket(`ws://127.0.0.1:${PORT}/v1/ws?token=${token}`);
    await new Promise<void>((res) => { sock.onopen = () => res(); });
    sock.onmessage = (e) => { events.push(JSON.parse(e.data as string) as Ev); };
    sock.send(JSON.stringify({ type: "subscribe", workspaceId: ws.workspaceId }));
    sock.send(JSON.stringify({ type: "acquireLease", sessionId: r.session.sessionId }));
    sock.send(JSON.stringify({ type: "input", sessionId: r.session.sessionId, data: "faz o relatório\r" }));
    sock.send(JSON.stringify({ type: "releaseLease", sessionId: r.session.sessionId }));
    const hud = hudPage()!;
    const card = hud.locator('[data-testid="hud-card"]');
    try {
      await card.waitFor({ timeout: 15_000 }); // ~0,3 s de trabalho + 1,5 s de quiescência
      await hud.waitForSelector('[data-testid="hud-card"] .t:has-text("Agente HUD")');
      await hud.waitForSelector('[data-testid="hud-card"] .m:has-text("HudWs")');
      await hud.waitForSelector('[data-testid="hud-card"].done .hud-sum:has-text("Relatório gerado")', { timeout: 10_000 }); // Ollama falso respondeu
      await hud.waitForSelector('[data-testid="hud-card"] .hud-next:has-text("rodar os testes")');
      expect(await hud.locator(".hud-count").textContent()).toBe("1");
      // Aplicar próximo passo: o agente recebe "rodar os testes" como input e abre um novo turno.
      const finishedBefore = events.filter((e) => e.type === "taskFinished").length;
      await hud.locator('[data-testid="hud-apply"]').click();
      await card.waitFor({ state: "detached" });
      let second: Ev | undefined;
      for (let i = 0; i < 60 && !second; i++) { await sleep(250); second = events.filter((e) => e.type === "taskFinished").slice(finishedBefore).find((e) => e.event?.screen.includes("trabalhando no pedido: rodar os testes")); }
      expect(second, `agente não recebeu o próximo passo; taskFinished vistos: ${events.filter((e) => e.type === "taskFinished").length}`).toBeTruthy();
      // O novo turno vira um novo cartão. Ir ao terminal: o espaço atual é o padrão ("cjunior"), então precisa trocar.
      await card.waitFor({ timeout: 10_000 });
      expect(await page.locator(".side li.ws.on").textContent()).not.toContain("HudWs");
      await card.locator("button:has-text('Ir ao terminal')").click();
      await page.waitForSelector(".side li.ws.on:has-text('HudWs')", { timeout: 10_000 });
      await page.waitForFunction((id) => document.querySelector(".react-flow__node.selected")?.getAttribute("data-id") === id, r.node.nodeId, { timeout: 10_000 }).catch(async (e) => {
        const info = await page.evaluate(() => ({ sel: document.querySelector(".react-flow__node.selected")?.getAttribute("data-id"), nodes: [...document.querySelectorAll(".react-flow__node")].map((n) => n.getAttribute("data-id")) }));
        throw new Error(`nó não selecionado: ${JSON.stringify(info)} mainLog=${mainLog.slice(-8).join(" | ")} :: ${String(e).slice(0, 100)}`);
      });
      await card.waitFor({ state: "detached" });
      await hud.waitForSelector(".hud-empty");
    } finally { sock.close(); }
  }, 60_000);

  it("mover a janela persiste a posição; toggle fecha e persiste desligado; reabrir restaura a posição", async () => {
    const before = await hudBounds();
    await app.evaluate(({ BrowserWindow }, b) => { BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith("#hud"))!.setBounds({ ...b, x: b.x - 120, y: b.y - 80 }); }, before);
    // O gerenciador de janelas (X11) pode ajustar alguns px por causa das bordas/decoração: tolerância, não igualdade.
    const near = (a: number, b: number) => Math.abs(a - b) <= 16;
    const file = join(dataDir, "hud.json");
    let saved: { x: number; y: number } | null = null;
    for (let i = 0; i < 30 && !saved; i++) { await sleep(150); if (existsSync(file)) { const j = JSON.parse(readFileSync(file, "utf8")) as { x: number; y: number }; if (near(j.x, before.x - 120) && near(j.y, before.y - 80)) saved = j; } }
    if (!saved) { const actual = await hudBounds(); throw new Error(`hud.json não gravou a nova posição (esperado ~x=${before.x - 120},y=${before.y - 80}); bounds reais=${JSON.stringify(actual)} arquivo=${existsSync(file) ? readFileSync(file, "utf8") : "(não existe)"}`); }
    await page.click('[data-testid="hud-toggle"]');
    for (let i = 0; i < 40 && hudPage(); i++) await sleep(250);
    expect(hudPage()).toBeUndefined();
    await page.waitForFunction(() => !document.querySelector('[data-testid="hud-toggle"]')!.className.includes("on"));
    expect(await page.evaluate(() => localStorage.getItem("mess.hud"))).toBe("0");
    await page.click('[data-testid="hud-toggle"]');
    for (let i = 0; i < 40 && !hudPage(); i++) await sleep(250);
    await hudPage()!.waitForSelector('[data-testid="hud"]');
    const again = await hudBounds();
    expect(near(again.x, saved.x), `reabriu em x=${again.x}, salvo x=${saved.x}`).toBe(true); expect(near(again.y, saved.y), `reabriu em y=${again.y}, salvo y=${saved.y}`).toBe(true);
  }, 30_000);
});
