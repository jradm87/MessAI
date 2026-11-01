import { app, BrowserWindow, dialog, ipcMain, screen, shell } from "electron";
import electronUpdater from "electron-updater";
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, readdirSync, readlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BUILD_VERSION } from "@messai/contracts";

const DATA_DIR = process.env["MESS_DATA_DIR"] ?? join(homedir(), ".messai");
const PORT = Number(process.env["MESS_PORT"] ?? 47821);
const BASE = `http://127.0.0.1:${PORT}`;
const here = fileURLToPath(new URL(".", import.meta.url));

function readToken(): string | undefined {
  const p = join(DATA_DIR, "runtime.token");
  return existsSync(p) ? readFileSync(p, "utf8").trim() : undefined;
}

/** Estado do runtime na porta: está vivo? e qual a versão de build? */
async function runtimeHealth(): Promise<{ ok: boolean; buildVersion?: number }> {
  const token = readToken();
  if (!token) return { ok: false };
  try {
    const r = await fetch(`${BASE}/v1/health`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(800) });
    if (!r.ok) return { ok: false };
    const j = (await r.json()) as { buildVersion?: number };
    return { ok: true, buildVersion: j.buildVersion };
  } catch { return { ok: false }; }
}
const compatible = (h: { ok: boolean; buildVersion?: number }) => h.ok && h.buildVersion === BUILD_VERSION;

/** PID dono de uma porta TCP local, via /proc (Linux) — para derrubar runtime sem pid file/endpoint. */
function pidOnPort(port: number): number | undefined {
  try {
    const hexPort = port.toString(16).toUpperCase().padStart(4, "0");
    let inode: string | undefined;
    for (const ln of readFileSync("/proc/net/tcp", "utf8").split("\n").slice(1)) {
      const c = ln.trim().split(/\s+/);
      if (c[3] === "0A" && c[1]?.endsWith(`:${hexPort}`)) { inode = c[9]; break; } // 0A = LISTEN
    }
    if (!inode) return undefined;
    const target = `socket:[${inode}]`;
    for (const pid of readdirSync("/proc")) {
      if (!/^\d+$/.test(pid)) continue;
      try { for (const fd of readdirSync(`/proc/${pid}/fd`)) if (readlinkSync(`/proc/${pid}/fd/${fd}`) === target) return Number(pid); } catch { /* sumiu / sem permissão */ }
    }
  } catch { /* não-Linux ou sem /proc */ }
  return undefined;
}

async function portFree(ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  do { if (!(await runtimeHealth()).ok) return true; await new Promise((r) => setTimeout(r, 200)); } while (Date.now() < until);
  return !(await runtimeHealth()).ok;
}

/** Derruba o runtime na porta: endpoint gracioso (mantém tmux) → SIGTERM por pid → dono da porta. */
async function stopRuntime(killAgents = false): Promise<void> {
  const token = readToken();
  try { await fetch(`${BASE}/v1/shutdown`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ killAgents }), signal: AbortSignal.timeout(1500) }); } catch { /* runtime antigo sem o endpoint */ }
  if (await portFree(2500)) return;
  let pid: number | undefined;
  try { pid = Number(readFileSync(join(DATA_DIR, "runtime.pid"), "utf8").trim()) || undefined; } catch { /* sem pid file */ }
  pid ??= pidOnPort(PORT);
  if (!pid) return;
  try { process.kill(pid, "SIGTERM"); } catch { /* já morreu */ }
  if (!(await portFree(3000))) { try { process.kill(pid, "SIGKILL"); } catch { /* já morreu */ } await portFree(2000); }
}

/** Sobe o runtime como processo independente (detached). Fechar o app não o encerra.
 *  Se houver um runtime defasado na porta, derruba (mantém tmux) e sobe o novo — assim atualizar o
 *  app sempre passa a valer sem matar processo na mão. */
