import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// #73 — dispositivo Android na interface, com Electron real e adb FALSO (reprodutível): escolher aparelho, quadros reais (pixels), toque/swipe/teclas
// do usuário chegando ao adb, ação do AGENTE (API) refletida, inspeção de elementos com envio ao agente, iniciar emulador com progresso.
const ROOT = join(import.meta.dirname, "../..");
const FIX = join(ROOT, "tests/fixtures/device");
const PORT = 48046; const SER = "R58M123ABC";
let dataDir: string; let fake: string; let runtime: ChildProcess; let app: ElectronApplication; let page: Page; let token: string; let WS: string;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const api = async (method: string, path: string, body?: unknown) => { const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : null }); const t = await r.text(); return t ? JSON.parse(t) : null; };
const calls = (): string[] => (existsSync(join(fake, "calls.log")) ? readFileSync(join(fake, "calls.log"), "utf8").split("\n").filter(Boolean) : []);
const input = (): string[] => calls().filter((c) => c.includes(" shell input ") || c.includes(" shell monkey ")).map((c) => c.replace(/^-s \S+ shell /, ""));
type Snap = { workspace: { revision: number }; nodes: { nodeId: string; kind: string }[] };
const devId = async () => ((await api("GET", `/v1/workspaces/${WS}`)) as Snap).nodes.find((n) => n.kind === "device")!.nodeId;
/** ponto do aparelho (px do PNG 270x480) → tela */
const toScreen = async (dx: number, dy: number) => {
  const b = (await page.locator('[data-testid="device-img"]').boundingBox())!; const sc = Math.min(b.width / 270, b.height / 480);
  return { x: b.x + (b.width - 270 * sc) / 2 + dx * sc, y: b.y + (b.height - 480 * sc) / 2 + dy * sc };
};

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "mess-device-e2e-")); fake = join(dataDir, "fake"); mkdirSync(fake);
  writeFileSync(join(fake, "devices"), `${SER} device usb:1-2 product:beyond1 model:Fake_Phone device:beyond1 transport_id:2\n`);
  const env = { ...process.env, FAKE_ADB_DIR: fake, MESS_ADB: join(FIX, "fake-adb"), MESS_EMULATOR: join(FIX, "fake-emulator"), FAKE_BOOT_SECONDS: "3" };
  runtime = spawn("node", [join(ROOT, "apps/runtime/dist/index.js")], { env: { ...env, MESS_DATA_DIR: join(dataDir, "data"), MESS_PORT: String(PORT), SHELL: "/bin/sh" }, stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { await sleep(250); try { token = readFileSync(join(dataDir, "data", "runtime.token"), "utf8").trim(); up = (await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: { authorization: `Bearer ${token}` } })).ok; } catch { /* subindo */ } }
  if (!up) throw new Error(`runtime de teste não subiu na porta ${PORT}`);
  app = await electron.launch({ args: ["."], cwd: join(ROOT, "apps/desktop"), env: { ...env, MESS_DATA_DIR: join(dataDir, "data"), MESS_PORT: String(PORT) } });
  page = await app.firstWindow();
  await page.waitForSelector(".side h1");
  WS = ((await api("POST", "/v1/workspaces", { name: "Android", cwd: dataDir })) as { workspaceId: string }).workspaceId;
  await page.waitForSelector(".side li.ws:has-text('Android')");
  await page.click(".side li.ws:has-text('Android')");
  await page.waitForSelector(".side li.ws.on:has-text('Android')");
}, 60_000);

afterAll(async () => {
  await app?.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
  await app?.close().catch(() => {});
  try { runtime?.kill(); } catch { /* */ }
  for (let i = 0; i < 15 && runtime && runtime.exitCode === null; i++) await sleep(100);
  if (runtime && runtime.exitCode === null) { try { runtime.kill("SIGKILL"); } catch { /* */ } }
  for (const f of existsSync(fake) ? readdirSync(fake).filter((x) => x.startsWith("pid-")) : []) { try { process.kill(Number(readFileSync(join(fake, f), "utf8").trim()), "SIGKILL"); } catch { /* */ } }
  await sleep(200); try { rmSync(dataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 }); } catch { /* */ }
}, 30_000);

