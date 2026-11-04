import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable, Writable } from "node:stream";
import { normalizePortalUrl, portalKey } from "@messai/domain";
import type { PortalInspect, PortalSnapshot, PortalState } from "@messai/contracts";
import { whichOnPath } from "./providers.js";

/**
 * #26 — Portais: um Chromium por portal, dirigido pelo RUNTIME via Chrome DevTools Protocol.
 * O CDP vai por PIPE (`--remote-debugging-pipe`, fds 3/4), nunca por porta TCP: uma porta de debug em 127.0.0.1 seria alcançável por qualquer
 * processo local — inclusive um agente isolado com rede do host — que poderia dirigir o navegador e ler arquivos. Perfil efêmero (sem
 * cookies/senhas do usuário), só http/https, downloads negados, pop-ups viram navegação na própria aba.
 */
export const PORTAL_MAX_SESSIONS = 6;
export const PORTAL_IDLE_MS = 10 * 60_000;
const BROWSER_CANDIDATES = ["google-chrome-stable", "google-chrome", "chromium", "chromium-browser", "brave-browser", "microsoft-edge", "microsoft-edge-stable"];
export function findBrowser(): string | null {
  const env = process.env["MESS_BROWSER"]; if (env) return env;
  for (const c of BROWSER_CANDIDATES) { const p = whichOnPath(c); if (p) return p; }
  return null;
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };
/** Cliente CDP sobre pipe: mensagens JSON terminadas em NUL. */
class CdpPipe {
  private id = 0; private pending = new Map<number, Pending>(); private buf = ""; private fn: (method: string, params: any, sessionId?: string) => void = () => {};
  constructor(private out: Writable, input: Readable) {
    input.setEncoding("utf8");
    input.on("data", (d: string) => { this.buf += d; for (;;) { const i = this.buf.indexOf("\0"); if (i < 0) break; const m = this.buf.slice(0, i); this.buf = this.buf.slice(i + 1); if (m) this.handle(m); } });
  }
  onEvent(fn: (method: string, params: any, sessionId?: string) => void): void { this.fn = fn; }
  private handle(raw: string): void {
    let m: { id?: number; result?: unknown; error?: { message: string }; method?: string; params?: unknown; sessionId?: string };
    try { m = JSON.parse(raw); } catch { return; }
    if (m.id !== undefined) { const p = this.pending.get(m.id); if (!p) return; this.pending.delete(m.id); clearTimeout(p.timer); if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result); return; }
    if (m.method) this.fn(m.method, m.params ?? {}, m.sessionId);
  }
  send<T = any>(method: string, params: Record<string, unknown> = {}, sessionId?: string, timeoutMs = 15_000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = ++this.id;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP ${method}: tempo esgotado`)); }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      try { this.out.write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`); } catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e as Error); }
    });
  }
  failAll(reason: string): void { for (const [id, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error(reason)); this.pending.delete(id); } }
}

