import { EventEmitter } from "node:events";
import * as pty from "node-pty";
import xtermHeadless from "@xterm/headless";
const HeadlessTerminal = xtermHeadless.Terminal;
type HeadlessTerminal = InstanceType<typeof HeadlessTerminal>;
import type { Session } from "@messai/contracts";
import { decideLease, trimBuffer, tmuxSessionName, tmuxAttachPlan, type TerminalPlan, type Result, fail, succeed } from "@messai/domain";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import type { Store } from "@messai/storage";
import { nowIso } from "./config.js";

type Live = {
  proc: pty.IPty;
  term: HeadlessTerminal;
  chunks: string[];
  totalBytes: number;
  sequence: number;
  lease?: { clientId: string; expiresAt: string } | undefined;
};

export type SessionEvents = {
  output: [sessionId: string, sequence: number, data: string];
  session: [session: Session];
};

/** Dono dos PTYs. Nunca depende do cliente estar conectado. */
export class SessionManager extends EventEmitter<SessionEvents> {
  private live = new Map<string, Live>();

  constructor(private readonly store: Store) {
    super();
    // Sessões gravadas como running por um runtime anterior não existem mais neste processo,
    // exceto as persistentes (tmux), que o serviço tenta reanexar na subida.
    for (const s of store.listSessions()) {
      if ((s.state === "running" || s.state === "starting") && !s.persistent) store.updateSession(s.sessionId, { state: "lost", pid: null });
    }
  }

  /** Socket do servidor tmux do MessAI (tmux -L). Nunca toca no tmux pessoal do usuário. */
  tmuxSocket = process.env["MESS_TMUX_SOCKET"] ?? "mess";
  /** A sessão tmux correspondente ainda existe? */
  tmuxAlive(sessionId: string): boolean {
    try { execFileSync("tmux", ["-L", this.tmuxSocket, "has-session", "-t", tmuxSessionName(sessionId)], { stdio: "ignore" }); return true; } catch { return false; }
  }
  tmuxKill(sessionId: string): void {
    try { execFileSync("tmux", ["-L", this.tmuxSocket, "kill-session", "-t", tmuxSessionName(sessionId)], { stdio: "ignore" }); } catch { /* já não existe */ }
  }
  static tmuxAvailable(): boolean { try { execFileSync("tmux", ["-V"], { stdio: "ignore" }); return true; } catch { return false; } }

  get(sessionId: string): Session | undefined {
    const s = this.store.getSession(sessionId);
    if (!s) return undefined;
    const l = this.live.get(sessionId);
    return l?.lease ? { ...s, lease: l.lease } : s;
  }

  start(session: Session, plan: TerminalPlan): Session {
    // Persistente: se a sessão tmux ainda vive, só reanexa; o plano recebido já embrulha new-session -A para o caso novo.
    if (session.persistent && this.tmuxAlive(session.sessionId)) plan = tmuxAttachPlan(plan, tmuxSessionName(session.sessionId), this.tmuxSocket);
    // Diretório inexistente faria o pty falhar com "chdir(2) failed"; cai para o home e avisa.
    const wantedCwd = plan.cwd;
    const cwd = wantedCwd && existsSync(wantedCwd) ? wantedCwd : homedir();
    const proc = pty.spawn(plan.command, plan.args, {
      name: "xterm-256color",
      cols: session.cols,
      rows: session.rows,
      cwd,
      env: plan.env,
    });
    const term = new HeadlessTerminal({ cols: session.cols, rows: session.rows, scrollback: 2000, allowProposedApi: true });
    const live: Live = { proc, term, chunks: [], totalBytes: 0, sequence: 0 };
    this.live.set(session.sessionId, live);
    this.store.updateSession(session.sessionId, { state: "running", pid: proc.pid });
    if (cwd !== wantedCwd) {
      const warn = `\x1b[33m[MessAI] O diretório "${wantedCwd}" não existe; abrindo em ${cwd}.\x1b[0m\r\n`;
      live.sequence += 1; live.chunks.push(warn); live.totalBytes += Buffer.byteLength(warn); term.write(warn);
      this.emit("output", session.sessionId, live.sequence, warn);
    }

    proc.onData((data) => {
      live.sequence += 1;
      live.chunks.push(data);
      live.totalBytes += Buffer.byteLength(data);
      const t = trimBuffer(live.chunks, live.totalBytes);
      live.chunks = t.chunks;
      live.totalBytes = t.totalBytes;
      term.write(data);
      this.emit("output", session.sessionId, live.sequence, data);
    });
    proc.onExit(({ exitCode }) => {
      if (this.live.get(session.sessionId) !== live) return; // processo substituído (reatribuição de papel): ignora a saída do antigo
      this.store.updateSession(session.sessionId, { state: "exited", exitCode, pid: null });
      const s = this.store.getSession(session.sessionId);
      if (s) this.emit("session", s);
      // mantém buffer para leitura até o nó ser removido
      live.lease = undefined;
    });

    const s = this.store.getSession(session.sessionId)!;
    this.emit("session", s);
    return s;
  }

