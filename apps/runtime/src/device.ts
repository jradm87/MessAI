import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { androidInputText, androidKey, isAdbSerial, isAndroidActivity, isAndroidPackage, isAvdName, parseAdbDevices, parseAndroidFocus, parseAndroidPackages, parseUiDump, parseWmSize, pngSize } from "@messai/domain";
import type { DeviceInfo, DeviceList, DeviceState, DeviceUiTree } from "@messai/contracts";
import { whichOnPath } from "./providers.js";

/**
 * #73 — Portais de dispositivo: Android/emulador dirigido pelo RUNTIME via adb. Só ações ESTRUTURADAS (toque, swipe, tecla, texto, abrir/parar app,
 * árvore de acessibilidade, captura): nenhum `adb shell` livre é exposto a agentes, e tudo que vai ao shell do aparelho é validado/escapado.
 * Quadros: `screencap -p` adaptativo (~1,5 fps com atividade, mais lento parado) — só roda enquanto alguém assiste.
 */
const SDK_ROOTS = (): string[] => [process.env["ANDROID_SDK_ROOT"], process.env["ANDROID_HOME"], join(homedir(), "Android", "Sdk")].filter((p): p is string => !!p);
export function findAdb(): string | null {
  const env = process.env["MESS_ADB"]; if (env) return existsSync(env) ? env : null;
  const p = whichOnPath("adb"); if (p) return p;
  for (const r of SDK_ROOTS()) { const c = join(r, "platform-tools", "adb"); if (existsSync(c)) return c; }
  return null;
}
export function findEmulator(): string | null {
  const env = process.env["MESS_EMULATOR"]; if (env) return existsSync(env) ? env : null;
  const p = whichOnPath("emulator"); if (p) return p;
  for (const r of SDK_ROOTS()) { const c = join(r, "emulator", "emulator"); if (existsSync(c)) return c; }
  return null;
}
export function findScrcpy(): string | null {
  const env = process.env["MESS_SCRCPY"]; if (env) return existsSync(env) ? env : null;
  return whichOnPath("scrcpy");
}

export type AdbResult = { status: number; stdout: Buffer; stderr: string };
export function runBin(bin: string, args: string[], opts: { timeoutMs?: number; maxBuffer?: number } = {}): Promise<AdbResult> {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: opts.timeoutMs ?? 20_000, maxBuffer: opts.maxBuffer ?? 64 * 1024 * 1024, encoding: "buffer" }, (err, stdout, stderr) => {
      const code = err ? (err as { code?: number | string }).code : 0;
      resolve({ status: typeof code === "number" ? code : err ? 1 : 0, stdout: Buffer.isBuffer(stdout) ? stdout : Buffer.from(String(stdout ?? "")), stderr: (Buffer.isBuffer(stderr) ? stderr.toString("utf8") : String(stderr ?? "")) + (err && typeof code !== "number" ? `\n${(err as Error).message}` : "") });
    });
  });
}
const text = (r: AdbResult): string => r.stdout.toString("utf8");

export async function listDevices(): Promise<DeviceList> {
  const adb = findAdb(); const emu = findEmulator();
  const avds = emu ? text(await runBin(emu, ["-list-avds"], { timeoutMs: 10_000 })).split("\n").map((s) => s.trim()).filter((s) => isAvdName(s)) : [];
  if (!adb) return { adb: false, adbError: "adb não encontrado (instale o Android platform-tools, defina ANDROID_SDK_ROOT ou MESS_ADB)", emulator: !!emu, devices: [], avds };
  const r = await runBin(adb, ["devices", "-l"], { timeoutMs: 15_000 });
  if (r.status !== 0) return { adb: true, adbError: (r.stderr || text(r)).trim().split("\n").slice(-1)[0] ?? "adb falhou", emulator: !!emu, devices: [], avds };
  return { adb: true, emulator: !!emu, devices: parseAdbDevices(text(r)) as DeviceInfo[], avds };
}