async function ensureRuntime(): Promise<void> {
  const h = await runtimeHealth();
  if (compatible(h)) return;
  if (h.ok) { console.log(`[runtime] versão ${h.buildVersion ?? "?"} ≠ ${BUILD_VERSION}; reiniciando`); await stopRuntime(false); }
  // Se a unidade systemd --user estiver instalada, ela é a dona do runtime.
  if (process.platform === "linux" && existsSync(join(homedir(), ".config/systemd/user/messai-runtime.service"))) {
    try { execFileSync("systemctl", ["--user", "restart", "messai-runtime.service"], { stdio: "ignore" }); } catch { /* cai para o spawn */ }
    for (let i = 0; i < 20; i++) { if (compatible(await runtimeHealth())) return; await new Promise((r) => setTimeout(r, 250)); }
  }
  // Empacotado: runtime é o bundle (resources/runtime.mjs) rodado com o Node do próprio Electron
  // (ELECTRON_RUN_AS_NODE) — os addons nativos ficam em resources/node_modules recompilados p/ a ABI do Electron.
  // Dev: runtime do dist, com o Node do sistema.
  const packaged = app.isPackaged;
  const entry = packaged ? join(process.resourcesPath, "runtime.mjs") : join(here, "../../../runtime/dist/index.js");
  const nodeBin = packaged ? process.execPath : (process.env["MESS_NODE"] ?? "node");
  const env: NodeJS.ProcessEnv = { ...process.env, MESS_DATA_DIR: DATA_DIR, MESS_PORT: String(PORT) };
  if (packaged) { env["ELECTRON_RUN_AS_NODE"] = "1"; env["MESS_RESOURCES"] = process.resourcesPath; }
  mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  const log = openSync(join(DATA_DIR, "runtime.log"), "a");
  const child = spawn(nodeBin, [entry], { detached: true, stdio: ["ignore", log, log], env });
  child.unref();
  for (let i = 0; i < 40; i++) {
    if (compatible(await runtimeHealth())) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("runtime não respondeu em 10 s");
}

let mainWin: BrowserWindow | null = null;
let runtimeReady: Promise<void> | null = null; // garantia do runtime, iniciada em paralelo à janela
let allowClose = false; // true depois que a tela de encerramento resolve

/** Fechar a janela: pergunta primeiro (tela de encerramento) o que fazer com o que está rodando. */
async function promptShutdown(): Promise<void> {
  let running: { title: string; agentType: string; isAgent: boolean; workspace: string }[] = [];
  try {
    const token = readToken();
    const r = await fetch(`${BASE}/v1/running`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(1000) });
    if (r.ok) running = ((await r.json()) as { sessions: typeof running }).sessions;
  } catch { /* runtime fora do ar: lista vazia, fecha direto */ }
  mainWin?.webContents.send("mess:shutdown-prompt", { running });
}

// Sem throttling em segundo plano: saída de terminal e animações do canvas continuam com a janela oculta/ocluída.
const WEB_PREFS = { preload: join(here, "../preload/index.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } as const;

/** Fiação comum às janelas: log do renderer, erro de preload e links externos só com esquema web (MESS-04). */
function wire(win: BrowserWindow, tag: string): void {
  win.webContents.on("console-message", (e) => {
    if (e.message.includes("ResizeObserver loop")) return; // ruído benigno do xterm/React Flow ao redimensionar
    console.log(`[${tag}:${e.level}] ${e.message} (${e.sourceId}:${e.lineNumber})`);
  });
  win.webContents.on("preload-error", (_e, path, err) => console.error("preload-error", path, err));
  // Bloqueia file:, javascript:, esquemas customizados e URLs inválidas.
  win.webContents.setWindowOpenHandler(({ url }) => { try { const u = new URL(url); if (u.protocol === "https:" || u.protocol === "http:") void shell.openExternal(url); } catch { /* URL inválida */ } return { action: "deny" }; });
}
/** Carrega o renderer único; `hash` escolhe a rota (ex.: "hud" → janela flutuante). */
function load(win: BrowserWindow, hash?: string): void {
  const dev = process.env["ELECTRON_RENDERER_URL"];
  if (dev) void win.loadURL(hash ? `${dev}#${hash}` : dev);
  else void win.loadFile(join(here, "../renderer/index.html"), hash ? { hash } : {});
}

function createWindow(): void {
  const win = new BrowserWindow({ width: 1400, height: 900, title: "MessAI", webPreferences: WEB_PREFS });
  mainWin = win;
  win.on("close", (e) => { if (!allowClose) { e.preventDefault(); void promptShutdown(); } });
  win.on("closed", () => { mainWin = null; closeHud(); }); // o HUD não vive sem a janela principal
  wire(win, "renderer");
  load(win);
}

// #67 — HUD do companheiro: segunda janela, sem moldura, sempre no topo, fora da barra de tarefas,
// no canto inferior direito. Renderizada pelo MESMO bundle (rota `#hud`), com WS próprio no runtime.
let hudWin: BrowserWindow | null = null;
const HUD_W = 380, HUD_H = 480;
const hudOpen = () => !!hudWin && !hudWin.isDestroyed();
const broadcastHud = () => { if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send("mess:hud-state", hudOpen()); };
const HUD_BOUNDS = join(DATA_DIR, "hud.json");
/** Posição/tamanho salvos, só se ainda caem num monitor existente (multi-monitor / monitor desligado). */
function savedHudBounds(): { x: number; y: number; width: number; height: number } | null {
  try {
    const b = JSON.parse(readFileSync(HUD_BOUNDS, "utf8")) as { x: number; y: number; width: number; height: number };
    if (![b.x, b.y, b.width, b.height].every((n) => Number.isFinite(n))) return null;
    const wa = screen.getDisplayMatching(b).workArea;
    const visible = b.x + b.width > wa.x + 40 && b.x < wa.x + wa.width - 40 && b.y >= wa.y - 10 && b.y < wa.y + wa.height - 40;
    return visible ? b : null;
  } catch { return null; }
}
function openHud(): void {
  if (hudOpen()) { hudWin!.showInactive(); return; }
  const wa = screen.getPrimaryDisplay().workArea;
  const bounds = savedHudBounds() ?? { width: HUD_W, height: HUD_H, x: wa.x + wa.width - HUD_W - 16, y: wa.y + wa.height - HUD_H - 16 };
  const win = new BrowserWindow({
    ...bounds, minWidth: 300, minHeight: 240,
    title: "MessAI — Companheiro", frame: false, alwaysOnTop: true, skipTaskbar: true, minimizable: false, maximizable: false, fullscreenable: false, show: false,
    webPreferences: WEB_PREFS,
  });
  hudWin = win;
  // Lembra onde o usuário deixou a janela (debounce; `move`/`resize` são os eventos que existem no Linux).
  let saveT: ReturnType<typeof setTimeout> | undefined;
  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => { try { if (!win.isDestroyed()) writeFileSync(HUD_BOUNDS, JSON.stringify(win.getBounds())); } catch { /* disco cheio/sem permissão: só não lembra */ } }, 300); };
  win.on("move", save); win.on("resize", save);
  win.setAlwaysOnTop(true, "floating");
  try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch { /* WM sem suporte */ }
  win.once("ready-to-show", () => win.showInactive()); // aparece sem roubar o foco do terminal
  win.on("closed", () => { hudWin = null; broadcastHud(); });
  wire(win, "hud");
  load(win, "hud");
  broadcastHud();
}
function closeHud(): void { if (hudOpen()) hudWin!.close(); }

