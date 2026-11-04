import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// #26 — portal no canvas, com Electron real: abrir pelo botão da barra, endereço, quadros reais (pixels), clique/teclado/rolagem do usuário,
// uma ação do AGENTE (API) refletida na tela, modo design (inspecionar + enviar a um agente conectado), fechar o navegador.
const ROOT = join(import.meta.dirname, "../..");
const PORT = 48041; const PAGES = 48042;
let dataDir: string; let runtime: ChildProcess; let app: ElectronApplication; let page: Page; let token: string; let WS: string; let pages: Server;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const api = async (method: string, path: string, body?: unknown) => { const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : null }); const t = await r.text(); return t ? JSON.parse(t) : null; };
const hasBrowser = (() => { for (const b of ["google-chrome-stable", "google-chrome", "chromium", "chromium-browser", "brave-browser"]) { try { execFileSync("which", [b], { stdio: "ignore" }); return true; } catch { /* próximo */ } } return false; })();
type Snap = { workspace: { revision: number }; nodes: { nodeId: string; kind: string; title: string; content?: string }[] };
const portalId = async () => ((await api("GET", `/v1/workspaces/${WS}`)) as Snap).nodes.find((n) => n.kind === "portal")!.nodeId;
type El = { ref: number; tag: string; name: string; rect: { x: number; y: number; w: number; h: number } };
/** posição na TELA de um ponto da página (coordenadas CSS do viewport do portal) */
const toScreen = async (px: number, py: number) => {
  const id = await portalId(); const st = (await api("GET", `/v1/portals/${id}`)) as { width: number; height: number };
  const box = (await page.locator('[data-testid="portal-img"]').boundingBox())!;
  return { x: box.x + px * (box.width / st.width), y: box.y + py * (box.height / st.height) };
};
const el = async (tag: string) => { const id = await portalId(); const s = (await api("GET", `/v1/portals/${id}/snapshot`)) as { elements: El[] }; return s.elements.find((e) => e.tag === tag)!; };
const state = async () => (await api("GET", `/v1/portals/${await portalId()}`)) as { status: string; url: string; title: string; canGoBack: boolean };

const waitUrl = async (label: string, ok: (u: string) => boolean, ms = 15_000) => {
  const t = Date.now(); let ui = ""; let ap = "";
  while (Date.now() - t < ms) { ui = await page.inputValue('[data-testid="portal-url"]'); ap = (await state()).url; if (ok(ui)) return; await sleep(150); }
  throw new Error(`${label}: campo='${ui}' api='${ap}'`);
};

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "mess-portal-e2e-"));
  pages = createServer((req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8"); const u = req.url ?? "/";
    if (u.startsWith("/page2")) return res.end(`<title>Dois</title><body style="margin:0;background:#00aa00"><h1>Página dois</h1>`);
    if (u.startsWith("/search")) return res.end(`<title>Busca</title><p>q=${new URL(u, "http://x").searchParams.get("q")}</p>`);
    res.end(`<title>Casa</title><body style="margin:0"><div id=red style="width:240px;height:100px;background:#ff0000"></div><h1 style="margin:10px">Olá portal</h1><a href="/page2" style="display:block;margin:10px">ir para dois</a><form action="/search"><input name=q style="margin:10px;width:200px"></form><div style="height:3000px">fim</div>`);
  });
  await new Promise<void>((r) => pages.listen(PAGES, "127.0.0.1", r));
  runtime = spawn("node", [join(ROOT, "apps/runtime/dist/index.js")], { env: { ...process.env, MESS_DATA_DIR: dataDir, MESS_PORT: String(PORT), SHELL: "/bin/sh" }, stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { await sleep(250); try { token = readFileSync(join(dataDir, "runtime.token"), "utf8").trim(); up = (await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: { authorization: `Bearer ${token}` } })).ok; } catch { /* subindo */ } }
  if (!up) throw new Error(`runtime de teste não subiu na porta ${PORT}`);
  app = await electron.launch({ args: ["."], cwd: join(ROOT, "apps/desktop"), env: { ...process.env, MESS_DATA_DIR: dataDir, MESS_PORT: String(PORT) } });
  page = await app.firstWindow();
  await page.waitForSelector(".side h1");
  WS = ((await api("POST", "/v1/workspaces", { name: "Web", cwd: dataDir })) as { workspaceId: string }).workspaceId;
  await page.waitForSelector(".side li.ws:has-text('Web')");
  await page.click(".side li.ws:has-text('Web')");
  await page.waitForSelector(".side li.ws.on:has-text('Web')");
}, 60_000);