export type DeviceFrame = { mime: "image/png"; data: string; width: number; height: number };
export type DeviceHooks = { onFrame(f: DeviceFrame): void; onLost(reason: string): void };

/** Um dispositivo ligado (serial). Todas as ações passam por uma fila: a ordem de toques/teclas é a ordem em que chegaram. */
export class AdbDevice {
  width = 0; height = 0; model = ""; foreground: string | undefined;
  private chain: Promise<unknown> = Promise.resolve(); private loop: NodeJS.Timeout | null = null; private running = false; private closed = false;
  private lastHash = ""; private lastFrame: DeviceFrame | null = null; private activeUntil = 0; private fails = 0;
  constructor(private bin: string, readonly serial: string, private hooks: DeviceHooks) {}

  private adb(args: string[], o?: { timeoutMs?: number }): Promise<AdbResult> { return runBin(this.bin, ["-s", this.serial, ...args], o); }
  private queue<T>(fn: () => Promise<T>): Promise<T> { const p = this.chain.then(fn, fn); this.chain = p.catch(() => {}); return p; }

  /** Confere que o aparelho responde e lê modelo e tamanho da tela. */
  async probe(): Promise<void> {
    const st = await this.adb(["get-state"], { timeoutMs: 8000 });
    if (st.status !== 0 || text(st).trim() !== "device") throw new Error(`dispositivo ${this.serial} não está pronto (${(text(st) || st.stderr).trim().split("\n")[0] || "sem resposta"})`);
    const [m, wm] = await Promise.all([this.adb(["shell", "getprop", "ro.product.model"], { timeoutMs: 8000 }), this.adb(["shell", "wm", "size"], { timeoutMs: 8000 })]);
    this.model = text(m).trim(); const s = parseWmSize(text(wm)); if (s) { this.width = s.w; this.height = s.h; }
  }
  async screenshot(): Promise<{ png: Buffer; w: number; h: number }> {
    const r = await this.adb(["exec-out", "screencap", "-p"], { timeoutMs: 20_000 });
    let png = r.stdout; const at = png.indexOf(Buffer.from([0x89, 0x50, 0x4e, 0x47])); if (at > 0) png = png.subarray(at); // avisos do adb antes do PNG
    const sz = pngSize(png); if (r.status !== 0 || !sz) throw new Error(`captura de tela falhou${r.stderr ? `: ${r.stderr.trim().split("\n")[0]}` : ""}`);
    this.width = sz.w; this.height = sz.h; return { png, w: sz.w, h: sz.h };
  }

  // ---- stream adaptativo ----
  startLoop(): void { if (this.running || this.closed) return; this.running = true; this.activeUntil = Date.now() + 4000; void this.tick(); }
  stopLoop(): void { this.running = false; if (this.loop) clearTimeout(this.loop); this.loop = null; }
  /** Pede um quadro logo (depois de uma ação): vira modo rápido por alguns segundos. */
  kick(): void { this.activeUntil = Date.now() + 4000; if (!this.running) return; if (this.loop) { clearTimeout(this.loop); this.loop = setTimeout(() => void this.tick(), 120); } }
  replay(): void { if (this.lastFrame) this.hooks.onFrame(this.lastFrame); }
  private async tick(): Promise<void> {
    if (!this.running || this.closed) return;
    const t0 = Date.now();
    try {
      const s = await this.screenshot(); this.fails = 0;
      const h = createHash("md5").update(s.png).digest("hex");
      if (h !== this.lastHash) { this.lastHash = h; this.lastFrame = { mime: "image/png", data: s.png.toString("base64"), width: s.w, height: s.h }; this.hooks.onFrame(this.lastFrame); }
    } catch (e) {
      if (++this.fails >= 3) { this.stopLoop(); this.hooks.onLost(`perdi o dispositivo: ${(e as Error).message}`); return; }
    }
    if (!this.running) return;
    const gap = Date.now() < this.activeUntil ? 120 : 1200;
    this.loop = setTimeout(() => void this.tick(), Math.max(0, gap - (Date.now() - t0)));
  }

