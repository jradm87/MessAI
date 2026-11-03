import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// #93 — modo isolado na interface, com Electron real: caixa "Modo isolado" no diálogo, selo no nó, ligar/desligar pelo botão do nó,
// pedido de permissão de um agente isolado aparece (toast + badge + paleta) e aprovar/negar pelo app.
const ROOT = join(import.meta.dirname, "../..");
const PORT = 48035;
let dataDir: string; let runtime: ChildProcess; let app: ElectronApplication; let page: Page; let token: string; let WS: string;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const api = async (method: string, path: string, body?: unknown, tk = () => token) => { const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: { authorization: `Bearer ${tk()}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : null }); const t = await r.text(); return t ? JSON.parse(t) : null; };
type Snap = { nodes: { nodeId: string; title: string; isolation?: { network: string } }[] };
const snap = async () => (await api("GET", `/v1/workspaces/${WS}`)) as Snap;
const bwrapOk = (() => { try { execFileSync("bwrap", ["--unshare-user", "--ro-bind", "/usr", "/usr", "--symlink", "usr/bin", "/bin", "--symlink", "usr/lib", "/lib", "--symlink", "usr/lib64", "/lib64", "--proc", "/proc", "--dev", "/dev", "--", "/usr/bin/true"], { stdio: "ignore" }); return true; } catch { return false; } })();

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "mess-isoui-"));
  runtime = spawn("node", [join(ROOT, "apps/runtime/dist/index.js")], { env: { ...process.env, MESS_DATA_DIR: dataDir, MESS_PORT: String(PORT), SHELL: "/bin/sh" }, stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { await sleep(250); try { token = readFileSync(join(dataDir, "runtime.token"), "utf8").trim(); up = (await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: { authorization: `Bearer ${token}` } })).ok; } catch { /* subindo */ } }
  if (!up) throw new Error(`runtime de teste não subiu na porta ${PORT}`);
  app = await electron.launch({ args: ["."], cwd: join(ROOT, "apps/desktop"), env: { ...process.env, MESS_DATA_DIR: dataDir, MESS_PORT: String(PORT) } });
  page = await app.firstWindow();
  await page.waitForSelector(".side h1");
  WS = ((await api("POST", "/v1/workspaces", { name: "Iso", cwd: dataDir })) as { workspaceId: string }).workspaceId;
  await page.waitForSelector(".side li.ws:has-text('Iso')");
  await page.click(".side li.ws:has-text('Iso')");
  await page.waitForSelector(".side li.ws.on:has-text('Iso')");
}, 60_000);

afterAll(async () => {
  await app?.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
  await app?.close().catch(() => {});
  try { runtime?.kill(); } catch { /* */ }
  for (let i = 0; i < 15 && runtime && runtime.exitCode === null; i++) await sleep(100);
  if (runtime && runtime.exitCode === null) { try { runtime.kill("SIGKILL"); } catch { /* */ } }
  rmSync(dataDir, { recursive: true, force: true });
}, 30_000);

describe.skipIf(!bwrapOk)("modo isolado na interface (#93)", () => {
  it("diálogo: marcar Modo isolado cria o terminal isolado (sem rede) com selo; botão do nó desliga e liga de novo", async () => {
    await page.click("main.canvas .react-flow__pane", { position: { x: 30, y: 600 } });
    await page.keyboard.press("Control+t");
    await page.waitForSelector(".modal:has-text('Novo terminal')");
    await page.fill(".modal input[placeholder='Nome']", "Cela");
    await page.fill(".modal input[placeholder='shell padrão']", "/bin/sh");
    const chk = page.locator('[data-testid="nt-isolated"]');
    expect(await chk.isDisabled()).toBe(false);
    await chk.check();
    await page.waitForSelector('[data-testid="nt-iso-net"]'); // opções de rede aparecem só quando marcado
    await page.click(".modal .actions button.pri");
    await page.waitForSelector(".node.terminal [data-testid='iso-pill']", { timeout: 15_000 });
    const n = (await snap()).nodes.find((x) => x.title === "Cela")!;
    expect(n.isolation).toEqual({ network: "none" });
    // desligar pelo botão do nó (reinicia fora do sandbox)
    await page.click(".node.terminal [data-testid='iso-toggle']");
    await page.waitForSelector(".node.terminal [data-testid='iso-pill']", { state: "detached", timeout: 15_000 });
    for (let i = 0; i < 20 && (await snap()).nodes.find((x) => x.title === "Cela")!.isolation; i++) await sleep(150);
    expect((await snap()).nodes.find((x) => x.title === "Cela")!.isolation).toBeUndefined();
    await page.click(".node.terminal [data-testid='iso-toggle']");
    await page.waitForSelector(".node.terminal [data-testid='iso-pill']", { timeout: 15_000 });
    expect((await snap()).nodes.find((x) => x.title === "Cela")!.isolation).toEqual({ network: "none" });
  }, 60_000);

  it("pedido de permissão: toast + badge na barra; aparece na paleta; aprovar libera a capacidade, negar não; lista guarda o histórico", async () => {
    const cela = (await snap()).nodes.find((x) => x.title === "Cela")!;
    // o respawn do passo anterior rotaciona a credencial do nó (a antiga é revogada): emite e tenta até assentar
    let tk = { token: "" }; let ap = { approvalId: "", status: "" } as { approvalId: string; status: string; error?: unknown };
    for (let i = 0; i < 30; i++) {
      tk = (await api("POST", `/v1/nodes/${cela.nodeId}/token`, {})) as { token: string };
      ap = (await api("POST", "/v1/approvals", { capability: "nodes:write", reason: "criar uma nota" }, () => tk.token)) as typeof ap;
      if (ap.status) break; await sleep(300);
    }
    const me = (m: string, p: string, b?: unknown) => api(m, p, b, () => tk.token);
    expect(ap.status, JSON.stringify(ap)).toBe("pending");
    await page.waitForSelector(".toast:has-text('Cela pede permissão')", { timeout: 10_000 });
    await page.waitForSelector("[data-testid='ws-signal']", { timeout: 10_000 }); // atenção do espaço acende
    await page.mouse.click(700, 60); await page.keyboard.press("Control+k");
    await page.fill('[data-testid="palette-input"]', "permissão");
    await page.waitForSelector('[data-testid="palette-item-action"]:has-text("Pedidos de permissão")');
    await page.keyboard.press("Enter");
    await page.waitForSelector('[data-testid="approvals-dialog"]');
    await page.waitForSelector('[data-testid="approval-item"]:has-text("nodes:write")');
    const mkNote = async () => { const rev = ((await api("GET", `/v1/workspaces/${WS}`)) as { workspace: { revision: number } }).workspace.revision; return fetch(`http://127.0.0.1:${PORT}/v1/workspaces/${WS}/nodes`, { method: "POST", headers: { authorization: `Bearer ${tk.token}`, "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: rev, kind: "note", title: "n", content: "", geometry: { x: 0, y: 0, w: 100, h: 100 } }) }).then((r) => r.status); };
    expect(await mkNote()).toBe(403); // antes de aprovar
    await page.click('[data-testid="approval-approve"]');
    await page.waitForSelector('[data-testid="approval-item"].approved');
    expect(await mkNote()).toBe(201); // aprovado vale na hora, sem reiniciar
    // segundo pedido, negado: não concede
    const ap2 = (await me("POST", "/v1/approvals", { capability: "files:read", reason: "ler" })) as { approvalId: string; status: string };
    if (ap2.status === "pending") {
      await page.waitForSelector('[data-testid="approval-deny"]');
      await page.click('[data-testid="approval-deny"]');
      await page.waitForSelector('[data-testid="approval-item"].denied');
      expect(((await me("GET", `/v1/approvals/${ap2.approvalId}`)) as { status: string }).status).toBe("denied");
    }
    await page.click('[data-testid="approvals-dialog"] .actions button');
    await page.waitForSelector('[data-testid="approvals-dialog"]', { state: "detached" });
  }, 60_000);

  it("Preferências → Agentes → Isolamento: mostra o suporte e valida caminhos (home e raiz recusados; válido salva)", async () => {
    await page.keyboard.press("Control+k");
    await page.fill('[data-testid="palette-input"]', "preferências");
    await page.waitForSelector('[data-testid="palette-item-action"]');
    await page.keyboard.press("Enter");
    await page.waitForSelector(".prefs, [data-testid='agents-tabs'], .pf-section", { timeout: 10_000 }).catch(() => {});
    await page.evaluate(() => { try { localStorage.setItem("mess.pref.prefsTab", JSON.stringify("agents")); } catch { /* */ } });
    const tab = page.locator('[data-testid="agents-tab-isolation"]');
    if (!(await tab.count())) { await page.click("text=Agentes").catch(() => {}); }
    await tab.click({ timeout: 10_000 });
    await page.waitForSelector('[data-testid="iso-status"]:has-text("Disponível")');
    await page.fill('[data-testid="iso-rw"]', "/");
    await page.click('[data-testid="iso-save"]');
    await page.waitForFunction(() => /inv|recus|home|raiz|400|permit|não/i.test(document.querySelector('[data-testid="iso-msg"]')?.textContent ?? ""), undefined, { timeout: 10_000 });
    expect(((await api("GET", "/v1/settings")) as { isolationRw?: string[] }).isolationRw ?? []).not.toContain("/");
    const ok = join(dataDir, "extra");
    await page.fill('[data-testid="iso-rw"]', "");
    await page.fill('[data-testid="iso-ro"]', ok);
    await page.click('[data-testid="iso-save"]');
    await page.waitForFunction(() => /Salvo/.test(document.querySelector('[data-testid="iso-msg"]')?.textContent ?? ""), undefined, { timeout: 10_000 });
    expect(((await api("GET", "/v1/settings")) as { isolationRo?: string[] }).isolationRo).toEqual([ok]);
  }, 60_000);
});