const SNAPSHOT_JS = String.raw`(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; const s = getComputedStyle(e); return s.visibility !== 'hidden' && s.display !== 'none' && parseFloat(s.opacity) !== 0; };
  const sel = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=checkbox],[role=tab],[role=menuitem],[onclick],[contenteditable=""],[contenteditable=true],[tabindex]:not([tabindex="-1"])';
  const out = []; const refs = [];
  for (const e of document.querySelectorAll(sel)) {
    if (out.length >= 300) break; if (!vis(e)) continue;
    const r = e.getBoundingClientRect();
    const name = String(e.getAttribute('aria-label') || e.innerText || e.value || e.placeholder || e.title || e.alt || '').trim().replace(/\s+/g, ' ').slice(0, 120);
    refs.push(e);
    const o = { ref: refs.length - 1, tag: e.tagName.toLowerCase(), name, rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } };
    if (e.getAttribute('role')) o.role = e.getAttribute('role');
    if (e.type) o.type = e.type;
    if (e.href) o.href = e.href;
    if (typeof e.value === 'string' && e.type !== 'password') o.value = e.value.slice(0, 120);
    out.push(o);
  }
  window.__messRefs = refs;
  const full = document.body ? document.body.innerText : '';
  return { url: location.href, title: document.title, text: full.slice(0, 30000), elements: out, truncated: full.length > 30000 };
})()`;
/** window.open e links target=_blank abrem na própria aba do portal (não existe "outra aba" para o usuário nem para o agente). */
const SAME_TAB_JS = String.raw`(() => {
  const open = (u) => { if (u) location.href = String(u); return window; };
  try { Object.defineProperty(window, 'open', { value: open, configurable: true, writable: true }); } catch (e) { window.open = open; }
  document.addEventListener('click', (ev) => { const a = ev.target && ev.target.closest ? ev.target.closest('a[target]') : null; if (a && a.target && a.target !== '_self' && a.target !== '_top') a.target = '_self'; }, true);
})();`;
const REF_CENTER_JS = (ref: number): string => `(() => { const e = window.__messRefs && window.__messRefs[${ref}]; if (!e || !e.isConnected) return null; e.scrollIntoView({ block: 'center', inline: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`;
const INSPECT_JS = (x: number, y: number): string => String.raw`((x, y) => {
  const e = document.elementFromPoint(x, y); if (!e) return null;
  const path = (el) => { const parts = []; while (el && el.nodeType === 1 && parts.length < 6) { let p = el.tagName.toLowerCase(); if (el.id) { parts.unshift(p + '#' + CSS.escape(el.id)); break; } const sib = el.parentElement ? [...el.parentElement.children].filter((c) => c.tagName === el.tagName) : []; if (sib.length > 1) p += ':nth-of-type(' + (sib.indexOf(el) + 1) + ')'; parts.unshift(p); el = el.parentElement; } return parts.join(' > '); };
  const r = e.getBoundingClientRect();
  return { tag: e.tagName.toLowerCase(), selector: path(e), text: String(e.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 300), html: e.outerHTML.slice(0, 800), rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } };
})(${x}, ${y})`;

export type PortalLive = Pick<PortalState, "url" | "title" | "loading" | "canGoBack" | "canGoForward" | "width" | "height">;
export type PortalFrame = { data: string; width: number; height: number };
export type SessionHooks = { onState(s: PortalLive): void; onFrame(f: PortalFrame): void; onClosed(reason: string): void };

export class PortalSession {
  state: PortalLive; lastFrame: PortalFrame | null = null; lastActivity = Date.now();
  private cdp!: CdpPipe; private proc!: ChildProcess; private profile = ""; private sid = ""; private targetId = ""; private mainFrame = ""; private closed = false; private screencasting = false; private ready = false;
  private constructor(private hooks: SessionHooks, w: number, h: number) { this.state = { url: "about:blank", title: "", loading: false, canGoBack: false, canGoForward: false, width: w, height: h }; }