  // ---- entrada (sempre estruturada) ----
  private int(n: number): string { return String(Math.max(0, Math.round(n))); }
  private act(args: string[]): Promise<void> { return this.queue(async () => { const r = await this.adb(["shell", ...args], { timeoutMs: 15_000 }); if (r.status !== 0) throw new Error(`falhou: ${(text(r) || r.stderr).trim().split("\n")[0] || "erro do adb"}`); this.kick(); }); }
  tap(x: number, y: number): Promise<void> { return this.act(["input", "tap", this.int(x), this.int(y)]); }
  longpress(x: number, y: number, ms = 800): Promise<void> { return this.act(["input", "swipe", this.int(x), this.int(y), this.int(x), this.int(y), String(ms)]); }
  swipe(x1: number, y1: number, x2: number, y2: number, ms = 300): Promise<void> { return this.act(["input", "swipe", this.int(x1), this.int(y1), this.int(x2), this.int(y2), String(ms)]); }
  key(name: string): Promise<void> { const k = androidKey(name); if (!k) return Promise.reject(new Error(`tecla desconhecida: ${name}`)); return this.act(["input", "keyevent", k]); }
  typeText(t: string): Promise<void> { const e = androidInputText(t); if (!e.ok) return Promise.reject(new Error(e.reason)); return this.act(["input", "text", e.arg]); }
  launch(pkg: string, activity?: string): Promise<void> {
    if (!isAndroidPackage(pkg)) return Promise.reject(new Error(`pacote inválido: ${pkg}`));
    if (activity !== undefined) { if (!isAndroidActivity(activity)) return Promise.reject(new Error(`atividade inválida: ${activity}`)); return this.act(["am", "start", "-n", `${pkg}/${activity.startsWith(".") || activity.includes(".") ? activity : `.${activity}`}`]); }
    return this.act(["monkey", "-p", pkg, "-c", "android.intent.category.LAUNCHER", "1"]);
  }
  stopApp(pkg: string): Promise<void> { if (!isAndroidPackage(pkg)) return Promise.reject(new Error(`pacote inválido: ${pkg}`)); return this.act(["am", "force-stop", pkg]); }

  // ---- leitura ----
  async uiTree(): Promise<DeviceUiTree> {
    for (let attempt = 0; attempt < 2; attempt++) { // o dump falha às vezes com animação ("could not get idle state")
      const r = await this.queue(() => this.adb(["exec-out", "uiautomator", "dump", "/dev/tty"], { timeoutMs: 25_000 }));
      const out = text(r); if (out.includes("<hierarchy")) { const t = parseUiDump(out); return { nodes: t.nodes, truncated: t.truncated }; }
      if (attempt === 1) throw new Error(`não consegui ler a tela (uiautomator): ${out.trim().split("\n")[0] || r.stderr.trim() || "sem resposta"}`);
      await new Promise((res) => setTimeout(res, 600));
    }
    throw new Error("uiautomator indisponível");
  }
  async apps(): Promise<string[]> { return parseAndroidPackages(text(await this.adb(["shell", "pm", "list", "packages", "-3"], { timeoutMs: 15_000 }))); }
  async refreshForeground(): Promise<string | undefined> { this.foreground = parseAndroidFocus(text(await this.adb(["shell", "dumpsys", "window"], { timeoutMs: 10_000 }))); return this.foreground; }
  async emuKill(): Promise<void> { await this.adb(["emu", "kill"], { timeoutMs: 10_000 }); }
  close(): void { this.closed = true; this.stopLoop(); }
}

type Entry = { dev?: AdbDevice | undefined; starting?: Promise<void> | undefined; serial?: string | undefined; avd?: string | undefined; owned?: ChildProcess | undefined; watchers: Set<string>; error?: string | undefined; message?: string | undefined; model?: string | undefined; w: number; h: number; fg?: string | undefined; fgTimer?: NodeJS.Timeout | undefined };
export const DEVICE_MAX_LOOPS = 4;

