import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DATA_DIR = process.env["MESS_DATA_DIR"] ?? join(homedir(), ".messai");
const PORT = Number(process.env["MESS_PORT"] ?? 47821);
const BASE = `http://127.0.0.1:${PORT}`;
const here = fileURLToPath(new URL(".", import.meta.url));

function readToken(): string | undefined {
  const p = join(DATA_DIR, "runtime.token");
  return existsSync(p) ? readFileSync(p, "utf8").trim() : undefined;
}

async function healthy(): Promise<boolean> {
  const token = readToken();
  if (!token) return false;
  try {
    const r = await fetch(`${BASE}/v1/health`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(800) });
    return r.ok;
  } catch { return false; }
}

/** Sobe o runtime como processo independente (detached). Fechar o app não o encerra. */
async function ensureRuntime(): Promise<void> {
  if (await healthy()) return;
  // Se a unidade systemd --user estiver instalada, ela é a dona do runtime.
  if (process.platform === "linux" && existsSync(join(homedir(), ".config/systemd/user/messai-runtime.service"))) {
    try { execFileSync("systemctl", ["--user", "start", "messai-runtime.service"], { stdio: "ignore" }); } catch { /* cai para o spawn */ }
    for (let i = 0; i < 20; i++) { if (await healthy()) return; await new Promise((r) => setTimeout(r, 250)); }
  }
  // Empacotado: runtime é o bundle (resources/runtime.mjs) rodado com o Node do próprio Electron
  // (ELECTRON_RUN_AS_NODE) — os addons nativos ficam em resources/node_modules recompilados p/ a ABI do Electron.
  // Dev: runtime do dist, com o Node do sistema.
  const packaged = app.isPackaged;
  const entry = packaged ? join(process.resourcesPath, "runtime.mjs") : join(here, "../../../runtime/dist/index.js");
  const nodeBin = packaged ? process.execPath : (process.env["MESS_NODE"] ?? "node");
  const env: NodeJS.ProcessEnv = { ...process.env, MESS_DATA_DIR: DATA_DIR, MESS_PORT: String(PORT) };
  if (packaged) env["ELECTRON_RUN_AS_NODE"] = "1";
  mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  const log = openSync(join(DATA_DIR, "runtime.log"), "a");
  const child = spawn(nodeBin, [entry], { detached: true, stdio: ["ignore", log, log], env });
  child.unref();
  for (let i = 0; i < 40; i++) {
    if (await healthy()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("runtime não respondeu em 10 s");
}

let mainWin: BrowserWindow | null = null;
let runtimeReady: Promise<void> | null = null; // garantia do runtime, iniciada em paralelo à janela
function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400, height: 900, title: "MessAI",
    // Sem throttling em segundo plano: saída de terminal e animações do canvas continuam com a janela oculta/ocluída.
    webPreferences: { preload: join(here, "../preload/index.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
  });
  mainWin = win;
  win.webContents.on("console-message", (e) => {
    if (e.message.includes("ResizeObserver loop")) return; // ruído benigno do xterm/React Flow ao redimensionar
    console.log(`[renderer:${e.level}] ${e.message} (${e.sourceId}:${e.lineNumber})`);
  });
  win.webContents.on("preload-error", (_e, path, err) => console.error("preload-error", path, err));
  win.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: "deny" }; });
  if (process.env["ELECTRON_RENDERER_URL"]) void win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  else void win.loadFile(join(here, "../renderer/index.html"));
}

ipcMain.handle("mess:connection", async (event) => {
  // Só o renderer da nossa janela recebe a conexão.
  if (event.senderFrame?.url && !event.senderFrame.url.startsWith("file://") && !event.senderFrame.url.startsWith("http://localhost")) return null;
  // A janela já apareceu; aqui esperamos o runtime ficar pronto (token disponível) antes de conectar.
  if (runtimeReady) await runtimeReady;
  return { baseUrl: BASE, wsUrl: `ws://127.0.0.1:${PORT}/v1/ws`, token: readToken() ?? "", homeDir: homedir() };
});

ipcMain.handle("mess:pickDirectory", async () => {
  const r = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
  return r.canceled ? null : (r.filePaths[0] ?? null);
});

app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");

app.whenReady().then(() => {
  // Janela primeiro (aparece na hora); runtime garantido em paralelo. O mess:connection aguarda runtimeReady.
  runtimeReady = ensureRuntime().catch((e) => { console.error(e); });
  createWindow();
});
app.on("window-all-closed", () => app.quit()); // o runtime continua vivo
// Ajuda de desenvolvimento: `kill -USR2 <pid>` traz a janela para frente.
process.on("SIGUSR2", () => { if (mainWin) { if (mainWin.isMinimized()) mainWin.restore(); mainWin.show(); mainWin.focus(); } });