describe("dispositivo Android na interface (#73)", () => {
  it("menu Adicionar cria o nó SEM ligar nada; escolher o aparelho mostra o quadro de verdade (pixels)", async () => {
    await page.click('button:has-text("Adicionar")'); await page.click('[data-testid="add-device"]');
    await page.waitForSelector('.node.device [data-testid="device-idle"]');
    expect((await api("GET", `/v1/devices/${await devId()}`)).status).toBe("stopped");
    await page.waitForFunction((s) => !![...document.querySelectorAll('[data-testid="device-select"] option')].find((o) => (o as HTMLOptionElement).value === `serial:${s}`), SER, { timeout: 10_000 });
    await page.selectOption('[data-testid="device-select"]', `serial:${SER}`);
    await page.waitForSelector('[data-testid="device-status"][data-status="connected"]', { timeout: 15_000 });
    await page.waitForFunction(() => (document.querySelector('[data-testid="device-img"]') as HTMLImageElement | null)?.src.startsWith("data:image/png"), undefined, { timeout: 15_000 });
    // pixel azul do retângulo (10..120 x 10..70) do fixture
    const px = await page.waitForFunction(() => { const im = document.querySelector('[data-testid="device-img"]') as HTMLImageElement; if (!im.naturalWidth) return null; const c = document.createElement("canvas"); c.width = im.naturalWidth; c.height = im.naturalHeight; const g = c.getContext("2d")!; g.drawImage(im, 0, 0); const d = g.getImageData(40, 30, 1, 1).data; return d[2]! > 180 && d[0]! < 80 ? "azul" : d[0]! > 180 && d[2]! < 80 ? "vermelho" : null; }, undefined, { timeout: 15_000 });
    expect(["azul", "vermelho"]).toContain(await px.jsonValue()); // o fake alterna as duas imagens a cada entrada
    expect(JSON.parse((((await api("GET", `/v1/workspaces/${WS}`)) as { nodes: { kind: string; content: string }[] }).nodes.find((n) => n.kind === "device")!.content))).toEqual({ serial: SER }); // escolha gravada no nó
  }, 60_000);

  it("toque, longo, swipe, roda, teclado, colar e botões chegam ao adb com as coordenadas do APARELHO", async () => {
    const before = input().length;
    const p = await toScreen(100, 200); await page.mouse.click(p.x, p.y);
    const waitInput = async (re: RegExp, ms = 12_000) => { const t = Date.now(); while (Date.now() - t < ms) { if (input().slice(before).some((c) => re.test(c))) return; await sleep(150); } throw new Error(`não chegou ao adb: ${re} — viu: ${input().slice(before).join(" | ")}`); };
    /** comando `input <verbo> n n …` com cada número a no máx. `tol` px do esperado (o mapeamento tela→aparelho arredonda sub-pixel) */
    const waitNear = async (verb: string, want: number[], tol = 5, ms = 12_000) => { const t = Date.now(); while (Date.now() - t < ms) { const hit = input().slice(before).find((c) => { const m = c.startsWith(`input ${verb} `) ? c.slice(`input ${verb} `.length).split(" ").map(Number) : null; return !!m && want.every((w, i) => Number.isFinite(m[i]) && Math.abs(m[i]! - w) <= tol); }); if (hit) return hit; await sleep(150); } throw new Error(`não chegou ao adb: ${verb} ~ ${want.join(",")} — viu: ${input().slice(before).join(" | ")}`); };
    await waitNear("tap", [100, 200]);
    const a = await toScreen(60, 300); const b = await toScreen(60, 100); await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 }); await page.mouse.move(b.x, b.y, { steps: 4 }); await sleep(250); await page.mouse.up();
    await waitNear("swipe", [60, 300, 60, 100]);
    const lp = await toScreen(200, 400); await page.mouse.move(lp.x, lp.y); await page.mouse.down(); await sleep(900); await page.mouse.up();
    await waitNear("swipe", [200, 400, 200, 400]); // longpress = swipe parado
    await page.click('[data-testid="device-back"]'); await waitInput(/^input keyevent KEYCODE_BACK$/);
    await page.click('[data-testid="device-home"]'); await waitInput(/^input keyevent KEYCODE_HOME$/);
    await page.click('[data-testid="device-recents"]'); await waitInput(/^input keyevent KEYCODE_APP_SWITCH$/);
    await page.click('[data-testid="device-view"]', { position: { x: 5, y: 5 } }); await page.keyboard.type("oi mundo", { delay: 15 }); await waitInput(/^input text 'oi%smundo'$/);
    await page.keyboard.press("Enter"); await waitInput(/^input keyevent KEYCODE_ENTER$/);
    await page.fill('[data-testid="device-text"]', "campo livre"); await page.press('[data-testid="device-text"]', "Enter"); await waitInput(/^input text 'campo%slivre'$/);
    const w = await toScreen(135, 240); await page.mouse.move(w.x, w.y); await page.mouse.wheel(0, 300); await waitNear("swipe", [135, 240, 135, 240], 120);
    // texto com acento: avisa e NADA vai ao adb
    const n0 = input().length; await page.click('[data-testid="device-view"]', { position: { x: 5, y: 5 } }); await page.evaluate(() => { document.querySelector('[data-testid="device-view"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "á", bubbles: true, cancelable: true })); }); await page.waitForSelector(".toast:has-text('ASCII')"); await sleep(400); expect(input().length).toBe(n0);
    // app: menu de apps abre e lança
    await page.click('[data-testid="device-apps"]'); await page.click('[data-testid="device-apps-menu"] .mi:has-text("com.fake.app")'); await waitInput(/^monkey -p com\.fake\.app -c android\.intent\.category\.LAUNCHER 1$/);
    await page.waitForFunction(async ([pid, tk, port]) => { const r = await fetch(`http://127.0.0.1:${port}/v1/devices/${pid}`, { headers: { authorization: `Bearer ${tk}` } }); return (await r.json()).foreground === "com.fake.app/com.fake.app.Main"; }, [await devId(), token, PORT] as const, { timeout: 10_000 });
  }, 120_000);

  it("ação do AGENTE (API) aparece na tela: o quadro muda e a mudança vem do runtime", async () => {
    const id = await devId();
    const src0 = await page.getAttribute('[data-testid="device-img"]', "src");
    await api("POST", `/v1/devices/${id}/act`, { action: "tap", x: 1, y: 1 });
    await page.waitForFunction((s) => (document.querySelector('[data-testid="device-img"]') as HTMLImageElement).src !== s, src0, { timeout: 15_000 });
  }, 30_000);

  it("inspecionar: clicar no botão mostra o elemento (texto, id, bounds) e envia ao agente conectado", async () => {
    const snap = (await api("GET", `/v1/workspaces/${WS}`)) as Snap;
    const t = await api("POST", `/v1/workspaces/${WS}/nodes`, { expectedRevision: snap.workspace.revision, kind: "terminal", title: "Agente", command: "/bin/cat", geometry: { x: 700, y: 20, w: 400, h: 300 } }) as { node: { nodeId: string } };
    const s2 = (await api("GET", `/v1/workspaces/${WS}`)) as Snap;
    await api("POST", `/v1/workspaces/${WS}/connections`, { expectedRevision: s2.workspace.revision, sourceNodeId: await devId(), targetNodeId: t.node.nodeId });
    await page.click('[data-testid="device-inspect"]');
    await page.waitForSelector(".dev-overlay", { timeout: 15_000 });
    await page.waitForSelector(".portal-loading", { state: "detached", timeout: 20_000 }); // espera a árvore de UI ser lida
    const p = await toScreen(60, 40); await page.mouse.move(p.x - 3, p.y - 3); await page.mouse.move(p.x, p.y); await page.waitForSelector(".dev-box.hover"); await page.mouse.down(); await page.mouse.up();
    await page.waitForSelector('[data-testid="device-pick"]');
    expect(await page.textContent('[data-testid="device-pick-text"]')).toContain("Entrar & sair"); expect(await page.textContent('[data-testid="device-pick-id"]')).toBe("com.fake.app:id/btn_login");
    await page.click('[data-testid="device-send"]:has-text("Agente")'); await page.waitForSelector(".toast:has-text('Enviado ao agente')", { timeout: 10_000 });
    const chat = (await api("GET", `/v1/nodes/${t.node.nodeId}/chat`)) as { text: string }[];
    expect(chat.some((m) => m.text.includes("Elemento do dispositivo") && m.text.includes("com.fake.app:id/btn_login"))).toBe(true);
    await page.click('[data-testid="device-inspect"]');
  }, 60_000);

  it("desconectar volta ao idle; iniciar emulador pelo seletor mostra o progresso e conecta quando sobe; apagar o nó encerra o emulador", async () => {
    await page.click('[data-testid="device-disconnect"]'); await page.waitForSelector('[data-testid="device-idle"]');
    await page.waitForFunction(() => !![...document.querySelectorAll('[data-testid="device-select"] option')].find((o) => (o as HTMLOptionElement).value === "avd:Pixel_Fake"), undefined, { timeout: 10_000 });
    await page.selectOption('[data-testid="device-select"]', "avd:Pixel_Fake");
    await page.waitForSelector('[data-testid="device-status"][data-status="starting"]', { timeout: 10_000 });
    expect(await page.textContent('[data-testid="device-message"]')).toMatch(/emulador|procurando|Conectando/i);
    await page.waitForSelector('[data-testid="device-status"][data-status="connected"]', { timeout: 40_000 });
    await page.waitForFunction(() => (document.querySelector('[data-testid="device-img"]') as HTMLImageElement | null)?.src.startsWith("data:image/png"), undefined, { timeout: 15_000 });
    expect(readFileSync(join(fake, "devices"), "utf8")).toContain("emulator-5554");
    expect(readFileSync(join(fake, "emulator.log"), "utf8")).toContain("-avd Pixel_Fake -port 5554 -no-window -no-audio -no-snapshot -no-boot-anim -gpu swiftshader_indirect -read-only");
    const id = await devId(); const rev = ((await api("GET", `/v1/workspaces/${WS}`)) as Snap).workspace.revision;
    await api("DELETE", `/v1/nodes/${id}`, { expectedRevision: rev });
    for (let i = 0; i < 60 && readFileSync(join(fake, "devices"), "utf8").includes("emulator-5554"); i++) await sleep(250);
    expect(readFileSync(join(fake, "devices"), "utf8")).not.toContain("emulator-5554");
  }, 90_000);
});