/** Sessões por nó `device`: ligar a um aparelho já conectado ou iniciar um AVD; ffluxo de quadros só enquanto há observadores. */
export class DeviceManager {
  private entries = new Map<string, Entry>();
  constructor(private hooks: { onState(nodeId: string, s: DeviceState): void; onFrame(nodeId: string, f: DeviceFrame): void; onBound(nodeId: string, sel: { serial?: string; avd?: string }): void }) {}
  private entry(id: string): Entry { let e = this.entries.get(id); if (!e) { e = { watchers: new Set(), w: 0, h: 0 }; this.entries.set(id, e); } return e; }
  state(nodeId: string, saved: { serial?: string; avd?: string } = {}): DeviceState {
    const e = this.entries.get(nodeId); const base = { nodeId, watchers: e?.watchers.size ?? 0, width: e?.w ?? 0, height: e?.h ?? 0 };
    const serial = e?.serial ?? saved.serial; const avd = e?.avd ?? saved.avd;
    const extra = { ...(serial ? { serial } : {}), ...(avd ? { avd } : {}), ...(e?.model ? { model: e.model } : {}), ...(e?.fg ? { foreground: e.fg } : {}), ...(e?.message ? { message: e.message } : {}) };
    if (e?.dev) return { ...base, status: "connected", ...extra };
    if (e?.starting) return { ...base, status: "starting", ...extra };
    return { ...base, status: e?.error ? "error" : "stopped", ...extra, ...(e?.error ? { error: e.error } : {}) };
  }
  private publish(id: string, saved?: { serial?: string; avd?: string }): void { this.hooks.onState(id, this.state(id, saved)); }
  peek(nodeId: string): AdbDevice | undefined { return this.entries.get(nodeId)?.dev; }
  isOwned(nodeId: string): boolean { return !!this.entries.get(nodeId)?.owned; }

  /** Liga o nó a um aparelho já conectado. */
  async select(nodeId: string, serial: string, avd?: string): Promise<void> {
    if (!isAdbSerial(serial)) throw new Error("serial inválido");
    const adb = findAdb(); if (!adb) throw new Error("adb não encontrado (instale o Android platform-tools ou defina ANDROID_SDK_ROOT/MESS_ADB)");
    const e = this.entry(nodeId); e.dev?.close(); e.dev = undefined; delete e.error; delete e.message; e.serial = serial; if (avd) e.avd = avd;
    const dev = new AdbDevice(adb, serial, { onFrame: (f) => this.hooks.onFrame(nodeId, f), onLost: (reason) => { const en = this.entries.get(nodeId); if (en) { en.dev?.close(); en.dev = undefined; en.error = reason; } this.publish(nodeId); } });
    try { await dev.probe(); } catch (err) { e.error = (err as Error).message; this.publish(nodeId); throw err; }
    e.dev = dev; e.model = dev.model; e.w = dev.width; e.h = dev.height;
    this.hooks.onBound(nodeId, { serial, ...(e.avd ? { avd: e.avd } : {}) });
    if (e.watchers.size) this.startLoop(nodeId);
    this.publish(nodeId); void dev.refreshForeground().then((fg) => { e.fg = fg; this.publish(nodeId); }).catch(() => {});
  }

