import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const PORT = 47955;
let dataDir: string; let runtime: ChildProcess; let app: ElectronApplication; let page: Page; let token: string;
const api = async (path: string) => (await fetch(`http://127.0.0.1:${PORT}${path}`, { headers: { authorization: `Bearer ${token}` } })).json();

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "messy-e2e-"));
  runtime = spawn("node", [join(ROOT, "apps/runtime/dist/index.js")], { env: { ...process.env, MESSY_DATA_DIR: dataDir, MESSY_PORT: String(PORT), SHELL: "/bin/sh" }, stdio: "inherit" });
  for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 250)); try { token = readFileSync(join(dataDir, "runtime.token"), "utf8").trim(); if ((await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: { authorization: `Bearer ${token}` } })).ok) break; } catch { /* ainda subindo */ } }
  app = await electron.launch({ args: ["."], cwd: join(ROOT, "apps/desktop"), env: { ...process.env, MESSY_DATA_DIR: dataDir, MESSY_PORT: String(PORT) } });
  page = await app.firstWindow();
  await page.waitForSelector(".side h1");
}, 60_000);

afterAll(async () => { await app?.close(); runtime?.kill(); rmSync(dataDir, { recursive: true, force: true }); });

async function visibleSpot(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const main = document.querySelector("main.canvas")!.getBoundingClientRect();
    const vp = (document.querySelector(".react-flow__viewport") as HTMLElement).style.transform;
    const m = /translate\(([-0-9.]+)px,\s*([-0-9.]+)px\)\s*scale\(([-0-9.]+)\)/.exec(vp)!;
    const tx = +m[1], ty = +m[2], s = +m[3];
    const sx = main.width / 2, sy = main.height / 2;
    return { x: (sx - tx) / s - 180, y: (sy - ty) / s - 110 };
  });
}



describe("piloto local", () => {
  it("cria espaço pela UI", async () => {
    await page.click('[data-testid="ws-new"]');
    await page.waitForSelector('[data-testid="ws-dialog"]');
    await page.fill('[data-testid="ws-name"]', "E2E");
    await page.fill('[data-testid="ws-cwd"]', dataDir);
    await page.click('.icon-grid .ig[title="rocket"]');
    await page.click('.color-row .sw[title="#5aa9ff"]');
    await page.click('[data-testid="ws-submit"]');
    await page.waitForSelector(".side li.ws.on:has-text('E2E')");
    const list = await api("/v1/workspaces") as { icon: string; color: string }[];
    expect(list.length).toBe(1);
    expect(list[0]!.icon).toBe("rocket"); expect(list[0]!.color).toBe("#5aa9ff");
  });

  it("adiciona shell e nota pelo menu, sem sobreposição", async () => {
    await page.click('[data-testid="add"]'); await page.hover(".menu .mi:has-text('Terminal')"); await page.click(".menu.sub .mi:has-text('Shell')");
    await page.waitForSelector(".node.terminal .st.running", { timeout: 10_000 });
    await page.click('[data-testid="add"]'); await page.click(".menu .mi:has-text('Nota')");
    await page.waitForSelector(".node.note");
    const [ws] = await api("/v1/workspaces") as { workspaceId: string }[];
    const snap = await api(`/v1/workspaces/${ws!.workspaceId}`) as { nodes: { kind: string; geometry: { x: number; w: number } }[] };
    const t = snap.nodes.find((n) => n.kind === "terminal")!, n = snap.nodes.find((n) => n.kind === "note")!;
    expect(n.geometry.x).toBeGreaterThanOrEqual(t.geometry.x + t.geometry.w);
  });

  it("arrasta a nota pela barra e persiste a posição", async () => {
    const [ws] = await api("/v1/workspaces") as { workspaceId: string }[];
    const before = (await api(`/v1/workspaces/${ws!.workspaceId}`) as { nodes: { kind: string; geometry: { x: number; y: number } }[] }).nodes.find((n) => n.kind === "note")!.geometry;
    await page.waitForTimeout(500);
    const bar = page.locator(".node.note .bar .title");
    const b = (await bar.boundingBox())!;
    await page.mouse.move(b.x + 5, b.y + 5); await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(b.x + 5 - i * 12, b.y + 5 + i * 15);
    await page.mouse.up();
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(ROOT, "tests/e2e/last.png") });
    const after = (await api(`/v1/workspaces/${ws!.workspaceId}`) as { nodes: { kind: string; geometry: { x: number; y: number } }[] }).nodes.find((n) => n.kind === "note")!.geometry;
    expect(after.x).toBeLessThan(before.x); expect(after.y).toBeGreaterThan(before.y);
    await page.screenshot({ path: join(ROOT, "tests/e2e/last.png") });
  });

  it("fechar o cliente não mata o shell", async () => {
    const [s] = await api("/v1/sessions/" + ((await api("/v1/workspaces/" + ((await api("/v1/workspaces")) as { workspaceId: string }[])[0]!.workspaceId)) as { nodes: { sessionId?: string }[] }).nodes.find((n) => n.sessionId)!.sessionId).then((x) => [x as { pid: number; state: string }]);
    await app.close();
    await new Promise((r) => setTimeout(r, 500));
    expect(() => process.kill(s!.pid, 0)).not.toThrow();
    app = await electron.launch({ args: ["."], cwd: join(ROOT, "apps/desktop"), env: { ...process.env, MESSY_DATA_DIR: dataDir, MESSY_PORT: String(PORT) } });
    page = await app.firstWindow();
    await page.waitForSelector(".node.terminal .st.running", { timeout: 10_000 });
  });
});