ipcMain.handle("mess:hud-toggle", (_e, open?: boolean) => { const want = typeof open === "boolean" ? open : !hudOpen(); if (want) openHud(); else closeHud(); return hudOpen(); });
ipcMain.handle("mess:hud-state", () => hudOpen());
// "Ir ao terminal" no HUD: traz a janela principal e pede para ela trocar de espaço e selecionar o nó.
ipcMain.handle("mess:hud-focus", (_e, target: { workspaceId: string; nodeId: string }) => {
  if (!mainWin || mainWin.isDestroyed() || typeof target?.workspaceId !== "string" || typeof target?.nodeId !== "string") return;
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show(); mainWin.focus();
  mainWin.webContents.send("mess:focus-node", { workspaceId: target.workspaceId, nodeId: target.nodeId });
});
// Usuário focou o terminal na janela principal: o cartão correspondente sai do HUD.
ipcMain.handle("mess:hud-dismiss", (_e, nodeId: string) => { if (hudOpen() && typeof nodeId === "string") hudWin!.webContents.send("mess:hud-dismiss", nodeId); });

ipcMain.handle("mess:connection", async (event) => {
  // Só os renderers das nossas janelas (principal e HUD) recebem a conexão.
  if (event.senderFrame?.url && !event.senderFrame.url.startsWith("file://") && !event.senderFrame.url.startsWith("http://localhost")) return null;
  // A janela já apareceu; aqui esperamos o runtime ficar pronto (token disponível) antes de conectar.
  if (runtimeReady) await runtimeReady;
  return { baseUrl: BASE, wsUrl: `ws://127.0.0.1:${PORT}/v1/ws`, token: readToken() ?? "", homeDir: homedir() };
});

ipcMain.handle("mess:pickDirectory", async () => {
  const r = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
  return r.canceled ? null : (r.filePaths[0] ?? null);
});

// Decisão da tela de encerramento: "background" deixa o runtime/agentes vivos; "all" encerra tudo; "cancel" volta.
ipcMain.handle("mess:shutdown-decision", async (_e, action: "background" | "all" | "cancel") => {
  if (action === "cancel") return;
  if (action === "all") { try { await stopRuntime(true); } catch { /* segue fechando mesmo assim */ } }
  allowClose = true;
  mainWin?.close();
});

app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");

app.whenReady().then(() => {
  // Janela primeiro (aparece na hora); runtime garantido em paralelo. O mess:connection aguarda runtimeReady.
  runtimeReady = ensureRuntime().catch((e) => { console.error(e); });
  createWindow();
  // Auto-update (só no app empacotado): checa o GitHub releases e baixa em segundo plano.
  // Tolerante: aceita pré-lançamento, não deixa logs barulhentos, e NUNCA derruba/suja o console
  // quando não há release estável ou falta o latest-linux.yml (ex.: 406 "find latest version").
  if (app.isPackaged) {
    const up = electronUpdater.autoUpdater;
    up.allowPrerelease = true; // a v0.0.1 é pré-lançamento
    up.autoDownload = true;
    up.logger = null;
    up.on("error", () => { /* sem rede / sem release estável: ignorar silenciosamente */ });
    up.checkForUpdatesAndNotify().catch(() => { /* idem: nada a atualizar */ });
  }
});
app.on("window-all-closed", () => app.quit()); // o runtime continua vivo
// Ajuda de desenvolvimento: `kill -USR2 <pid>` traz a janela para frente.
process.on("SIGUSR2", () => { if (mainWin) { if (mainWin.isMinimized()) mainWin.restore(); mainWin.show(); mainWin.focus(); } });
