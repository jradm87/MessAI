import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// #56 — Preferências → Terminal com Electron real: preset novo aparece no "Novo terminal" e cria o nó com a aparência;
// desabilitar some do início rápido; fonte/padding/tema valem no xterm; aparência editável no nó; copiar ao selecionar persiste.
const ROOT = join(import.meta.dirname, "../..");
const PORT = 47965;
let dataDir: string; let runtime: ChildProcess; let app: ElectronApplication; let page: Page; let token: string;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const api = async (method: string, path: string, body?: unknown) => (await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : null })).json();

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "mess-tprefs-"));
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

const openTerminalTab = async () => {
  if (!(await page.locator('[data-testid="prefs"]').count())) { await page.click('[data-testid="settings"]'); await page.waitForSelector('[data-testid="prefs"]'); }
  await page.click('[data-testid="prefs-tab-terminal"]');
  await page.waitForSelector('[data-testid="preset-list"] [data-testid="preset-row"]');
};
const closePrefs = async () => { await page.keyboard.press("Escape"); await page.waitForSelector('[data-testid="prefs"]', { state: "detached" }); };

describe("Preferências → Terminal (#56)", () => {
  it("adiciona um preset com ícone/cor/tema; ele aparece no Novo terminal e o nó nasce com a aparência; desabilitar o Shell tira do início rápido", async () => {
    await openTerminalTab();
    const before = await page.locator('[data-testid="preset-row"]').count();
    await page.click('[data-testid="preset-add"]');
    await page.waitForSelector('[data-testid="preset-editor"]');
    await page.fill('[data-testid="preset-label"]', "Meu shell");
    await page.fill('[data-testid="preset-command"]', "/bin/sh -l");
    await page.click('[data-testid="preset-editor"] .tabs button:has-text("Aparência")');
    await page.click('[data-testid="preset-editor"] .icon-grid .ig[title="rocket"]');
    await page.click('[data-testid="preset-editor"] .color-row .sw[title="#ef5350"]');
    await page.click('[data-testid="preset-theme"] button:has-text("Escuro")');
    await page.click('[data-testid="preset-save"]');
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid="preset-row"]').length === n + 1, before);
    const saved = (await api("GET", "/v1/presets")) as { id: string; label: string; command: string; args: string[]; icon: string; color: string; theme: string; enabled: boolean }[];
    const mine = saved.find((p) => p.label === "Meu shell")!;
    expect(mine).toMatchObject({ command: "/bin/sh", args: ["-l"], icon: "rocket", color: "#ef5350", theme: "dark", enabled: true });
    // desabilita o Shell padrão
    await page.click('[data-testid="preset-enabled-shell"]');
    await page.waitForFunction(() => document.querySelector('[data-testid="preset-enabled-shell"]')?.getAttribute("aria-checked") === "false");
    await closePrefs();
    // Novo terminal: "Meu shell" presente com ícone; "Shell" ausente
    await page.mouse.click(700, 60); await page.keyboard.press("Escape"); await page.keyboard.press("Control+t");
    await page.waitForSelector(".modal:has-text('Novo terminal')");
    expect(await page.locator(".quick .qs:has-text('Shell')").filter({ hasNotText: "Meu shell" }).count()).toBe(0);
    await page.click(".quick .qs:has-text('Meu shell')");
    await page.click(".tabs button:has-text('Aparência')");
    await page.waitForSelector('[data-testid="nt-appearance"] .ig.on[title="rocket"]'); // aparência herdada do preset
    await page.click(".modal .actions button.pri");
    const node = page.locator(".react-flow__node-terminal", { hasText: "Meu shell" });
    await node.locator(".st.running").waitFor({ state: "attached", timeout: 10_000 });
    const [ws] = (await api("GET", "/v1/workspaces")) as { workspaceId: string }[];
    const snap = (await api("GET", `/v1/workspaces/${ws!.workspaceId}`)) as { nodes: { title: string; icon?: string; color?: string; termTheme?: string }[] };
    expect(snap.nodes.find((n) => n.title === "Meu shell")).toMatchObject({ icon: "rocket", color: "#ef5350", termTheme: "dark" });
    await node.locator(".bar.tinted").waitFor({ state: "attached" });
    // tema do nó vence: xterm escuro mesmo com o app em tema claro
    await page.evaluate(() => localStorage.setItem("mess.theme", "light"));
    await page.click('[data-testid="theme-toggle"]'); // avança a pref de tema (o que importa é o nó ficar escuro)
    await sleep(300);
    // onde o xterm pinta o fundo do tema varia por versão: aceita qualquer camada do terminal com a cor do tema escuro
    const bgs = () => page.evaluate(() => { const root = document.querySelector(".react-flow__node-terminal")!; return [".term", ".xterm", ".xterm-viewport", ".xterm-screen", ".xterm-screen canvas", ".xterm-rows"].map((sel) => { const el = root.querySelector(sel) as HTMLElement | null; return [sel, el ? getComputedStyle(el).backgroundColor.replace(/\s/g, "") : "(sem)", el?.style.backgroundColor ?? ""] as const; }); });
    let ok = false;
    for (let i = 0; i < 25 && !ok; i++) { ok = (await bgs()).some(([, c]) => c === "rgb(10,10,11)"); if (!ok) await sleep(200); }
    expect(ok, `fundo escuro do tema do nó não apareceu: ${JSON.stringify(await bgs())}`).toBe(true); // DARK_PALETTE.background
  }, 60_000);

  it("aparência global: fonte, padding e copiar ao selecionar aplicam no xterm e persistem; editor de aparência no nó muda ícone/cor", async () => {
    await openTerminalTab();
    const node = page.locator(".react-flow__node-terminal", { hasText: "Meu shell" });
    const fontBefore = await node.locator(".xterm-rows").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    await page.click('[data-testid="term-font-plus"]'); await page.click('[data-testid="term-font-plus"]');
    await page.waitForFunction((f) => { const el = document.querySelector(".react-flow__node-terminal .xterm-rows"); return !!el && parseFloat(getComputedStyle(el).fontSize) === f + 2; }, fontBefore);
    await page.click('[data-testid="term-pad-x-plus"]', { timeout: 8000 }).catch(async (e) => {
      await page.screenshot({ path: join(ROOT, "tests/e2e/tprefs-falha.png") }).catch(() => {});
      const info = await page.evaluate(() => { const el = document.querySelector('[data-testid="term-pad-x-plus"]') as HTMLButtonElement | null; if (!el) return "sem elemento"; const r = el.getBoundingClientRect(); const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { rect: { x: r.x, y: r.y, w: r.width, h: r.height }, disabled: el.disabled, display: getComputedStyle(el).display, vis: getComputedStyle(el).visibility, op: getComputedStyle(el).opacity, top: top ? `${top.tagName}.${top.className}` : null, pane: (() => { const p = el.closest(".prefs-pane") as HTMLElement; return { scrollTop: p?.scrollTop, h: p?.clientHeight, sh: p?.scrollHeight }; })() }; });
      throw new Error(`clique em term-pad-x-plus falhou: ${JSON.stringify(info)} :: ${String(e).slice(0, 120)}`);
    });
    await page.waitForFunction(() => { const el = document.querySelector(".react-flow__node-terminal .term") as HTMLElement | null; return !!el && el.style.padding === "6px 8px"; }); // padrão 6px; +2 no horizontal
    await page.click('[data-testid="term-copy"]');
    await page.waitForSelector('[data-testid="term-copy"][aria-checked="true"]');
    const prefs = JSON.parse(await page.evaluate(() => localStorage.getItem("mess.prefs") ?? "{}") as string) as Record<string, unknown>;
    expect(prefs).toMatchObject({ termFontSize: fontBefore + 2, termPadX: 8, termCopyOnSelect: true });
    await closePrefs();
    // aparência no nó: ícone e cor pelo botão da barra
    await node.locator('[data-testid="node-appearance"]').click();
    await node.locator('[data-testid="appearance-menu"] .icon-grid .ig[title="bug"]').click();
    const [ws] = (await api("GET", "/v1/workspaces")) as { workspaceId: string }[];
    for (let i = 0; i < 20; i++) { const s = (await api("GET", `/v1/workspaces/${ws!.workspaceId}`)) as { nodes: { title: string; icon?: string }[] }; if (s.nodes.find((n) => n.title === "Meu shell")?.icon === "bug") break; await sleep(150); }
    const snap = (await api("GET", `/v1/workspaces/${ws!.workspaceId}`)) as { nodes: { title: string; icon?: string; color?: string }[] };
    expect(snap.nodes.find((n) => n.title === "Meu shell")?.icon).toBe("bug");
  }, 40_000);

  it("Restaurar padrões volta a lista original (e o preset próprio some)", async () => {
    await openTerminalTab();
    page.once("dialog", (d) => void d.accept());
    await page.click('[data-testid="preset-reset"]');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="preset-row"]').length === 5);
    expect(((await api("GET", "/v1/presets")) as { id: string }[]).map((p) => p.id)).toEqual(["shell", "claude", "codex", "opencode", "antigravity"]);
    await closePrefs();
  }, 20_000);
});