describe("conexões e rename", () => {
  it("liga nota ao terminal pelos handles e persiste", async () => {
    const [ws] = await api("/v1/workspaces") as { workspaceId: string }[];
    const src = page.locator(".react-flow__node-note .react-flow__handle.source").first();
    const dst = page.locator(".react-flow__node-terminal .react-flow__handle.target").first();
    const count = async () => ((await api(`/v1/workspaces/${ws!.workspaceId}`)) as { connections: unknown[] }).connections.length;
    for (let attempt = 0; attempt < 6 && (await count()) === 0; attempt++) {
      await page.waitForTimeout(300);
      const a = (await src.boundingBox())!, b = (await dst.boundingBox())!;
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 }); await page.waitForTimeout(150); await page.mouse.up();
      await page.waitForTimeout(700);
    }
    expect(await count()).toBe(1);
    await page.waitForSelector(".react-flow__edge", { timeout: 5000 });
  }, 20_000);
  it("renomeia a nota por duplo clique", async () => {
    const [ws] = await api("/v1/workspaces") as { workspaceId: string }[];
    await page.dblclick(".node.note .bar .title");
    await page.fill(".node.note .title-edit", "Minha nota"); await page.keyboard.press("Enter");
    await page.waitForSelector(".node.note .bar .title:has-text('Minha nota')");
    const snap = await api(`/v1/workspaces/${ws!.workspaceId}`) as { nodes: { kind: string; title: string }[] };
    expect(snap.nodes.find((n) => n.kind === "note")!.title).toBe("Minha nota");
  });
});