  /** Inicia o emulador (ou reaproveita um já rodando com o mesmo AVD) e liga o nó quando o Android termina de subir. */
  async boot(nodeId: string, avd: string, persist = false): Promise<void> {
    if (!isAvdName(avd)) throw new Error("nome de AVD inválido");
    const adb = findAdb(); const emu = findEmulator();
    if (!adb) throw new Error("adb não encontrado (instale o Android platform-tools ou defina ANDROID_SDK_ROOT/MESS_ADB)");
    if (!emu) throw new Error("emulador Android não encontrado (instale o Android emulator ou defina ANDROID_SDK_ROOT/MESS_EMULATOR)");
    const e = this.entry(nodeId); if (e.starting) return e.starting;
    e.avd = avd; delete e.error;
    e.starting = (async () => {
      e.message = "procurando emulador…"; this.publish(nodeId);
      const avds = text(await runBin(emu, ["-list-avds"], { timeoutMs: 10_000 })).split("\n").map((s) => s.trim());
      if (!avds.includes(avd)) throw new Error(`AVD não encontrado: ${avd} (disponíveis: ${avds.filter(Boolean).join(", ") || "nenhum"})`);
      const have = parseAdbDevices(text(await runBin(adb, ["devices"], { timeoutMs: 10_000 }))).filter((d) => d.kind === "emulator");
      let serial: string | undefined;
      for (const d of have) { if (d.state !== "device") continue; const n = text(await runBin(adb, ["-s", d.serial, "emu", "avd", "name"], { timeoutMs: 8000 })).split("\n")[0]?.trim(); if (n === avd) { serial = d.serial; break; } }
      if (!serial) {
        const used = new Set(have.map((d) => Number(d.serial.replace("emulator-", ""))));
        let port = 5554; while (used.has(port) && port < 5586) port += 2; if (port >= 5586) throw new Error("sem porta livre para o emulador (5554–5584)");
        const args = ["-avd", avd, "-port", String(port), "-no-window", "-no-audio", "-no-snapshot", "-no-boot-anim", "-gpu", process.env["MESS_EMULATOR_GPU"] ?? "swiftshader_indirect", ...(persist ? [] : ["-read-only"])];
        const child = spawn(emu, args, { stdio: ["ignore", "pipe", "pipe"], detached: true });
        let tail = ""; for (const s of [child.stdout!, child.stderr!]) { s.setEncoding("utf8"); s.on("data", (d: string) => { tail = (tail + d).slice(-1200); }); }
        let exited = false; child.on("exit", () => { exited = true; if (this.entries.get(nodeId)?.owned === child) { const en = this.entries.get(nodeId)!; en.owned = undefined; } });
        e.owned = child; serial = `emulator-${port}`;
        e.message = "iniciando o emulador (pode levar 1–2 min)…"; this.publish(nodeId);
        const t0 = Date.now(); let ready = false;
        while (Date.now() - t0 < 240_000) {
          if (exited) throw new Error(`o emulador encerrou ao iniciar: ${tail.trim().split("\n").slice(-2).join(" | ")}`);
          const ds = parseAdbDevices(text(await runBin(adb, ["devices"], { timeoutMs: 10_000 })));
          if (ds.some((d) => d.serial === serial && d.state === "device") && text(await runBin(adb, ["-s", serial, "shell", "getprop", "sys.boot_completed"], { timeoutMs: 8000 })).trim() === "1") { ready = true; break; }
          await new Promise((r) => setTimeout(r, 2000));
        }
        if (!ready) { try { process.kill(-child.pid!, "SIGTERM"); } catch { /* */ } throw new Error("o emulador não terminou de iniciar em 4 min"); }
      }
      delete e.message; await this.select(nodeId, serial, avd);
    })().catch((err) => { e.error = (err as Error).message; delete e.message; this.publish(nodeId); throw err; }).finally(() => { e.starting = undefined; });
    this.publish(nodeId);
    return e.starting;
  }