afterAll(async () => {
  await app?.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
  await app?.close().catch(() => {});
  try { runtime?.kill(); } catch { /* */ }
  for (let i = 0; i < 15 && runtime && runtime.exitCode === null; i++) await sleep(100);
  if (runtime && runtime.exitCode === null) { try { runtime.kill("SIGKILL"); } catch { /* */ } }
  pages?.close(); rmSync(dataDir, { recursive: true, force: true });
}, 30_000);

describe.skipIf(!hasBrowser)("portal na interface (#26)", () => {
  it("botão da barra cria o portal PARADO (não sobe navegador sozinho); endereço + Enter abre e mostra a página de verdade (pixels)", async () => {
    await page.click('[data-testid="tool-portal"]');
    await page.waitForSelector('.node.portal [data-testid="portal-idle"]');
    expect((await state()).status).toBe("stopped"); // criar não abre navegador
    await page.fill('[data-testid="portal-url"]', `127.0.0.1:${PAGES}/`); await page.press('[data-testid="portal-url"]', "Enter");
    await page.waitForSelector('[data-testid="portal-status"][data-status="running"]', { timeout: 20_000 });
    await page.waitForFunction(() => (document.querySelector('[data-testid="portal-img"]') as HTMLImageElement | null)?.src.startsWith("data:image/jpeg"), undefined, { timeout: 20_000 });
    await page.waitForFunction(() => (document.querySelector('[data-testid="portal-url"]') as HTMLInputElement).value.includes("/"), undefined, { timeout: 10_000 });
    expect((await state()).title).toBe("Casa");
    // o quadro mostra o bloco vermelho no canto superior esquerdo (lê o pixel do <img> desenhado num canvas)
    const px = await page.waitForFunction(() => {
      const im = document.querySelector('[data-testid="portal-img"]') as HTMLImageElement; if (!im.naturalWidth) return null;
      const c = document.createElement("canvas"); c.width = im.naturalWidth; c.height = im.naturalHeight; const g = c.getContext("2d")!; g.drawImage(im, 0, 0);
      const d = g.getImageData(Math.round(im.naturalWidth * (60 / im.naturalWidth)), 40, 1, 1).data; return d[0]! > 200 && d[1]! < 60 && d[2]! < 60 ? "vermelho" : null;
    }, undefined, { timeout: 15_000 });
    expect(await px.jsonValue()).toBe("vermelho");
    expect(await page.inputValue('[data-testid="portal-url"]')).toBe(`http://127.0.0.1:${PAGES}/`);
    if (process.env["SHOT"]) await page.screenshot({ path: "/tmp/portal.png" });
  }, 60_000);

  it("clique do usuário no link navega; teclado digita no campo; voltar pela barra; rolagem com a roda", async () => {
    const link = await el("a"); const pt = await toScreen(link.rect.x + link.rect.w / 2, link.rect.y + link.rect.h / 2);
    await page.mouse.click(pt.x, pt.y);
    await waitUrl("depois do clique no link", (u) => u.endsWith("/page2"));
    for (let i = 0; i < 40 && (await state()).title !== "Dois"; i++) await sleep(150); // o título do documento chega depois da URL
    expect((await state()).title).toBe("Dois"); expect((await state()).canGoBack).toBe(true);
    await page.click('[data-testid="portal-back"]');
    await waitUrl("depois de voltar", (u) => u.endsWith(":48042/"));
    const input = await el("input"); const ip = await toScreen(input.rect.x + 20, input.rect.y + input.rect.h / 2);
    await page.mouse.click(ip.x, ip.y); await page.keyboard.type("ola mundo", { delay: 15 });
    const id = await portalId();
    await page.waitForFunction(async ([pid, tk, port]) => { const r = await fetch(`http://127.0.0.1:${port}/v1/portals/${pid}/act`, { method: "POST", headers: { authorization: `Bearer ${tk}`, "content-type": "application/json" }, body: JSON.stringify({ action: "eval", expression: "document.querySelector('input').value" }) }); return (await r.json()).value === "ola mundo"; }, [id, token, PORT] as const, { timeout: 10_000 });
    await page.keyboard.press("Enter");
    await waitUrl("depois do Enter no campo", (u) => u.includes("/search?q=ola+mundo"));
    await page.click('[data-testid="portal-back"]'); await sleep(800);
    const box = (await page.locator('[data-testid="portal-img"]').boundingBox())!; await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.wheel(0, 500);
    await page.waitForFunction(async ([pid, tk, port]) => { const r = await fetch(`http://127.0.0.1:${port}/v1/portals/${pid}/act`, { method: "POST", headers: { authorization: `Bearer ${tk}`, "content-type": "application/json" }, body: JSON.stringify({ action: "eval", expression: "window.scrollY" }) }); return (await r.json()).value > 50; }, [id, token, PORT] as const, { timeout: 10_000 });
  }, 90_000);

  it("ação do AGENTE (API) aparece na tela: navegar para a página verde muda URL e quadro", async () => {
    const id = await portalId();
    await api("POST", `/v1/portals/${id}/act`, { action: "navigate", url: `http://127.0.0.1:${PAGES}/page2` });
    await page.waitForFunction(() => (document.querySelector('[data-testid="portal-url"]') as HTMLInputElement).value.endsWith("/page2"), undefined, { timeout: 10_000 });
    const green = await page.waitForFunction(() => {
      const im = document.querySelector('[data-testid="portal-img"]') as HTMLImageElement; if (!im.naturalWidth) return null;
      const c = document.createElement("canvas"); c.width = im.naturalWidth; c.height = im.naturalHeight; const g = c.getContext("2d")!; g.drawImage(im, 0, 0);
      const d = g.getImageData(im.naturalWidth - 20, im.naturalHeight - 20, 1, 1).data; return d[1]! > 140 && d[0]! < 60 ? "verde" : null;
    }, undefined, { timeout: 15_000 });
    expect(await green.jsonValue()).toBe("verde");
  }, 40_000);

  it("modo design: clicar no título inspeciona o elemento; ligado a um terminal, 'Enviar' entrega o seletor ao agente", async () => {
    await api("POST", `/v1/portals/${await portalId()}/act`, { action: "navigate", url: `http://127.0.0.1:${PAGES}/` });
    await page.waitForFunction(() => (document.querySelector('[data-testid="portal-url"]') as HTMLInputElement).value.endsWith(`:${48042}/`), undefined, { timeout: 10_000 });
    // terminal conectado ao portal
    const snap = (await api("GET", `/v1/workspaces/${WS}`)) as Snap;
    const t = await api("POST", `/v1/workspaces/${WS}/nodes`, { expectedRevision: snap.workspace.revision, kind: "terminal", title: "Agente", command: "/bin/cat", geometry: { x: 700, y: 20, w: 400, h: 300 } }) as { node: { nodeId: string } };
    const s2 = (await api("GET", `/v1/workspaces/${WS}`)) as Snap;
    await api("POST", `/v1/workspaces/${WS}/connections`, { expectedRevision: s2.workspace.revision, sourceNodeId: await portalId(), targetNodeId: t.node.nodeId });
    await page.click('[data-testid="portal-design"]');
    const h1 = await el("h1").catch(() => null);
    const id = await portalId(); const insp = (await api("POST", `/v1/portals/${id}/act`, { action: "inspect", x: 40, y: 125 })) as { value: { tag: string } | null }; // h1 fica logo abaixo do bloco vermelho (100px) + margem
    void h1; expect(insp.value?.tag).toBe("h1");
    const p = await toScreen(40, 125); await page.mouse.click(p.x, p.y);
    await page.waitForSelector('[data-testid="portal-pick"]');
    expect(await page.textContent('[data-testid="portal-pick-selector"]')).toContain("h1");
    if (process.env["SHOT"]) await page.screenshot({ path: "/tmp/portal-design.png" });
    await page.click('[data-testid="portal-send"]:has-text("Agente")');
    await page.waitForSelector(".toast:has-text('Enviado ao agente')", { timeout: 10_000 });
    const chat = (await api("GET", `/v1/nodes/${t.node.nodeId}/chat`)) as { text: string }[];
    expect(chat.some((m) => m.text.includes("Elemento selecionado no portal") && m.text.includes("h1"))).toBe(true);
    await page.click('[data-testid="portal-design"]'); // desliga
  }, 60_000);

  it("fechar o navegador libera o portal (idle de novo, URL salva); reabrir volta na mesma página", async () => {
    await page.click('[data-testid="portal-stop"]');
    await page.waitForSelector('[data-testid="portal-idle"]');
    await page.waitForFunction(async ([pid, tk, port]) => { const r = await fetch(`http://127.0.0.1:${port}/v1/portals/${pid}`, { headers: { authorization: `Bearer ${tk}` } }); return (await r.json()).status === "stopped"; }, [await portalId(), token, PORT] as const, { timeout: 10_000 });
    expect(await page.inputValue('[data-testid="portal-url"]')).toContain(`:${PAGES}/`);
    await page.click('[data-testid="portal-start"]');
    await page.waitForSelector('[data-testid="portal-status"][data-status="running"]', { timeout: 20_000 });
    expect((await state()).title).toBe("Casa");
  }, 60_000);
});