  /** Snapshot para reconexão: buffer acumulado e sequência atual. */
  snapshot(sessionId: string): { sequence: number; data: string } | undefined {
    const l = this.live.get(sessionId);
    if (!l) return undefined;
    return { sequence: l.sequence, data: l.chunks.join("") };
  }

  acquireLease(sessionId: string, clientId: string): Result<Session> {
    const l = this.live.get(sessionId);
    const s = this.get(sessionId);
    if (!l || !s) return fail("NOT_FOUND", "sessão não encontrada");
    const d = decideLease({ lease: l.lease }, clientId, new Date());
    if (d.kind === "denied") return fail("LEASE_HELD", `controlado por ${d.holder} até ${d.expiresAt}`);
    l.lease = { clientId, expiresAt: d.expiresAt };
    const out = this.get(sessionId)!;
    this.emit("session", out);
    return succeed(out);
  }

  releaseLease(sessionId: string, clientId: string): void {
    const l = this.live.get(sessionId);
    if (l?.lease?.clientId === clientId) {
      l.lease = undefined;
      const s = this.get(sessionId);
      if (s) this.emit("session", s);
    }
  }

  write(sessionId: string, clientId: string, data: string): Result<void> {
    const l = this.live.get(sessionId);
    const s = this.get(sessionId);
    if (!l || !s) return fail("NOT_FOUND", "sessão não encontrada");
    const ok = this.ensureLease(l, s, clientId);
    if (!ok.ok) return ok;
    l.proc.write(data);
    return succeed(undefined);
  }

  resize(sessionId: string, clientId: string, cols: number, rows: number): Result<void> {
    const l = this.live.get(sessionId);
    const s = this.get(sessionId);
    if (!l || !s) return fail("NOT_FOUND", "sessão não encontrada");
    const ok = this.ensureLease(l, s, clientId);
    if (!ok.ok) return ok;
    l.proc.resize(Math.max(2, cols), Math.max(1, rows));
    l.term.resize(Math.max(2, cols), Math.max(1, rows));
    this.store.updateSession(sessionId, { cols, rows });
    return succeed(undefined);
  }

  /**
   * Toma ou renova o lease se estiver livre/expirado; recusa só se outro cliente controla.
   * Evita "adquira o lease" depois de inatividade.
   */
  private ensureLease(l: Live, s: Session, clientId: string): Result<void> {
    const now = new Date();
    if (s.state !== "running") return fail("SESSION_NOT_RUNNING", `sessão está ${s.state}`);
    const d = decideLease({ lease: l.lease }, clientId, now);
    if (d.kind === "denied") return fail("LEASE_HELD", `controlado por outro cliente até ${d.expiresAt}`);
    const hadHolder = l.lease?.clientId;
    l.lease = { clientId, expiresAt: d.expiresAt };
    if (hadHolder !== clientId) { const out = this.get(s.sessionId); if (out) this.emit("session", out); }
    return succeed(undefined);
  }

  /** Escrita de sistema (entrega de mensagem): não exige lease. */
  deliver(sessionId: string, data: string): Result<void> {
    const l = this.live.get(sessionId); const s = this.get(sessionId);
    if (!l || !s) return fail("NOT_FOUND", "sessão não encontrada");
    if (s.state !== "running") return fail("SESSION_NOT_RUNNING", `sessão está ${s.state}`);
    l.proc.write(data);
    return succeed(undefined);
  }

  /** Parada explícita (diferente de fechar o painel). */
  stop(sessionId: string): Result<Session> {
    const l = this.live.get(sessionId);
    const s = this.get(sessionId);
    if (!s) return fail("NOT_FOUND", "sessão não encontrada");
    if (s.persistent) this.tmuxKill(sessionId); // parar = encerrar de verdade, também dentro do tmux
    if (l && s.state === "running") l.proc.kill();
    return succeed(s);
  }

  /** Encerra o PTY local; por padrão também mata a sessão tmux. `keepTmux` é usado no desligamento do runtime. */
  dispose(sessionId: string, keepTmux = false): void {
    const l = this.live.get(sessionId);
    if (!keepTmux && this.store.getSession(sessionId)?.persistent) this.tmuxKill(sessionId);
    if (l) {
      try { l.proc.kill(); } catch { /* já encerrado */ }
      l.term.dispose();
      this.live.delete(sessionId);
    }
  }

  shutdownAll(): void {
    // Sessões tmux continuam vivas: o próximo runtime reanexa.
    for (const id of [...this.live.keys()]) { const p = this.store.getSession(id)?.persistent; this.dispose(id, true); if (p) this.store.updateSession(id, { state: "starting", pid: null }); }
  }

  static blank(partial: Omit<Session, "state" | "createdAt" | "cols" | "rows"> & Partial<Pick<Session, "cols" | "rows">>): Session {
    return { state: "starting", createdAt: nowIso(), cols: partial.cols ?? 100, rows: partial.rows ?? 30, ...partial };
  }
}