  /** Relê o app em primeiro plano depois de uma ação (com debounce: várias ações seguidas = uma leitura). */
  refreshForeground(nodeId: string, delayMs = 700): void {
    const e = this.entries.get(nodeId); if (!e?.dev) return; if (e.fgTimer) clearTimeout(e.fgTimer);
    e.fgTimer = setTimeout(() => { const dev = e.dev; if (!dev) return; void dev.refreshForeground().then((fg) => { if (e.fg !== fg) { e.fg = fg; this.publish(nodeId); } }).catch(() => {}); }, delayMs);
    e.fgTimer.unref();
  }
  private startLoop(nodeId: string): void {
    const live = [...this.entries.values()].filter((x) => x.dev && x.watchers.size).length;
    const e = this.entries.get(nodeId); if (!e?.dev) return;
    if (live > DEVICE_MAX_LOOPS) return; // teto de capturas simultâneas
    e.dev.startLoop(); e.dev.replay();
  }
  /** Abre o scrcpy (janela nativa) conectado no serial deste nó — controle manual de verdade na MESMA sessão adb que a IA usa. */
  async scrcpy(nodeId: string): Promise<void> {
    const e = this.entries.get(nodeId); const serial = e?.dev?.serial ?? e?.serial;
    if (!serial) throw new Error("ligue o nó a um aparelho antes de abrir o scrcpy");
    const bin = findScrcpy(); if (!bin) throw new Error("scrcpy não encontrado (instale o pacote `scrcpy` ou defina MESS_SCRCPY)");
    const adb = findAdb(); // o scrcpy usa o MESMO adb do MessAI (via env ADB) → sem conflito de versão de adb server
    const child = spawn(bin, ["-s", serial, "--window-title", `MessAI · ${e?.model || serial}`], { detached: true, stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, ...(adb ? { ADB: adb } : {}) } });
    let tail = ""; child.stderr?.setEncoding("utf8"); child.stderr?.on("data", (d: string) => { tail = (tail + d).slice(-600); });
    // falha cedo (ex.: libav ausente) = reporta; se ficou de pé ~1s, deu certo e soltamos o processo
    const early = await new Promise<string | null>((res) => {
      const to = setTimeout(() => res(null), 1000);
      child.once("exit", (code) => { clearTimeout(to); res(code ? (tail.trim().split("\n").filter(Boolean).slice(-1)[0] || `scrcpy encerrou (código ${code})`) : null); });
      child.once("error", (err: Error) => { clearTimeout(to); res(err.message); });
    });
    if (early) throw new Error(`scrcpy falhou: ${early}`);
    child.unref();
  }
  watch(nodeId: string, key: string): void { const e = this.entry(nodeId); e.watchers.add(key); this.startLoop(nodeId); this.publish(nodeId); }
  unwatch(nodeId: string, key: string): void { const e = this.entries.get(nodeId); if (!e) return; e.watchers.delete(key); if (!e.watchers.size) e.dev?.stopLoop(); this.publish(nodeId); }
  disconnect(nodeId: string): void { const e = this.entries.get(nodeId); if (!e) return; e.dev?.close(); e.dev = undefined; delete e.error; delete e.message; this.publish(nodeId); }
  /** Encerra o emulador — só se foi iniciado por este runtime (nunca o aparelho/emulador do usuário). */
  async shutdown(nodeId: string): Promise<void> {
    const e = this.entries.get(nodeId); if (!e?.owned) throw new Error("só emuladores iniciados por este app podem ser encerrados por aqui");
    const dev = e.dev; const child = e.owned; this.disconnect(nodeId);
    if (dev) await dev.emuKill().catch(() => {});
    for (let i = 0; i < 40 && child.exitCode === null && child.signalCode === null; i++) await new Promise((r) => setTimeout(r, 500));
    if (child.exitCode === null && child.signalCode === null) { try { process.kill(-child.pid!, "SIGKILL"); } catch { /* */ } }
    e.owned = undefined; this.publish(nodeId);
  }
  /** Apagar o nó: solta o aparelho; o emulador que NÓS iniciamos é encerrado junto (não deixa 2 GB de RAM órfãos). */
  async close(nodeId: string): Promise<void> { const e = this.entries.get(nodeId); if (!e) return; if (e.owned) await this.shutdown(nodeId).catch(() => {}); e.dev?.close(); this.entries.delete(nodeId); this.hooks.onState(nodeId, { nodeId, status: "stopped", watchers: 0, width: 0, height: 0 }); }
  /** Desligamento do runtime: para os fluxos de captura. Emuladores iniciados por nós continuam (o nó guarda o AVD e reaproveita ao reabrir). */
  stopAllLoops(): void { for (const e of this.entries.values()) e.dev?.close(); }
}