describe("ferramentas do canvas", () => {
  beforeEach(async () => { await page.keyboard.press("Escape"); await page.waitForTimeout(250); });
  it("tecla T + arrastar cria terminal com o tamanho desenhado (via diálogo)", async () => {
    const [ws] = await api("/v1/workspaces") as { workspaceId: string }[];
    await page.mouse.click(700, 60); // tira foco de inputs/terminal
    await page.keyboard.press("Escape"); await page.keyboard.press("t");
    await page.waitForSelector(".capture.terminal");
    const pane = (await page.locator("main.canvas").boundingBox())!;
    const x0 = pane.x + pane.width - 420, y0 = pane.y + pane.height - 320; // canto inferior direito livre
    await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move(x0 + 300, y0 + 200, { steps: 6 }); await page.mouse.up();
    await page.waitForSelector(".modal");
    await page.click(".qs:has-text('Shell')"); await page.click(".actions .pri");
    await page.waitForSelector(".node.terminal .st.running >> nth=1", { timeout: 10_000 });
    const snap = await api(`/v1/workspaces/${ws!.workspaceId}`) as { nodes: { kind: string; geometry: { w: number; h: number } }[] };
    const terms = snap.nodes.filter((n) => n.kind === "terminal");
    const last = terms[terms.length - 1]!;
    // zoom pode não ser 1: o retângulo desenhado tem proporção 3:2
    expect(Math.abs(last.geometry.w / last.geometry.h - 1.5)).toBeLessThan(0.15);
  });

  it("tecla B + arrastar desenha um traço persistido; borracha apaga", async () => {
    const [ws] = await api("/v1/workspaces") as { workspaceId: string }[];
    await page.mouse.click(700, 60); await page.keyboard.press("Escape"); await page.keyboard.press("b");
    await page.waitForSelector(".tools.sub");
    const pane = (await page.locator("main.canvas").boundingBox())!;
    const x0 = pane.x + 300, y0 = pane.y + 120;
    await page.mouse.move(x0, y0); await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(x0 + i * 10, y0 + Math.sin(i / 2) * 20);
    await page.mouse.up();
    await page.waitForTimeout(500);
    let snap = await api(`/v1/workspaces/${ws!.workspaceId}`) as { drawings: { kind: string; points: number[][] }[] };
    expect(snap.drawings.length).toBe(1); expect(snap.drawings[0]!.kind).toBe("pen"); expect(snap.drawings[0]!.points.length).toBeGreaterThan(3);
    await page.click(".tools.sub .tb[title='Borracha']");
    await page.waitForTimeout(150);
    const box = (await page.locator(".drawings path").first().boundingBox())!;
    // o traço começa em (x0, y0); clique real sobre ele
    await page.mouse.click(x0 + 1, y0 + 1);
    await page.waitForTimeout(500);
    void box;
    snap = await api(`/v1/workspaces/${ws!.workspaceId}`) as { drawings: unknown[] };
    expect(snap.drawings.length).toBe(0);
    await page.keyboard.press("Escape");
  });

  it("pastas: cria, move espaço para dentro, recolhe e filtra", async () => {
    const token = readFileSync(join(dataDir, "runtime.token"), "utf8").trim();
    const post = (path: string, body: unknown, method = "POST") => fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
    const folder = await post("/v1/folders", { name: "Clientes" }) as { folderId: string };
    const second = await post("/v1/workspaces", { name: "Outro", cwd: dataDir, icon: "bug", color: "#ef5350", folderId: folder.folderId }) as { workspaceId: string };
    await page.waitForSelector(".side li.fld:has-text('Clientes')");
    await page.waitForSelector(".side li.ws:has-text('Outro')");
    // recolher a pasta esconde o espaço
    await page.click(".side li.fld:has-text('Clientes')");
    await page.waitForSelector(".side li.ws:has-text('Outro')", { state: "detached" });
    // filtro reabre e mostra só o que casa
    await page.fill('[data-testid="ws-filter"]', "out");
    await page.waitForSelector(".side li.ws:has-text('Outro')");
    expect(await page.locator(".side li.ws:has-text('E2E')").count()).toBe(0);
    await page.fill('[data-testid="ws-filter"]', "");
    // contagem de terminais do espaço E2E aparece (tem um shell vivo)
    await page.waitForSelector(".side li.ws:has-text('E2E') .cnt");
    // tirar da pasta pelo menu de contexto
    await page.click(".side li.fld:has-text('Clientes')"); // reabre
    await page.click(".side li.ws:has-text('Outro')", { button: "right" });
    await page.click(".menu .mi:has-text('Tirar da pasta')");
    for (let i = 0; i < 20; i++) { const w = (await api("/v1/workspaces") as { workspaceId: string; folderId?: string }[]).find((x) => x.workspaceId === second.workspaceId)!; if (!w.folderId) break; await new Promise((r) => setTimeout(r, 200)); }
    const w = (await api("/v1/workspaces") as { workspaceId: string; folderId?: string }[]).find((x) => x.workspaceId === second.workspaceId)!;
    expect(w.folderId).toBeUndefined();
    // apagar pasta
    await post(`/v1/folders/${folder.folderId}`, {}, "DELETE").catch(() => {});
    await page.waitForSelector(".side li.fld:has-text('Clientes')", { state: "detached" });
  });

  it("barra contextual e atalhos: Ctrl+L conecta, Ctrl+Tab alterna, atenção com Ctrl+Shift+A, Ctrl+↓ troca espaço", async () => {
    const wsList = await api("/v1/workspaces") as { workspaceId: string; name: string }[];
    const e2e = wsList.find((w) => w.name === "E2E")!;
    await page.click(".side li.ws:has-text('E2E')");
    await page.waitForSelector(".node.terminal", { state: "attached" });
    const token = readFileSync(join(dataDir, "runtime.token"), "utf8").trim();
    const snap0 = (await api(`/v1/workspaces/${e2e.workspaceId}`)) as { connections: unknown[]; workspace: { revision: number } };
    const before = snap0.connections.length;
    // segunda nota em lugar livre, longe do terminal
    await fetch(`http://127.0.0.1:${PORT}/v1/workspaces/${e2e.workspaceId}/nodes`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: snap0.workspace.revision, kind: "note", title: "Nota B", geometry: { x: -600, y: 900, w: 260, h: 160 } }) });
    await page.waitForSelector(".node.note:has-text('Nota B')");
    await page.click("main.canvas .react-flow__pane", { position: { x: 30, y: 500 } }); // limpa seleção
    await page.keyboard.press("Control+\\"); await page.waitForTimeout(500);
    const last = page.locator(".react-flow__node-note", { hasText: "Nota B" });
    try { await last.locator(".bar").click({ timeout: 5000 }); }
    catch (e) {
      const b1 = await last.boundingBox(); await page.waitForTimeout(300); const b2 = await last.boundingBox();
      const info = await page.evaluate(() => ({ vp: (document.querySelector(".react-flow__viewport") as HTMLElement)?.style.transform, active: `${document.activeElement?.tagName}.${(document.activeElement as HTMLElement)?.className?.toString?.().slice(0, 40)}`, ws: document.querySelector(".side li.ws.on")?.textContent, info: document.querySelector(".info-bar")?.textContent, nodes: document.querySelectorAll(".react-flow__node").length, hidden: document.hidden, vis: document.visibilityState, raf: 0 }));
      const rafOk = await page.evaluate(() => new Promise<number>((r) => { const t0 = performance.now(); requestAnimationFrame(() => r(Math.round(performance.now() - t0))); setTimeout(() => r(-1), 1500); }));
      await page.screenshot({ path: process.env["MESSY_SHOT_DIR"] ? `${process.env["MESSY_SHOT_DIR"]}/notab-falha.png` : "/dev/null" }).catch(() => {});
      throw new Error(`clique na Nota B falhou: box1=${JSON.stringify(b1)} box2=${JSON.stringify(b2)} rafMs=${rafOk} ${JSON.stringify(info)} :: ${String(e).slice(0, 120)}`);
    }
    await page.waitForSelector(".nodebar", { timeout: 5000 });
    // Ctrl+L entra no modo conectar; clicar no terminal cria a conexão
    await page.keyboard.press("Control+l");
    await page.waitForSelector("main.canvas.linking");
    await page.locator(".react-flow__node-terminal .bar").first().click();
    for (let i = 0; i < 20; i++) { const n = ((await api(`/v1/workspaces/${e2e.workspaceId}`)) as { connections: unknown[] }).connections.length; if (n === before + 1) break; await page.waitForTimeout(200); }
    expect(((await api(`/v1/workspaces/${e2e.workspaceId}`)) as { connections: unknown[] }).connections.length).toBe(before + 1);
    // badge de contagem na barra contextual do terminal
    await page.locator(".react-flow__node-terminal .bar").first().click();
    await page.waitForSelector('.nodebar [data-testid="nb-link"] .nb-badge');
    // Ctrl+Tab muda a seleção
    const selBefore = await page.locator(".react-flow__node.selected").getAttribute("data-id");
    await page.keyboard.press("Control+Tab");
    await page.waitForFunction((prev) => document.querySelector(".react-flow__node.selected")?.getAttribute("data-id") !== prev, selBefore, { timeout: 10_000 }).catch((e) => { throw new Error(`Ctrl+Tab não mudou a seleção (antes=${selBefore}): ${e}`); });
    // atenção: parar o shell marca o nó; Ctrl+Shift+A seleciona-o
    const snap = (await api(`/v1/workspaces/${e2e.workspaceId}`)) as { nodes: { nodeId: string; kind: string; sessionId?: string }[] };
    const term = snap.nodes.find((n) => n.kind === "terminal")!;
    await fetch(`http://127.0.0.1:${PORT}/v1/sessions/${term.sessionId}/stop`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
    await page.waitForSelector(".node.terminal.att .dot", { timeout: 10_000 });
    await page.click("main.canvas .react-flow__pane", { position: { x: 30, y: 500 } }); // limpa seleção
    await page.keyboard.press("Control+Shift+A");
    await page.waitForFunction((id) => document.querySelector(".react-flow__node.selected")?.getAttribute("data-id") === id, term.nodeId, { timeout: 10_000 }).catch(async (e) => { const info = await page.evaluate(() => ({ att: [...document.querySelectorAll(".node.att")].length, sel: document.querySelector(".react-flow__node.selected")?.getAttribute("data-id"), typing: document.activeElement?.tagName })); throw new Error(`Ctrl+Shift+A não selecionou o terminal parado: ${JSON.stringify(info)} ${e}`); });
    // Ctrl+↓ vai para o próximo espaço
    await page.keyboard.press("Control+ArrowDown");
    await page.waitForFunction(() => !document.querySelector(".side li.ws.on")?.textContent?.includes("E2E"), undefined, { timeout: 10_000 }).catch((e) => { throw new Error(`Ctrl+↓ não trocou de espaço: ${e}`); });
    await page.keyboard.press("Control+ArrowUp");
    await page.waitForSelector(".side li.ws.on:has-text('E2E')");
  }, 40_000);

  it("compositor: Ctrl+Shift+P abre abaixo do terminal, @ lista nós, # lista arquivos, Enter envia ao shell", async () => {
    const wsList = await api("/v1/workspaces") as { workspaceId: string; name: string }[];
    const e2e = wsList.find((w) => w.name === "E2E")!;
    const snap = (await api(`/v1/workspaces/${e2e.workspaceId}`)) as { nodes: { nodeId: string; kind: string; title: string }[] };
    const term = snap.nodes.find((n) => n.kind === "terminal")!;
    const token = readFileSync(join(dataDir, "runtime.token"), "utf8").trim();
    await fetch(`http://127.0.0.1:${PORT}/v1/nodes/${term.nodeId}/restart`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
    const node = page.locator(`.react-flow__node[data-id="${term.nodeId}"]`);
    await node.locator(".st.running").waitFor({ timeout: 10_000 });
    await node.locator(".bar").click();
    await page.keyboard.press("Control+Shift+P");
    const cp = page.locator('[data-testid="composer"]');
    await cp.waitFor();
    const ta = cp.locator("textarea");
    await ta.fill("@"); await ta.press("End");
    await page.waitForSelector(".cp-pop .mi:has-text('Nota B')");
    await ta.fill("#runtime"); await ta.press("End"); await ta.type(".");
    await page.waitForSelector(".cp-pop .mi:has-text('runtime.token')");
    await page.keyboard.press("Escape"); // fecha o popup, mantém o compositor
    await cp.waitFor();
    await ta.fill("echo composer-ok");
    await ta.press("Enter");
    await page.waitForFunction((id) => document.querySelector(`.react-flow__node[data-id="${id}"] .xterm`)?.textContent?.includes("composer-ok"), term.nodeId, { timeout: 10_000 });
    expect(await ta.inputValue()).toBe("");
    await page.keyboard.press("Escape");
    await cp.waitFor({ state: "hidden" });
  }, 40_000);

  it("chat: Ctrl+J abre a camada, compositor cria balão do usuário, messy say cria balão do agente em Markdown", async () => {
    const wsList = await api("/v1/workspaces") as { workspaceId: string; name: string }[];
    const e2e = wsList.find((w) => w.name === "E2E")!;
    const snap = (await api(`/v1/workspaces/${e2e.workspaceId}`)) as { nodes: { nodeId: string; kind: string }[] };
    const term = snap.nodes.find((n) => n.kind === "terminal")!;
    const node = page.locator(`.react-flow__node[data-id="${term.nodeId}"]`);
    await node.locator(".bar").click();
    await page.keyboard.press("Control+j");
    await page.waitForSelector('[data-testid="chat"]');
    const ta = page.locator('[data-testid="composer"] textarea'); await ta.waitFor();
    await ta.fill("resuma o plano"); await ta.press("Enter");
    await page.waitForSelector(".bubble.user:has-text('resuma o plano')");
    const token = readFileSync(join(dataDir, "runtime.token"), "utf8").trim();
    const cli = spawn(join(ROOT, "apps/cli/bin/messy"), ["say", "Plano **resumido**: `ok`"], { env: { ...process.env, MESSY_SOCKET: join(dataDir, "agent.sock"), MESSY_TOKEN: token, MESSY_WORKSPACE_ID: e2e.workspaceId, MESSY_NODE_ID: term.nodeId } });
    await new Promise((r) => cli.on("exit", r));
    await page.waitForSelector(".bubble.agent strong:has-text('resumido')");
    // trocar de tópico esconde os balões do tópico 1
    await page.click(".threads .th[title='Tópico 3']");
    expect(await page.locator(".bubble").count()).toBe(0);
    await page.keyboard.press("Control+j");
    await page.waitForSelector('[data-testid="chat"]', { state: "detached" });
  }, 30_000);

  it("papéis: aba Papel do Novo terminal atribui; pílula no nó troca e tira o papel", async () => {
    const token = readFileSync(join(dataDir, "runtime.token"), "utf8").trim();
    const post = (path: string, body: unknown) => fetch(`http://127.0.0.1:${PORT}${path}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
    await post("/v1/roles", { name: "Revisor", badge: "RV", instructions: "Revise." });
    await page.click(".side li.ws:has-text('E2E')");
    await page.click("main.canvas .react-flow__pane", { position: { x: 30, y: 500 } });
    await page.keyboard.press("Control+t");
    await page.waitForSelector(".modal:has-text('Novo terminal')");
    await page.click(".tabs button:has-text('Papel')");
    await page.click('[data-testid="role-grid"] .qs:has-text("Revisor")');
    await page.click(".tabs button:has-text('Detalhes')");
    await page.fill(".modal input[placeholder='Nome']", "Com papel");
    await page.click(".modal .actions button.pri");
    const node = page.locator(".react-flow__node-terminal", { hasText: "Com papel" });
    await node.locator('[data-testid="role-pill"]:has-text("Revisor")').waitFor({ state: "attached", timeout: 10_000 });
    await node.scrollIntoViewIfNeeded().catch(() => {});
    // pílula → Sem papel
    await node.locator('[data-testid="role-pill"]').click();
    await node.locator(".role-menu .mi:has-text('Sem papel')").click();
    await node.locator('[data-testid="role-pill"].none').waitFor({ state: "attached", timeout: 10_000 });
    // Gerenciar… abre o diálogo
    await node.locator('[data-testid="role-pill"]').click();
    await node.locator(".role-menu .mi:has-text('Gerenciar')").click();
    await page.waitForSelector('[data-testid="roles-dialog"] .mi:has-text("Revisor")');
    await page.keyboard.press("Escape");
  }, 40_000);

  it("nota: formatada renderiza Markdown e Mermaid, raw edita, cadeado bloqueia", async () => {
    const wsList = await api("/v1/workspaces") as { workspaceId: string; name: string }[];
    const e2e = wsList.find((w) => w.name === "E2E")!;
    const token = readFileSync(join(dataDir, "runtime.token"), "utf8").trim();
    await page.click(".side li.ws:has-text('E2E')");
    const spot = await visibleSpot(page);
    const snap0 = (await api(`/v1/workspaces/${e2e.workspaceId}`)) as { workspace: { revision: number } };
    const r = await fetch(`http://127.0.0.1:${PORT}/v1/workspaces/${e2e.workspaceId}/nodes`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: snap0.workspace.revision, kind: "note", geometry: { x: spot.x, y: spot.y, w: 360, h: 300 }, content: "# Título md\n\nTexto **forte**\n\n```mermaid\ngraph TD; A-->B;\n```" }) }).then((x) => x.json()) as { node: { nodeId: string } };
    const node = page.locator(`.react-flow__node[data-id="${r.node.nodeId}"]`);
    await node.waitFor();
    await node.locator(".bar .title", { hasText: "Título md" }).waitFor();
    await node.locator('[data-testid="note-md"] strong:has-text("forte")').waitFor();
    await node.locator(".mermaid-box svg").waitFor({ state: "attached", timeout: 15_000 });
    await node.scrollIntoViewIfNeeded().catch(() => {});
    await node.locator('[data-testid="note-lock"]').click();
    await page.waitForFunction((id) => !!document.querySelector(`.react-flow__node[data-id="${id}"] .node.locked`), r.node.nodeId);
    await node.locator('[data-testid="note-mode"]').click();
    await node.locator("textarea").waitFor({ state: "attached" });
  }, 40_000);

  it("cabo: selecionar mostra controles; Circuito troca o estilo; tesoura corta", async () => {
    const wsList = await api("/v1/workspaces") as { workspaceId: string; name: string }[];
    const e2e = wsList.find((w) => w.name === "E2E")!;
    await page.click(".side li.ws:has-text('E2E')");
    const token = readFileSync(join(dataDir, "runtime.token"), "utf8").trim();
    const post = (path: string, body: unknown) => fetch(`http://127.0.0.1:${PORT}${path}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) }).then((x) => x.json());
    const rev = async () => ((await api(`/v1/workspaces/${e2e.workspaceId}`)) as { workspace: { revision: number } }).workspace.revision;
    const spot = await visibleSpot(page);
    const na = await post(`/v1/workspaces/${e2e.workspaceId}/nodes`, { expectedRevision: await rev(), kind: "note", title: "Cabo A", geometry: { x: spot.x - 160, y: spot.y, w: 200, h: 110 } }) as { node: { nodeId: string } };
    const nb = await post(`/v1/workspaces/${e2e.workspaceId}/nodes`, { expectedRevision: await rev(), kind: "note", title: "Cabo B", geometry: { x: spot.x + 220, y: spot.y, w: 200, h: 110 } }) as { node: { nodeId: string } };
    await post(`/v1/workspaces/${e2e.workspaceId}/connections`, { expectedRevision: await rev(), sourceNodeId: na.node.nodeId, targetNodeId: nb.node.nodeId });
    await page.locator(`.react-flow__node[data-id="${na.node.nodeId}"]`).waitFor({ state: "attached" });
    await page.locator(`.react-flow__node[data-id="${nb.node.nodeId}"]`).waitFor({ state: "attached" });
    await page.click("main.canvas .react-flow__pane", { position: { x: 30, y: 700 } });
    const before = ((await api(`/v1/workspaces/${e2e.workspaceId}`)) as { connections: unknown[] }).connections.length;
    expect(before).toBeGreaterThan(0);
    const clickEdge = async () => {
      // amostra pontos ao longo do cabo e usa o primeiro que não está coberto por um nó
      let pt: { x: number; y: number } | null = null;
      for (let i = 0; i < 10 && !pt; i++) { if (i) await page.waitForTimeout(300); pt = await page.evaluate(() => {
        for (const p of [...document.querySelectorAll(".react-flow__edge path")].reverse() as SVGPathElement[]) { // o cabo mais recente primeiro
          const m = p.getScreenCTM()!; const L = p.getTotalLength();
          for (let f = 0.1; f <= 0.9; f += 0.05) { const q = p.getPointAtLength(L * f).matrixTransform(m); const el = document.elementFromPoint(q.x, q.y); if (el && el.closest(".react-flow__edge")) return { x: q.x, y: q.y }; }
        }
        return null;
      }); }
      if (!pt) {
        await page.screenshot({ path: process.env["MESSY_SHOT_DIR"] ? `${process.env["MESSY_SHOT_DIR"]}/cabo-falha.png` : "/dev/null" }).catch(() => {});
        const info = await page.evaluate(() => ({ edges: document.querySelectorAll(".react-flow__edge").length, vp: (document.querySelector(".react-flow__viewport") as HTMLElement)?.style.transform, sel: [...document.querySelectorAll(".react-flow__node.selected")].map((n) => n.getAttribute("data-id")) }));
        throw new Error(`nenhum ponto visível do cabo: ${JSON.stringify(info)}`);
      }
      await page.mouse.click(pt.x, pt.y);
    };
    await clickEdge();
    await page.waitForSelector('[data-testid="edgebar"]');
    await page.click('[data-testid="eb-circuit"]');
    await page.waitForSelector(".react-flow__edge .circuit", { state: "attached" });
    const snap = (await api(`/v1/workspaces/${e2e.workspaceId}`)) as { connections: { style?: string }[] };
    expect(snap.connections.some((c) => c.style === "circuit")).toBe(true);
    await page.click("main.canvas .react-flow__pane", { position: { x: 30, y: 700 } });
    await clickEdge();
    await page.waitForSelector('[data-testid="edgebar"]');
    await page.click('[data-testid="eb-cut"]');
    for (let i = 0; i < 20; i++) { if (((await api(`/v1/workspaces/${e2e.workspaceId}`)) as { connections: unknown[] }).connections.length === before - 1) break; await page.waitForTimeout(200); }
    expect(((await api(`/v1/workspaces/${e2e.workspaceId}`)) as { connections: unknown[] }).connections.length).toBe(before - 1);
  }, 40_000);

  it("terminal persistente (tmux) pelo diálogo: nasce rodando e marcado como tmux", async () => {
    await page.click(".side li.ws:has-text('E2E')");
    await page.click("main.canvas .react-flow__pane", { position: { x: 30, y: 700 } });
    await page.keyboard.press("Control+t");
    await page.waitForSelector(".modal:has-text('Novo terminal')");
    const chk = page.locator('[data-testid="nt-persistent"]');
    if (await chk.isDisabled()) { await page.keyboard.press("Escape"); return; } // máquina sem tmux
    await chk.check();
    await page.fill(".modal input[placeholder='Nome']", "Persistente");
    await page.click(".modal .actions button.pri");
    const node = page.locator(".react-flow__node-terminal", { hasText: "Persistente" });
    await node.locator(".st.running:has-text('tmux')").waitFor({ state: "attached", timeout: 15_000 });
  }, 30_000);

  it("andares: Novo andar cria worktree, aparece aninhado na barra lateral e na visão geral (Ctrl+Shift+\\)", async () => {
    const repo = join(dataDir, "repo"); mkdirSync(repo);
    const genv = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
    execFileSync("git", ["-C", repo, "init", "-q", "-b", "main"], { env: genv }); writeFileSync(join(repo, "a.txt"), "a"); execFileSync("git", ["-C", repo, "add", "."], { env: genv }); execFileSync("git", ["-C", repo, "commit", "-q", "-m", "i"], { env: genv });
    const token = readFileSync(join(dataDir, "runtime.token"), "utf8").trim();
    const g = await fetch(`http://127.0.0.1:${PORT}/v1/workspaces`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ name: "Repo", cwd: repo, icon: "code", color: "#4cd964" }) }).then((r) => r.json()) as { workspaceId: string };
    await page.waitForSelector(".side li.ws:has-text('Repo')");
    await page.click(".side li.ws:has-text('Repo')", { button: "right" });
    await page.click(".menu .mi:has-text('Novo andar')");
    await page.waitForSelector('[data-testid="floor-dialog"]');
    await page.fill('[data-testid="floor-name"]', "Login único");
    expect(await page.inputValue('[data-testid="floor-branch"]')).toBe("login-unico");
    await page.click('[data-testid="floor-submit"]');
    await page.waitForSelector('[data-testid="side-floor"]:has-text("Login único")');
    await page.waitForSelector(".side li.ws.on:has-text('Login único')");
    await page.waitForSelector(".floor-badge:has-text('login-unico')");
    const floors = await fetch(`http://127.0.0.1:${PORT}/v1/workspaces/${g.workspaceId}/floors`, { headers: { authorization: `Bearer ${token}` } }).then((r) => r.json()) as { branch: string; cwd: string }[];
    expect(floors).toHaveLength(1); expect(floors[0]!.branch).toBe("login-unico");
    expect(execFileSync("git", ["-C", repo, "worktree", "list"], { encoding: "utf8", env: genv })).toContain(floors[0]!.cwd);
    // visão geral
    await page.keyboard.press("Control+Shift+\\");
    await page.waitForSelector('[data-testid="overview"]');
    expect(await page.locator('[data-testid="ov-floor"]').count()).toBe(1);
    await page.screenshot({ path: process.env["MESSY_SHOT_DIR"] ? `${process.env["MESSY_SHOT_DIR"]}/overview.png` : "/dev/null" }).catch(() => {});
    await page.click('[data-testid="ov-ground"]');
    await page.waitForSelector('[data-testid="overview"]', { state: "detached" });
    await page.waitForSelector(".side li.ws.on:has-text('Repo')");
  }, 40_000);

  it("árvore de arquivos: tecla F cria o nó com os arquivos do espaço; grade; busca por nome e conteúdo", async () => {
    await page.click(".side li.ws:has-text('Repo')"); // repositório do teste dos andares (a.txt)
    await page.waitForSelector(".side li.ws.on:has-text('Repo')");
    await page.click("main.canvas .react-flow__pane", { position: { x: 30, y: 700 } });
    await page.keyboard.press("f");
    await page.waitForSelector("main.canvas .capture.tree");
    await page.mouse.click(600, 360);
    const node = page.locator(".node.tree"); await node.waitFor();
    await node.scrollIntoViewIfNeeded().catch(() => {});
    await node.locator('[data-testid="tree-row"]:has-text("a.txt")').waitFor({ timeout: 15_000 });
    await page.screenshot({ path: process.env["MESSY_SHOT_DIR"] ? `${process.env["MESSY_SHOT_DIR"]}/tree.png` : "/dev/null" }).catch(() => {});
    await node.locator('[data-testid="tree-grid"]').click();
    await node.locator(".tr-cell:has-text('a.txt')").waitFor();
    await node.locator('[data-testid="tree-search"]').fill(">a");
    await node.locator(".tr-row:has-text('a.txt')").waitFor();
    await node.locator('[data-testid="tree-search"]').fill("nada-assim");
    await node.locator(".tr-empty").waitFor();
    await node.locator('[data-testid="tree-search"]').fill("");
    // criar pasta pelo botão com prompt()
    await node.locator('button[title="Nova pasta aqui"]').click();
    await page.fill('[data-testid="ask-input"]', "docs"); await page.keyboard.press("Enter");
    await node.locator(".tr-cell:has-text('docs')").waitFor({ timeout: 10_000 });
  }, 40_000);
});