  static async launch(bin: string, w: number, h: number, hooks: SessionHooks): Promise<PortalSession> {
    const s = new PortalSession(hooks, w, h);
    s.profile = mkdtempSync(join(tmpdir(), "mess-portal-"));
    const args = [
      "--headless=new", "--remote-debugging-pipe", `--user-data-dir=${s.profile}`, `--window-size=${w},${h}`, "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--disable-sync",
      "--disable-background-networking", "--disable-component-update", "--password-store=basic", "--use-mock-keychain", "--hide-scrollbars", "--mute-audio", "--disable-dev-shm-usage", "about:blank",
    ];
    s.proc = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"], detached: true }); // grupo próprio: matar o grupo leva zygote/renderer/gpu junto (senão seguem escrevendo no perfil)
    let stderr = ""; s.proc.stderr!.setEncoding("utf8"); s.proc.stderr!.on("data", (d: string) => { stderr = (stderr + d).slice(-1500); });
    s.cdp = new CdpPipe(s.proc.stdio[3] as Writable, s.proc.stdio[4] as Readable);
    s.cdp.onEvent((m, p, sid) => s.onEvent(m, p, sid));
    s.proc.on("exit", (code) => s.shutdown(`o navegador encerrou (código ${code ?? "?"})${stderr.trim() ? `: ${stderr.trim().split("\n").slice(-2).join(" ")}` : ""}`));
    s.proc.on("error", (e) => s.shutdown(`não foi possível iniciar o navegador: ${e.message}`));
    try {
      await s.cdp.send("Target.setDiscoverTargets", { discover: true }, undefined, 20_000);
      const { targetInfos } = await s.cdp.send<{ targetInfos: { targetId: string; type: string }[] }>("Target.getTargets");
      let t = targetInfos.find((x) => x.type === "page")?.targetId;
      if (!t) t = (await s.cdp.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" })).targetId;
      s.targetId = t;
      s.sid = (await s.cdp.send<{ sessionId: string }>("Target.attachToTarget", { targetId: t, flatten: true })).sessionId;
      await Promise.all([s.p("Page.enable"), s.p("Runtime.enable"), s.cdp.send("Browser.setDownloadBehavior", { behavior: "deny" }).catch(() => {})]);
      await s.p("Page.addScriptToEvaluateOnNewDocument", { source: SAME_TAB_JS });
      await s.p("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
      const ft = await s.p<{ frameTree: { frame: { id: string } } }>("Page.getFrameTree"); s.mainFrame = ft.frameTree.frame.id; s.ready = true;
    } catch (e) { s.shutdown(`falha ao iniciar o portal: ${(e as Error).message}${stderr.trim() ? ` — ${stderr.trim().split("\n").slice(-1)[0]}` : ""}`); throw new Error(`falha ao iniciar o portal: ${(e as Error).message}${stderr.trim() ? ` — ${stderr.trim().split("\n").slice(-1)[0]}` : ""}`); }
    return s;
  }
  private p<T = any>(method: string, params: Record<string, unknown> = {}, timeoutMs?: number): Promise<T> { return this.cdp.send<T>(method, params, this.sid, timeoutMs); }
  private touch(): void { this.lastActivity = Date.now(); }
  private emit(): void { this.hooks.onState({ ...this.state }); }

  private onEvent(method: string, p: any, sid?: string): void {
    if (this.closed) return;
    if (!sid) {
      if (method === "Target.targetInfoChanged" && p.targetInfo?.targetId === this.targetId) { if (p.targetInfo.title !== this.state.title) { this.state.title = p.targetInfo.title ?? ""; this.emit(); } }
      else if (this.ready && method === "Target.targetCreated" && p.targetInfo?.type === "page" && p.targetInfo.targetId !== this.targetId) { void this.popup(p.targetInfo.targetId, p.targetInfo.url); }
      else if (method === "Target.targetCrashed" && p.targetId === this.targetId) this.shutdown("a página do portal travou (crash)");
      return;
    }
    if (sid !== this.sid) return;
    switch (method) {
      case "Page.frameStartedLoading": if (!p.frameId || p.frameId === this.mainFrame) { this.state.loading = true; this.emit(); } break;
      case "Page.frameStoppedLoading": if (!p.frameId || p.frameId === this.mainFrame) { this.state.loading = false; this.emit(); void this.refreshNav(); } break;
      case "Page.frameNavigated": if (!p.frame?.parentId) { this.mainFrame = p.frame.id; this.setUrl(p.frame.url); } break;
      case "Page.navigatedWithinDocument": this.setUrl(p.url); break;
      case "Page.javascriptDialogOpening": void this.p("Page.handleJavaScriptDialog", { accept: p.type === "alert" || p.type === "beforeunload" }).catch(() => {}); break; // nunca deixa a página presa num diálogo
      case "Page.screencastFrame": {
        const f: PortalFrame = { data: p.data, width: p.metadata?.deviceWidth ?? this.state.width, height: p.metadata?.deviceHeight ?? this.state.height };
        this.lastFrame = f; this.hooks.onFrame(f); void this.p("Page.screencastFrameAck", { sessionId: p.sessionId }).catch(() => {}); break;
      }
    }
  }
  private setUrl(url: string): void {
    // só http/https/about:blank: qualquer outra coisa (file:, chrome:, data:…) volta para o em branco
    if (url !== "about:blank" && !normalizePortalUrl(url).ok && !/^chrome-error:/.test(url)) { void this.p("Page.navigate", { url: "about:blank" }).catch(() => {}); return; }
    this.state.url = url; this.emit(); void this.refreshNav();
  }
  private async popup(targetId: string, url: string): Promise<void> {
    // o alvo nasce com URL vazia e navega em seguida: espera a URL real (até ~1,5 s) antes de fechar
    let u = url;
    for (let i = 0; i < 15 && (!u || u === "about:blank") && !this.closed; i++) { await new Promise((r) => setTimeout(r, 100)); const ti = await this.cdp.send<{ targetInfo?: { url?: string } }>("Target.getTargetInfo", { targetId }, undefined, 2000).catch(() => null); u = ti?.targetInfo?.url ?? ""; if (!ti) break; }
    await this.cdp.send("Target.closeTarget", { targetId }).catch(() => {});
    if (u && normalizePortalUrl(u).ok && u !== "about:blank") await this.p("Page.navigate", { url: u }).catch(() => {}); // target=_blank / window.open → na própria aba do portal
  }
  private async refreshNav(): Promise<void> {
    try {
      const h = await this.p<{ currentIndex: number; entries: unknown[] }>("Page.getNavigationHistory", {}, 5000);
      const back = h.currentIndex > 0, fwd = h.currentIndex < h.entries.length - 1;
      const ti = await this.cdp.send<{ targetInfo?: { title?: string } }>("Target.getTargetInfo", { targetId: this.targetId }, undefined, 5000).catch(() => null);
      const title = ti?.targetInfo?.title ?? this.state.title;
      if (back !== this.state.canGoBack || fwd !== this.state.canGoForward || title !== this.state.title) { this.state.canGoBack = back; this.state.canGoForward = fwd; this.state.title = title; this.emit(); }
    } catch { /* fechando */ }
  }

  private async untilLoaded(ms = 20_000): Promise<void> { await new Promise((r) => setTimeout(r, 60)); const t = Date.now(); while (this.state.loading && Date.now() - t < ms && !this.closed) await new Promise((r) => setTimeout(r, 80)); }
  async navigate(input: string): Promise<void> {
    this.touch(); const u = normalizePortalUrl(input); if (!u.ok) throw new Error(u.reason);
    const r = await this.p<{ errorText?: string }>("Page.navigate", { url: u.url }, 20_000);
    if (r.errorText) throw new Error(`não foi possível abrir a página: ${r.errorText}`);
    await this.untilLoaded();
  }
  async history(dir: -1 | 1): Promise<void> {
    this.touch(); const h = await this.p<{ currentIndex: number; entries: { id: number }[] }>("Page.getNavigationHistory"); const e = h.entries[h.currentIndex + dir];
    if (!e) throw new Error(dir < 0 ? "não há página anterior" : "não há página seguinte");
    await this.p("Page.navigateToHistoryEntry", { entryId: e.id }); await this.untilLoaded();
  }
  async reload(): Promise<void> { this.touch(); await this.p("Page.reload"); await this.untilLoaded(); }
  async evaluate(expression: string): Promise<unknown> {
    this.touch();
    const r = await this.p<{ result?: { value?: unknown }; exceptionDetails?: { text?: string; exception?: { description?: string } } }>("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, timeout: 10_000 }, 15_000);
    if (r.exceptionDetails) throw new Error(`erro no script: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? "exceção"}`);
    const v = r.result?.value; const s = JSON.stringify(v ?? null);
    if (s && s.length > 100_000) throw new Error("resultado grande demais (>100 KB); devolva só o que precisa");
    return v;
  }
  async snapshot(): Promise<PortalSnapshot> { return (await this.evaluate(SNAPSHOT_JS)) as PortalSnapshot; }
  async screenshot(): Promise<{ data: string; width: number; height: number }> { this.touch(); const r = await this.p<{ data: string }>("Page.captureScreenshot", { format: "png" }); return { data: r.data, width: this.state.width, height: this.state.height }; }
  private async mouseEv(type: "mouseMoved" | "mousePressed" | "mouseReleased", x: number, y: number, button: "left" | "right" | "none" = "left", clickCount = 1): Promise<void> {
    await this.p("Input.dispatchMouseEvent", { type, x, y, button, clickCount, buttons: type === "mousePressed" ? (button === "right" ? 2 : 1) : 0 });
  }
  async mouse(type: "move" | "down" | "up", x: number, y: number, button: "left" | "right" = "left", clickCount = 1): Promise<void> {
    this.touch(); if (type === "move") return this.mouseEv("mouseMoved", x, y, "none", 0);
    return this.mouseEv(type === "down" ? "mousePressed" : "mouseReleased", x, y, button, clickCount);
  }
  private async center(ref: number): Promise<{ x: number; y: number }> {
    const c = (await this.evaluate(REF_CENTER_JS(ref))) as { x: number; y: number } | null;
    if (!c) throw new Error(`elemento ${ref} não existe mais — faça um novo snapshot`);
    return c;
  }
  async click(o: { ref?: number | undefined; x?: number | undefined; y?: number | undefined; button?: "left" | "right" | undefined; double?: boolean | undefined }): Promise<void> {
    this.touch(); let x = o.x, y = o.y;
    if (o.ref !== undefined) { const c = await this.center(o.ref); x = c.x; y = c.y; }
    if (x === undefined || y === undefined) throw new Error("informe ref ou x e y");
    const b = o.button ?? "left"; const n = o.double ? 2 : 1;
    await this.mouseEv("mouseMoved", x, y, "none", 0);
    for (let i = 1; i <= n; i++) { await this.mouseEv("mousePressed", x, y, b, i); await this.mouseEv("mouseReleased", x, y, b, i); }
    await new Promise((r) => setTimeout(r, 80)); await this.untilLoaded(8000);
  }
  async key(name: string): Promise<void> {
    this.touch(); const k = portalKey(name); if (!k) throw new Error(`tecla desconhecida: ${name}`);
    const base = { key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk };
    await this.p("Input.dispatchKeyEvent", { type: k.text ? "keyDown" : "rawKeyDown", ...base, ...(k.text ? { text: k.text } : {}) });
    await this.p("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  }
  async type(o: { text: string; ref?: number | undefined; submit?: boolean | undefined; clear?: boolean | undefined }): Promise<void> {
    this.touch();
    if (o.ref !== undefined) {
      await this.center(o.ref);
      await this.evaluate(`(() => { const e = window.__messRefs[${o.ref}]; e.focus(); ${o.clear ? "if (typeof e.select === 'function') e.select(); else document.execCommand('selectAll');" : ""} return true; })()`);
    }
    if (o.text) await this.p("Input.insertText", { text: o.text }); else if (o.clear) await this.key("Backspace");
    if (o.submit) { await this.key("Enter"); await new Promise((r) => setTimeout(r, 80)); await this.untilLoaded(8000); }
  }
  async scroll(dx: number, dy: number, x?: number, y?: number): Promise<void> {
    this.touch(); await this.p("Input.dispatchMouseEvent", { type: "mouseWheel", x: x ?? this.state.width / 2, y: y ?? this.state.height / 2, deltaX: dx, deltaY: dy });
  }
  async waitForText(text: string, timeoutMs = 10_000): Promise<boolean> {
    this.touch(); const t = Date.now(); const q = JSON.stringify(text);
    while (Date.now() - t < timeoutMs && !this.closed) { if ((await this.evaluate(`document.body ? document.body.innerText.includes(${q}) : false`).catch(() => false)) === true) return true; await new Promise((r) => setTimeout(r, 200)); }
    return false;
  }
  async inspect(x: number, y: number): Promise<PortalInspect | null> { return (await this.evaluate(INSPECT_JS(x, y))) as PortalInspect | null; }
  async setViewport(w: number, h: number): Promise<void> {
    this.touch(); this.state.width = w; this.state.height = h;
    await this.p("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    if (this.screencasting) { await this.stopScreencast(); await this.startScreencast(); }
    this.emit();
  }
  async startScreencast(): Promise<void> {
    if (this.screencasting || this.closed) return; this.screencasting = true;
    await this.p("Page.startScreencast", { format: "jpeg", quality: 60, maxWidth: this.state.width, maxHeight: this.state.height, everyNthFrame: 1 }).catch(() => { this.screencasting = false; });
  }
  async stopScreencast(): Promise<void> { if (!this.screencasting) return; this.screencasting = false; await this.p("Page.stopScreencast").catch(() => {}); }

  get alive(): boolean { return !this.closed; }
  private shutdown(reason: string): void {
    if (this.closed) return; this.closed = true;
    this.cdp?.failAll(reason);
    const pid = this.proc?.pid;
    try { if (pid) process.kill(-pid, "SIGKILL"); else this.proc?.kill("SIGKILL"); } catch { try { this.proc?.kill("SIGKILL"); } catch { /* já morto */ } }
    try { if (this.profile) rmSync(this.profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 }); } catch { /* */ }
    this.hooks.onClosed(reason);
  }
  /** Mata já (síncrono): usado no desligamento do runtime, que tem teto de tempo. */
  killNow(): void { this.shutdown("runtime encerrando"); }
  async close(): Promise<void> {
    if (this.closed) return;
    await this.cdp.send("Browser.close", {}, undefined, 2000).catch(() => {});
    this.shutdown("portal fechado");
  }
}

type Entry = { session?: PortalSession | undefined; starting?: Promise<PortalSession> | undefined; watchers: Set<string>; error?: string | undefined; url: string; title: string; w: number; h: number };
/** Sessões por nó: criadas sob demanda (ao assistir ou ao agente agir), fechadas ao apagar o nó, ao ficar ocioso ou ao desligar. */
export class PortalManager {
  private entries = new Map<string, Entry>(); private reaper: NodeJS.Timeout;
  constructor(private hooks: { onState(nodeId: string, s: PortalState): void; onFrame(nodeId: string, f: PortalFrame): void; onUrl(nodeId: string, url: string): void }, private idleMs = PORTAL_IDLE_MS) {
    this.reaper = setInterval(() => void this.reap(), 30_000); this.reaper.unref();
  }
  private entry(nodeId: string): Entry { let e = this.entries.get(nodeId); if (!e) { e = { watchers: new Set(), url: "", title: "", w: 800, h: 600 }; this.entries.set(nodeId, e); } return e; }
  state(nodeId: string, initialUrl = ""): PortalState {
    const e = this.entries.get(nodeId); const s = e?.session;
    if (s?.alive) return { nodeId, status: "running", ...s.state, watchers: e!.watchers.size };
    if (e?.starting) return { nodeId, status: "starting", url: e.url || initialUrl, title: e.title, loading: true, canGoBack: false, canGoForward: false, width: e.w, height: e.h, watchers: e.watchers.size };
    return { nodeId, status: e?.error ? "error" : "stopped", url: e?.url || initialUrl, title: e?.title ?? "", loading: false, canGoBack: false, canGoForward: false, width: e?.w ?? 800, height: e?.h ?? 600, watchers: e?.watchers.size ?? 0, ...(e?.error ? { error: e.error } : {}) };
  }
  private publish(nodeId: string): void { this.hooks.onState(nodeId, this.state(nodeId)); }
  async ensure(nodeId: string, initialUrl: string): Promise<PortalSession> {
    const e = this.entry(nodeId);
    if (e.session?.alive) return e.session;
    if (e.starting) return e.starting;
    const live = [...this.entries.values()].filter((x) => x.session?.alive || x.starting).length;
    if (live >= PORTAL_MAX_SESSIONS) throw new Error(`limite de ${PORTAL_MAX_SESSIONS} portais abertos ao mesmo tempo — feche algum`);
    const bin = findBrowser();
    if (!bin) { e.error = "nenhum navegador encontrado (instale google-chrome/chromium ou defina MESS_BROWSER)"; this.publish(nodeId); throw new Error(e.error); }
    delete e.error;
    const startUrl = initialUrl || e.url; // a URL salva no nó (o onState abaixo sobrescreve e.url com about:blank logo no lançamento)
    if (startUrl) e.url = startUrl;
    let lastUrl = "";
    e.starting = PortalSession.launch(bin, e.w, e.h, {
      onState: (s) => { const en = this.entries.get(nodeId); if (en) { en.url = s.url; en.title = s.title; en.w = s.width; en.h = s.height; } this.publish(nodeId); if (s.url !== lastUrl && !s.loading && s.url !== "about:blank") { lastUrl = s.url; this.hooks.onUrl(nodeId, s.url); } },
      onFrame: (f) => this.hooks.onFrame(nodeId, f),
      onClosed: (reason) => { const en = this.entries.get(nodeId); if (en) { en.session = undefined; en.starting = undefined; if (reason !== "portal fechado") en.error = reason; } this.publish(nodeId); },
    }).then(async (s) => {
      e.session = s; e.starting = undefined; this.publish(nodeId);
      if (e.watchers.size) void s.startScreencast();
      if (startUrl && startUrl !== "about:blank") await s.navigate(startUrl).catch((err) => { e.error = String((err as Error).message); });
      return s;
    }).catch((err) => { e.starting = undefined; e.error = String((err as Error).message); this.publish(nodeId); throw err; });
    this.publish(nodeId);
    return e.starting;
  }
  peek(nodeId: string): PortalSession | undefined { const s = this.entries.get(nodeId)?.session; return s?.alive ? s : undefined; }
  async watch(nodeId: string, key: string, initialUrl: string): Promise<PortalSession> {
    const e = this.entry(nodeId); e.watchers.add(key);
    const s = await this.ensure(nodeId, initialUrl);
    await s.startScreencast(); if (s.lastFrame) this.hooks.onFrame(nodeId, s.lastFrame); this.publish(nodeId);
    return s;
  }
  unwatch(nodeId: string, key: string): void {
    const e = this.entries.get(nodeId); if (!e) return; e.watchers.delete(key);
    if (!e.watchers.size) void e.session?.stopScreencast();
    this.publish(nodeId);
  }
  /** Sem ninguém assistindo: não gasta CPU com screencast, mas a sessão continua para os agentes até ficar ociosa. */
  async close(nodeId: string): Promise<void> { const e = this.entries.get(nodeId); if (!e) return; const s = e.session; this.entries.delete(nodeId); await s?.close().catch(() => {}); this.hooks.onState(nodeId, { nodeId, status: "stopped", url: e.url, title: e.title, loading: false, canGoBack: false, canGoForward: false, width: e.w, height: e.h, watchers: 0 }); }
  killAllSync(): void { clearInterval(this.reaper); for (const [id, e] of this.entries) { e.session?.killNow(); this.entries.delete(id); } }
  async closeAll(): Promise<void> { clearInterval(this.reaper); await Promise.all([...this.entries.keys()].map((id) => this.close(id))); }
  private async reap(): Promise<void> { for (const [id, e] of this.entries) if (e.session?.alive && !e.watchers.size && Date.now() - e.session.lastActivity > this.idleMs) await this.close(id); }
  liveCount(): number { return [...this.entries.values()].filter((x) => x.session?.alive).length; }
}
