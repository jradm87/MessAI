import { AGENT_ENV, type TreeEntry, type FileContent, type FsOp, type SearchHit, type CreateFloor, type LandFloor, type LandResult, type Role, type CreateRole, type PatchRole, type ChatMessage, type SendChat, type Attachment, type CreateAttachment, type FileEntry, type Connection, type CreateConnection, type PatchConnection, type CreateDrawing, type PatchDrawing, type GroupDrawings, type CreateFolder, type CreateNode, type Drawing, type Folder, type Message, type PatchFolder, type SendMessage, type Sidebar, type CreateWorkspace, type Node, type PatchNode, type PatchWorkspace, type Session, type Workspace, type WorkspaceSnapshot, type TaskFinished, type TaskSummary } from "@messai/contracts";
import type { RuntimeSettings, PatchRuntimeSettings, PresetInput, Skill, CreateSkill, PatchSkill, FindHit, FindKind, NodeGroup, CreateNodeGroup, PatchNodeGroup, AttentionItem, Score, ScoreNode, SaveScore, PatchScore, PlaceScore, PlaceScoreResult } from "@messai/contracts";
import type { ChatAttachment, ExportAttachment, InstructionsStatus, InstructionFileInfo, PutInstructions, SyncInstructions } from "@messai/contracts";
import type { Band, CreateBand, PatchBand, AskBand, BandAnswer, BandAskResult, MaestroRecruit } from "@messai/contracts";
import type { FloorHookSection, FloorHooksConfig, PutFloorHooks, FloorHookStatus, FloorHooksState, RunFloorHookInput, StopFloorHookInput } from "@messai/contracts";
import { readProcTree } from "./procs.js";
import type { SessionProcs, KillProcInput } from "@messai/contracts";
import { listProviders } from "./providers.js";
import { probeAccounts } from "./accounts.js";
import { backupName, copyBackupFiles, dataStats, isBackupName, listBackups, validateBackup, validateMoveTarget, writeManifest, type BackupEntry } from "./data.js";
import { BUILD_VERSION } from "@messai/contracts";
import { defaultPresets, parsePresets, validatePresets, PRESETS_META_KEY } from "./presets.js";
import { applyRole, roleText, deriveNoteTitle, noteFileName, wrapInTmux, tmuxSessionName, slugify, floorGitPlan, parseMergeConflicts, safeRelPath, looksBinary, canMessage, checkRevision, formatDelivery, normalizeGeometry, planLocalTerminal, resolveNodeRef, validateNewNode, agentKind, agentResume, stripAnsi, fail, succeed, type Result, applySkills, skillsText, placeGeometries, connectionsWithin } from "@messai/domain";
import { randomUUID } from "node:crypto";
import { Companion } from "./companion.js";
import type { Store } from "@messai/storage";
import { EventEmitter } from "node:events";
import { newId, nowIso, type Config } from "./config.js";
import { dirname, join, delimiter, basename, extname, relative, isAbsolute, resolve } from "node:path";
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, realpathSync, readSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { execFile, execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
// Dev: CLI em apps/cli/bin. Empacotado: resources/cli (MESS_RESOURCES vem do main).
const CLI_DIR = process.env["MESS_RESOURCES"] ? join(process.env["MESS_RESOURCES"], "cli") : join(dirname(fileURLToPath(import.meta.url)), "../../cli/bin");
import { SessionManager } from "./sessions.js";
import { watch, type FSWatcher } from "chokidar";

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", pdf: "application/pdf", md: "text/markdown", markdown: "text/markdown", txt: "text/plain", json: "application/json", csv: "text/csv", html: "text/html", log: "text/plain", ts: "text/plain", js: "text/plain", py: "text/plain", sh: "text/plain", yml: "text/plain", yaml: "text/plain" };
export const mimeOf = (name: string): string => MIME[extname(name).slice(1).toLowerCase()] ?? "application/octet-stream";

export type ServiceEvents = { workspace: [snapshot: WorkspaceSnapshot]; message: [message: Message]; sidebar: [sidebar: Sidebar]; chat: [message: ChatMessage]; taskSummary: [summary: TaskSummary]; floorHook: [workspaceId: string, status: FloorHookStatus] };

export type AgentUsageLimit = { label: string; pct: number; resets: string };
export type AgentUsageItem = { id: string; label: string; available: boolean; note?: string; plan?: string; limits?: AgentUsageLimit[]; metrics: { label: string; value: string }[]; models: { name: string; input: number; output: number }[] };

/** Lê a credencial OAuth do Claude Code e pega os limites unificados (5h = sessão, 7d = semanal) dos cabeçalhos da API. */
async function fetchClaudeLimits(): Promise<{ plan?: string; limits: AgentUsageLimit[] } | null> {
  try {
    const cred = join(homedir(), ".claude", ".credentials.json");
    if (!existsSync(cred)) return null;
    const j = JSON.parse(readFileSync(cred, "utf8")) as { claudeAiOauth?: { accessToken?: string; expiresAt?: number; subscriptionType?: string } };
    const oauth = j.claudeAiOauth;
    if (!oauth?.accessToken) return null;
    if (oauth.expiresAt && oauth.expiresAt < Date.now()) return null; // token expirado; o Claude Code renova
    const plan = oauth.subscriptionType ? oauth.subscriptionType.charAt(0).toUpperCase() + oauth.subscriptionType.slice(1) : undefined;
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 8000);
    // count_tokens é gratuito e devolve os cabeçalhos de rate limit unificado
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: ctrl.signal,
      headers: { "authorization": `Bearer ${oauth.accessToken}`, "anthropic-version": "2023-06-01", "anthropic-beta": "oauth-2025-04-20", "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-haiku-4-5", max_tokens: 1, messages: [{ role: "user", content: "." }] }),
    }).catch(() => null);
    clearTimeout(t);
    if (!res) return plan ? { plan, limits: [] } : null;
    const h = res.headers;
    const num = (k: string) => { const v = Number(h.get(k)); return Number.isFinite(v) ? v : undefined; };
    const parse = (prefix: string, label: string): AgentUsageLimit | null => {
      const base = `anthropic-ratelimit-unified-${prefix}`;
      const status = h.get(`${base}-status`);
      const remaining = num(`${base}-remaining`);
      const limit = num(`${base}-limit`);
      const used = num(`${base}-used`);
      const util = num(`${base}-utilization`) ?? num(`${base}-percent`);
      const reset = h.get(`${base}-reset`);
      if (!status && limit === undefined && reset === null && used === undefined && util === undefined) return null;
      let pct = 0;
      if (util !== undefined) pct = util <= 1 ? util * 100 : util;
      else if (limit !== undefined && limit > 0 && remaining !== undefined) pct = (1 - remaining / limit) * 100;
      else if (limit !== undefined && limit > 0 && used !== undefined) pct = (used / limit) * 100;
      return { label, pct: Math.max(0, Math.min(100, Math.round(pct))), resets: reset ?? "" };
    };
    const limits = [parse("5h", "Session"), parse("7d", "Weekly")].filter((x): x is AgentUsageLimit => x !== null);
    return { ...(plan ? { plan } : {}), limits };
  } catch { return null; }
}

const execFileP = promisify(execFile);
/**
 * Roda um comando externo SEM bloquear o event loop (MESS-05), com timeout e teto de saída.
 * Nunca lança: devolve status + stdout (grep sai 1 sem resultado; git sai !=0 fora de repo).
 */
async function runCmd(cmd: string, args: string[], opts: { cwd?: string; timeoutMs: number; maxBuffer?: number }): Promise<{ status: number; stdout: string }> {
  try {
    const { stdout } = await execFileP(cmd, args, { cwd: opts.cwd, timeout: opts.timeoutMs, maxBuffer: opts.maxBuffer ?? 8 * 1024 * 1024, encoding: "utf8" });
    return { status: 0, stdout: String(stdout) };
  } catch (e) {
    const err = e as { code?: number | string; stdout?: string };
    return { status: typeof err.code === "number" ? err.code : 1, stdout: String(err.stdout ?? "") };
  }
}
/** Teto para operações git síncronas de andares (transacionais, raras): limita o pior caso em vez de travar indefinidamente. */
const GIT_SYNC_TIMEOUT_MS = 15_000;

export class WorkspaceService extends EventEmitter<ServiceEvents> {
  /** Companheiro (#66): resume turnos concluídos com modelo local; sem Ollama, fica quieto. */
  readonly companion: Companion;
  constructor(private readonly cfg: Config, private readonly store: Store, readonly sessions: SessionManager) {
    super();
    this.companion = new Companion({ enabled: cfg.companionEnabled, ollamaUrl: cfg.ollamaUrl, ollamaModel: cfg.ollamaModel });
    // #65 → #66: cada turno concluído de agente vira (quando há modelo) um resumo + próximo passo, fora do caminho de requisição.
    this.sessions.on("taskFinished", (ev) => { void this.companion.summarize(ev).then((s) => { if (s) this.emit("taskSummary", s); }); });
  }

  /** Resumo sob demanda do estado atual de um nó-terminal (mesmo caminho do automático). */
  async summarizeNode(nodeId: string): Promise<Result<TaskSummary>> {
    const node = this.store.getNode(nodeId);
    if (!node || node.kind !== "terminal" || !node.sessionId) return fail("NOT_FOUND", "terminal não encontrado");
    const s = this.store.getSession(node.sessionId);
    if (!s || s.state !== "running") return fail("SESSION_NOT_RUNNING", "o terminal não está rodando");
    const ev: TaskFinished = { sessionId: s.sessionId, nodeId, workspaceId: node.workspaceId, agentType: agentKind(s.command, s.args).agentType, at: nowIso(), screen: this.sessions.screen(s.sessionId) ?? "" };
    const sum = await this.companion.summarize(ev);
    if (!sum) return fail("UNSUPPORTED", "companheiro indisponível: sem modelo local (Ollama) respondendo");
    this.emit("taskSummary", sum);
    return succeed(sum);
  }

  snapshot(workspaceId: string): WorkspaceSnapshot | undefined {
    const workspace = this.store.getWorkspace(workspaceId);
    if (!workspace) return undefined;
    return { workspace, nodes: this.store.listNodes(workspaceId).map((n) => this.syncNoteFromDisk(n)), connections: this.store.listConnections(workspaceId), drawings: this.store.listDrawings(workspaceId), groups: this.store.listGroups(workspaceId), bands: this.listBands(workspaceId) };
  }

  // ---- notas em arquivo .md real ----
  private noteMtime = new Map<string, number>();
  private notesDir(workspaceId: string) { return join(this.cfg.dataDir, "notes", workspaceId); }
  private writeNoteFile(node: Node, content: string): void {
    if (!node.filePath) return;
    mkdirSync(dirname(node.filePath), { recursive: true });
    writeFileSync(node.filePath, content);
    try { this.noteMtime.set(node.nodeId, statSync(node.filePath).mtimeMs); } catch { /* ignorar */ }
  }
  /** Se o arquivo mudou fora do app (editor, agente), traz o conteúdo para o nó. */
  private syncNoteFromDisk(n: Node): Node {
    if (n.kind !== "note" || !n.filePath) return n;
    try {
      const m = statSync(n.filePath).mtimeMs; const last = this.noteMtime.get(n.nodeId);
      if (last !== undefined && m <= last) return n;
      const content = readFileSync(n.filePath, "utf8");
      this.noteMtime.set(n.nodeId, m);
      if (content === (n.content ?? "")) return n;
      const patch: Parameters<Store["updateNode"]>[1] = { content };
      if (this.store.isTitleAuto(n.nodeId)) { const t = deriveNoteTitle(content); if (t) patch.title = t; }
      this.store.updateNode(n.nodeId, patch);
      return this.store.getNode(n.nodeId)!;
    } catch { return n; }
  }
  private publish(workspaceId: string): WorkspaceSnapshot {
    const s = this.snapshot(workspaceId)!;
    this.emit("workspace", s);
    return s;
  }

  // ---- watch de arquivos de nota (editor/agente editou por fora → re-publica) ----
  private watcher: FSWatcher | null = null;
  private watchedNote = new Map<string, string>(); // filePath -> workspaceId
  private ensureWatcher(): FSWatcher {
    if (this.watcher) return this.watcher;
    const w = watch([], { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 } });
    const onChange = (path: string) => { const ws = this.watchedNote.get(path); if (ws && this.store.getWorkspace(ws)) { try { this.publish(ws); } catch { /* ignorar */ } } };
    w.on("change", onChange); w.on("unlink", onChange); w.on("error", () => {});
    this.watcher = w; return w;
  }
  private watchNote(filePath: string, workspaceId: string): void {
    if (this.watchedNote.get(filePath) === workspaceId) return;
    const fresh = !this.watchedNote.has(filePath);
    this.watchedNote.set(filePath, workspaceId);
    if (fresh) this.ensureWatcher().add(filePath);
  }
  private unwatchNote(filePath: string): void {
    if (!this.watchedNote.delete(filePath)) return;
    this.watcher?.unwatch(filePath);
  }
  /** Observa os arquivos de nota existentes (chamado na subida do runtime). */
  initNoteWatches(): void {
    for (const w of this.store.listWorkspaces()) for (const n of this.store.listNodes(w.workspaceId)) if (n.kind === "note" && n.filePath) this.watchNote(n.filePath, w.workspaceId);
  }
  async closeWatcher(): Promise<void> { await this.watcher?.close().catch(() => {}); this.watcher = null; }

  listWorkspaces(): Workspace[] { return this.store.listWorkspaces(); }
  sidebar(): Sidebar { return { folders: this.store.listFolders(), workspaces: this.store.listWorkspaces(), terminals: this.store.terminalCounts() }; }
  /** Emite a barra lateral para quem assina (lista, pastas, contagem de terminais). */
  publishSidebar(): void { this.emit("sidebar", this.sidebar()); }

  createWorkspace(input: CreateWorkspace): Result<Workspace> {
    if (input.folderId && !this.store.getFolder(input.folderId)) return fail("NOT_FOUND", "pasta não encontrada");
    const w: Workspace = {
      workspaceId: newId(), machineId: this.cfg.machineId, name: input.name, cwd: input.cwd,
      icon: input.icon ?? "folder", color: input.color ?? "#8a93a6", sortOrder: this.store.nextWorkspaceOrder(),
      revision: 0, createdAt: nowIso(), ...(input.folderId ? { folderId: input.folderId } : {}),
    };
    this.store.insertWorkspace(w);
    this.publishSidebar();
    return succeed(w);
  }

  /** Primeira vez (nenhum espaço): cria um padrão para o canvas não nascer vazio. */
  ensureDefaultWorkspace(): void {
    if (this.store.listWorkspaces().length > 0) return;
    const home = homedir();
    const r = this.createWorkspace({ name: basename(home) || "Pessoal", cwd: home });
    if (r.ok) console.log(`espaço padrão criado na primeira execução: ${r.value.name}`);
  }

  patchWorkspace(id: string, input: PatchWorkspace): Result<Workspace> {
    const w = this.store.getWorkspace(id);
    if (!w) return fail("NOT_FOUND", "espaço não encontrado");
    const rev = checkRevision(w, input.expectedRevision);
    if (!rev.ok) return rev;
    if (input.folderId && !this.store.getFolder(input.folderId)) return fail("NOT_FOUND", "pasta não encontrada");
    this.store.updateWorkspace(id, { name: input.name, cwd: input.cwd, icon: input.icon, color: input.color, folderId: input.folderId, sortOrder: input.sortOrder, status: input.status, statusText: input.statusText }, rev.value);
    const out = this.publish(id).workspace;
    this.publishSidebar();
    return succeed(out);
  }

  // ---- papéis (responsabilidades) ----
  listRoles(): Role[] { return this.store.listRoles(); }
  createRole(input: CreateRole): Result<Role> {
    if (this.store.findRoleByName(input.name)) return fail("CONFLICT", "já existe um papel com esse nome");
    const now = nowIso();
    const r: Role = { roleId: newId(), name: input.name.trim(), badge: (input.badge ?? input.name.trim().slice(0, 2)).toUpperCase(), instructions: input.instructions, createdAt: now, updatedAt: now };
    this.store.insertRole(r);
    return succeed(r);
  }
  patchRole(id: string, input: PatchRole): Result<Role> {
    if (!this.store.getRole(id)) return fail("NOT_FOUND", "papel não encontrado");
    const dup = input.name ? this.store.findRoleByName(input.name) : undefined;
    if (dup && dup.roleId !== id) return fail("CONFLICT", "já existe um papel com esse nome");
    this.store.updateRole(id, { name: input.name?.trim(), badge: input.badge?.toUpperCase(), instructions: input.instructions }, nowIso());
    return succeed(this.store.getRole(id)!);
  }
  deleteRole(id: string): Result<void> {
    if (!this.store.getRole(id)) return fail("NOT_FOUND", "papel não encontrado");
    const affected = this.store.nodesWithRole(id).map((n) => n.workspaceId);
    this.store.deleteRole(id);
    for (const w of new Set(affected)) this.publish(w);
    return succeed(undefined);
  }
  // ---- #57 skills ----
  listSkills(): Skill[] { return this.store.listSkills(); }
  createSkill(input: CreateSkill): Result<Skill> {
    if (this.store.findSkillByName(input.name)) return fail("CONFLICT", "já existe uma habilidade com esse nome");
    const now = nowIso();
    const k: Skill = { skillId: newId(), name: input.name.trim(), description: (input.description ?? "").trim(), instructions: input.instructions, createdAt: now, updatedAt: now };
    this.store.insertSkill(k);
    return succeed(k);
  }
  patchSkill(id: string, input: PatchSkill): Result<Skill> {
    if (!this.store.getSkill(id)) return fail("NOT_FOUND", "habilidade não encontrada");
    const dup = input.name ? this.store.findSkillByName(input.name) : undefined;
    if (dup && dup.skillId !== id) return fail("CONFLICT", "já existe uma habilidade com esse nome");
    this.store.updateSkill(id, { name: input.name?.trim(), description: input.description?.trim(), instructions: input.instructions }, nowIso());
    return succeed(this.store.getSkill(id)!);
  }
  deleteSkill(id: string): Result<void> {
    if (!this.store.getSkill(id)) return fail("NOT_FOUND", "habilidade não encontrada");
    const affected = this.store.deleteSkill(id);
    for (const w of new Set(affected.map((n) => n.workspaceId))) this.publish(w);
    return succeed(undefined);
  }
  /** Reatribui as habilidades de um terminal; se estiver rodando, reinicia só o processo (como o papel). */
  setNodeSkills(nodeId: string, skillIds: string[]): Result<Node> {
    const node = this.store.getNode(nodeId);
    if (!node || node.kind !== "terminal") return fail("NOT_FOUND", "nó terminal não encontrado");
    const ids = [...new Set(skillIds)];
    for (const id of ids) if (!this.store.getSkill(id)) return fail("NOT_FOUND", `habilidade não encontrada: ${id}`);
    this.store.setNodeSkills(nodeId, ids);
    const updated = this.store.getNode(nodeId)!;
    const s = node.sessionId ? this.store.getSession(node.sessionId) : undefined;
    if (s && s.state === "running") {
      const w = this.store.getWorkspace(node.workspaceId)!;
      this.sessions.dispose(s.sessionId);
      this.store.updateSession(s.sessionId, { state: "starting", exitCode: null, pid: null });
      this.sessions.start({ ...s, state: "starting" }, this.plan(w, updated, s));
    }
    this.publish(node.workspaceId);
    return succeed(updated);
  }
  // ---- #41 busca de texto (notas/textos e chats) ----
  findText(q: string, opt: { workspaceId?: string | undefined; kinds?: FindKind[] | undefined; limit?: number | undefined } = {}): FindHit[] {
    const kinds = opt.kinds; const wantText = !kinds || kinds.some((k) => k === "note" || k === "chat"); const wantNode = !kinds || kinds.includes("node");
    const textKinds = kinds?.filter((k): k is "note" | "chat" => k === "note" || k === "chat");
    const out: FindHit[] = [];
    if (wantNode && q.trim()) for (const n of this.store.searchNodeTitles(q.trim(), opt.limit ?? 30)) { if (opt.workspaceId && n.workspaceId !== opt.workspaceId) continue; out.push({ kind: "node", refId: n.nodeId, workspaceId: n.workspaceId, nodeId: n.nodeId, nodeTitle: n.title, title: n.title, snippet: `${n.kind} · ${this.store.getWorkspace(n.workspaceId)?.name ?? ""}` }); }
    if (wantText) out.push(...this.store.search(q, { ...opt, kinds: textKinds?.length ? textKinds : undefined }).map((r) => ({ kind: r.kind, refId: r.refId, workspaceId: r.workspaceId, nodeId: r.nodeId, nodeTitle: this.store.getNode(r.nodeId)?.title ?? "", title: r.title, snippet: r.snippet })));
    return out;
  }
  /** #69 quem espera você em todos os espaços: agente que concluiu (até ser visto), não-lidas, processos encerrados/perdidos. */
  attention(): AttentionItem[] {
    const out: AttentionItem[] = []; const wsName = (id: string) => this.store.getWorkspace(id)?.name ?? "";
    for (const a of this.sessions.awaitingList()) { const s = this.store.getSession(a.sessionId); const n = s && this.store.getNode(s.nodeId); if (n) out.push({ kind: "finished", nodeId: n.nodeId, workspaceId: n.workspaceId, workspaceName: wsName(n.workspaceId), title: n.title, at: a.at }); }
    for (const u of this.store.unreadAll()) { const n = this.store.getNode(u.nodeId); if (n) out.push({ kind: "unread", nodeId: n.nodeId, workspaceId: n.workspaceId, workspaceName: wsName(n.workspaceId), title: n.title, count: u.count }); }
    for (const s of this.store.listSessions()) { if (s.state !== "exited" && s.state !== "lost") continue; const n = this.store.getNode(s.nodeId); if (n && n.sessionId === s.sessionId) out.push({ kind: s.state, nodeId: n.nodeId, workspaceId: n.workspaceId, workspaceName: wsName(n.workspaceId), title: n.title }); }
    return out;
  }
  markSeen(nodeId: string): Result<{ cleared: boolean }> {
    const n = this.store.getNode(nodeId); if (!n) return fail("NOT_FOUND", "nó não encontrado");
    return succeed({ cleared: n.sessionId ? this.sessions.markSeen(n.sessionId) : false });
  }

  // ---- #62 dados ----
  dataInfo() { const st = dataStats(this.cfg.dataDir, this.cfg.dataDirSource); return { ...st, counts: this.store.counts(), backups: listBackups(st.backupsDir) }; }
  /** Backup consistente: VACUUM INTO (banco) + notas/provedores/identidade + manifesto. Destino padrão <dataDir>/backups. */
  createBackup(dir?: string): Result<BackupEntry> {
    const base = dir ? dir : join(this.cfg.dataDir, "backups");
    if (dir && !isAbsolute(dir)) return fail("INVALID", "pasta de destino precisa ser absoluta");
    const name = backupName(); const dest = join(base, name);
    try {
      mkdirSync(dest, { recursive: true, mode: 0o700 });
      this.store.backupTo(join(dest, "runtime.sqlite"));
      copyBackupFiles(this.cfg.dataDir, dest);
      const c = this.store.counts();
      writeManifest(dest, { createdAt: nowIso(), buildVersion: BUILD_VERSION, counts: { workspaces: c.workspaces, nodes: c.nodes, notes: c.notes }, source: this.cfg.dataDir });
    } catch (e) { try { rmSync(dest, { recursive: true, force: true }); } catch { /* */ } return fail("INTERNAL", `backup falhou: ${e instanceof Error ? e.message : String(e)}`); }
    const entry = listBackups(base).find((b) => b.name === name);
    return entry ? succeed(entry) : fail("INTERNAL", "backup criado mas não listado");
  }
  deleteBackup(name: string): Result<void> {
    if (!isBackupName(name)) return fail("INVALID", "nome de backup inválido");
    const p = join(this.cfg.dataDir, "backups", name);
    if (!existsSync(p)) return fail("NOT_FOUND", "backup não encontrado");
    rmSync(p, { recursive: true, force: true }); return succeed(undefined);
  }
  validateRestore(path: string): Result<{ path: string }> { const v = validateBackup(path); return v.ok ? succeed({ path }) : fail("INVALID", v.error); }
  validateMove(dir: string): Result<{ dir: string }> { const v = validateMoveTarget(this.cfg.dataDir, dir, this.cfg.dataDirSource); return v.ok ? succeed({ dir }) : fail("INVALID", v.error); }

  // ---- #38 provedores / #57 contas ----
  providers() { return listProviders(join(this.cfg.dataDir, "providers")); }
  accounts() { return { accounts: probeAccounts(homedir()) }; }

  /** Reatribui o papel de um terminal; se estiver rodando, reinicia só o processo (a sessão e o nó continuam). */
  setNodeRole(nodeId: string, roleId: string | null): Result<Node> {
    const node = this.store.getNode(nodeId);
    if (!node || node.kind !== "terminal") return fail("NOT_FOUND", "nó terminal não encontrado");
    if (roleId && !this.store.getRole(roleId)) return fail("NOT_FOUND", "papel não encontrado");
    this.store.setNodeRole(nodeId, roleId);
    const updated = this.store.getNode(nodeId)!;
    const s = node.sessionId ? this.store.getSession(node.sessionId) : undefined;
    if (s && s.state === "running") {
      const w = this.store.getWorkspace(node.workspaceId)!;
      this.sessions.dispose(s.sessionId);
      this.store.updateSession(s.sessionId, { state: "starting", exitCode: null, pid: null });
      this.sessions.start({ ...s, state: "starting" }, this.plan(w, updated, s));
    }
    this.publish(node.workspaceId);
    return succeed(updated);
  }
  /** Lê role.json em `<dir>/.messai/roles/<slug>/` (e `.maestri/roles/` por compatibilidade) e cria/atualiza papéis pelo nome. */
  discoverRoles(dir: string): Result<{ imported: Role[] }> {
    const imported: Role[] = [];
    for (const base of [".messai", ".maestri"]) {
      const root = join(dir, base, "roles");
      if (!existsSync(root)) continue;
      for (const e of readdirSync(root, { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        const f = join(root, e.name, "role.json");
        if (!existsSync(f)) continue;
        let j: { name?: unknown; badge?: unknown; instructions?: unknown; prompt?: unknown };
        try { j = JSON.parse(readFileSync(f, "utf8")) as typeof j; } catch { continue; }
        const name = typeof j.name === "string" ? j.name.trim() : e.name;
        const instructions = typeof j.instructions === "string" ? j.instructions : typeof j.prompt === "string" ? j.prompt : "";
        const badge = typeof j.badge === "string" ? j.badge.slice(0, 4) : undefined;
        const existing = this.store.findRoleByName(name);
        if (existing) { this.store.updateRole(existing.roleId, { instructions, badge }, nowIso()); imported.push(this.store.getRole(existing.roleId)!); }
        else { const r = this.createRole({ name, instructions, ...(badge ? { badge } : {}) }); if (r.ok) imported.push(r.value); }
      }
    }
    return succeed({ imported });
  }
  /** Grava o papel como role.json portátil em `<dir>/.messai/roles/<slug>/`. */
  exportRole(id: string, dir: string): Result<{ path: string }> {
    const r = this.store.getRole(id);
    if (!r) return fail("NOT_FOUND", "papel não encontrado");
    const slug = r.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || r.roleId.slice(0, 8);
    const d = join(dir, ".messai", "roles", slug);
    mkdirSync(d, { recursive: true });
    const path = join(d, "role.json");
    writeFileSync(path, JSON.stringify({ name: r.name, badge: r.badge, instructions: r.instructions }, null, 2) + "\n");
    return succeed({ path });
  }

  // ---- uso dos agentes (dados locais reais; cotas de plano não existem localmente) ----
  async agentUsage(): Promise<{ agents: AgentUsageItem[] }> {
    const agents: AgentUsageItem[] = [];
    const fmt = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n);
    const cf = join(homedir(), ".claude", "stats-cache.json");
    if (existsSync(cf)) {
      try {
        const d = JSON.parse(readFileSync(cf, "utf8")) as { totalSessions?: number; totalMessages?: number; firstSessionDate?: string; dailyActivity?: { toolCallCount?: number }[]; modelUsage?: Record<string, { inputTokens?: number; outputTokens?: number }> };
        const toolCalls = (d.dailyActivity ?? []).reduce((s, x) => s + (x.toolCallCount ?? 0), 0);
        const models = Object.entries(d.modelUsage ?? {}).map(([name, v]) => ({ name: name.replace(/-\d{8}$/, ""), input: v.inputTokens ?? 0, output: v.outputTokens ?? 0 })).sort((a, b) => b.output - a.output).slice(0, 4);
        agents.push({ id: "claude", label: "Claude Code", available: true, note: "Limites de plano não disponíveis localmente.",
          metrics: [
            { label: "Sessões", value: fmt(d.totalSessions ?? 0) },
            { label: "Mensagens", value: fmt(d.totalMessages ?? 0) },
            { label: "Ferramentas", value: fmt(toolCalls) },
            { label: "Desde", value: (d.firstSessionDate ?? "").slice(0, 10) || "—" },
          ], models });
        const lim = await fetchClaudeLimits();
        const a0 = agents[agents.length - 1]!;
        if (lim) { if (lim.plan) a0.plan = lim.plan; a0.limits = lim.limits; if (lim.limits.length) delete a0.note; }
      } catch { agents.push({ id: "claude", label: "Claude Code", available: false, note: "stats-cache.json ilegível.", metrics: [], models: [] }); }
    } else agents.push({ id: "claude", label: "Claude Code", available: false, note: "Sem ~/.claude/stats-cache.json.", metrics: [], models: [] });
    for (const p of this.providers().providers.filter((x) => x.id !== "claude"))
      agents.push({ id: p.id, label: p.label, available: false, note: p.path ? "Uso não exposto localmente por esta CLI." : "CLI não encontrada no PATH.", metrics: [], models: [] });
    return { agents };
  }

  // ---- chat por terminal ----
  postChat(nodeId: string, input: SendChat, defaultRole: ChatMessage["role"]): Result<ChatMessage> {
    const node = this.store.getNode(nodeId);
    if (!node) return fail("NOT_FOUND", "nó não encontrado");
    if (node.kind !== "terminal") return fail("INVALID", "chat só existe em terminais");
    const atts: ChatAttachment[] = [];
    for (const a of input.attachments ?? []) { const r = this.importChatAttachment(node.workspaceId, a.path, a.name); if (!r.ok) { for (const x of atts) { try { unlinkSync(x.path); } catch { /* já removido */ } } return r; } atts.push(r.value); }
    const m: ChatMessage = { chatId: newId(), workspaceId: node.workspaceId, nodeId, thread: input.thread ?? 1, role: defaultRole, text: input.text, createdAt: nowIso(), ...(atts.length ? { attachments: atts } : {}) };
    this.store.insertChat(m);
    this.emit("chat", m);
    return succeed(m);
  }

  // ---- #79 anexos do chat como cards ----
  private attachmentsDir(workspaceId: string): string { return join(this.cfg.dataDir, "attachments", workspaceId); }
  /** Copia um arquivo local para o diretório de anexos do espaço (o agente aponta o caminho; o original não é tocado). */
  private importChatAttachment(workspaceId: string, srcPath: string, name?: string): Result<ChatAttachment> {
    if (!isAbsolute(srcPath)) return fail("INVALID", `caminho do anexo precisa ser absoluto: ${srcPath}`);
    let st; try { st = statSync(srcPath); } catch { return fail("NOT_FOUND", `arquivo não encontrado: ${srcPath}`); }
    if (!st.isFile()) return fail("INVALID", `não é um arquivo: ${srcPath}`);
    if (st.size === 0) return fail("INVALID", `anexo vazio: ${srcPath}`);
    if (st.size > 25 * 1024 * 1024) return fail("INVALID", `anexo maior que 25 MB: ${srcPath}`);
    const id = newId(); const label = (name ?? basename(srcPath)).slice(0, 200);
    const dir = this.attachmentsDir(workspaceId); mkdirSync(dir, { recursive: true, mode: 0o700 });
    const dest = join(dir, `${id.slice(0, 8)}-${basename(label).replace(/[^\w.\-]+/g, "_").slice(0, 80) || "anexo"}`);
    try { copyFileSync(srcPath, dest); } catch (e) { return fail("INTERNAL", String((e as Error).message ?? e)); }
    return succeed({ attachmentId: id, name: label, path: dest, size: st.size, mime: mimeOf(label) });
  }
  /** Localiza um anexo e a mensagem dele; só serve arquivos dentro de <dados>/attachments. */
  chatAttachment(attachmentId: string): Result<{ att: ChatAttachment; msg: ChatMessage }> {
    const msg = this.store.getChatByAttachment(attachmentId);
    const att = msg?.attachments?.find((a) => a.attachmentId === attachmentId);
    if (!msg || !att) return fail("NOT_FOUND", "anexo não encontrado");
    const root = join(this.cfg.dataDir, "attachments") + "/";
    if (!resolve(att.path).startsWith(root)) return fail("FORBIDDEN", "anexo fora do diretório de anexos");
    return succeed({ att, msg });
  }
  deleteChatAttachment(attachmentId: string): Result<void> {
    const r = this.chatAttachment(attachmentId); if (!r.ok) return r;
    try { unlinkSync(r.value.att.path); } catch { /* já removido do disco */ }
    this.store.setChatAttachments(r.value.msg.chatId, (r.value.msg.attachments ?? []).filter((a) => a.attachmentId !== attachmentId));
    this.emit("chat", { chatId: newId(), workspaceId: r.value.msg.workspaceId, nodeId: r.value.msg.nodeId, thread: r.value.msg.thread, role: "system", text: "__cleared__", createdAt: nowIso() }); // a UI recarrega o chat
    return succeed(undefined);
  }
  /** Copia o anexo para uma pasta do espaço (arrastar para a árvore). Nome repetido ganha sufixo; nunca sobrescreve. */
  exportChatAttachment(attachmentId: string, input: ExportAttachment): Result<{ path: string }> {
    const r = this.chatAttachment(attachmentId); if (!r.ok) return r;
    const root = this.wsRoot(input.workspaceId); if (!root.ok) return root;
    const d = this.resolveIn(root.value, input.dir); if (!d.ok) return d;
    try {
      mkdirSync(d.value.abs, { recursive: true });
      if (!realpathSync(d.value.abs).startsWith(realpathSync(root.value))) return fail("FORBIDDEN", "destino fora do espaço");
      const base = (input.name ?? r.value.att.name).replace(/[\\/\0]+/g, "_") || "anexo";
      const ext = extname(base); const stem = ext ? base.slice(0, -ext.length) : base;
      let dest = join(d.value.abs, base);
      for (let i = 1; existsSync(dest); i++) dest = join(d.value.abs, `${stem}-${i}${ext}`);
      copyFileSync(r.value.att.path, dest);
      return succeed({ path: relative(root.value, dest) });
    } catch (e) { return fail("INTERNAL", String((e as Error).message ?? e)); }
  }
  listChat(nodeId: string, thread: number | undefined, limit: number, since?: string): Result<ChatMessage[]> {
    if (!this.store.getNode(nodeId)) return fail("NOT_FOUND", "nó não encontrado");
    return succeed(this.store.listChat(nodeId, thread, limit, since));
  }
  clearChat(nodeId: string, thread?: number): Result<{ removed: number }> {
    if (!this.store.getNode(nodeId)) return fail("NOT_FOUND", "nó não encontrado");
    const removed = this.store.clearChat(nodeId, thread);
    const sys: ChatMessage = { chatId: newId(), workspaceId: this.store.getNode(nodeId)!.workspaceId, nodeId, thread: thread ?? 1, role: "system", text: "__cleared__", createdAt: nowIso() };
    this.emit("chat", sys); // avisa a UI para recarregar, sem persistir
    return succeed({ removed });
  }

  // ---- #76 arquivos de instrução do projeto (CLAUDE.md / AGENTS.md) ----
  private readInstrFile(root: string, name: "CLAUDE.md" | "AGENTS.md"): InstructionFileInfo {
    const p = join(root, name);
    try {
      const st = statSync(p);
      if (!st.isFile()) return { name, exists: false, text: "" };
      return { name, exists: true, text: readFileSync(p, "utf8"), mtime: st.mtimeMs };
    } catch { return { name, exists: false, text: "" }; }
  }
  getInstructions(workspaceId: string): Result<InstructionsStatus> {
    const root = this.wsRoot(workspaceId); if (!root.ok) return root;
    const claude = this.readInstrFile(root.value, "CLAUDE.md");
    const agents = this.readInstrFile(root.value, "AGENTS.md");
    const status: InstructionsStatus["status"] = !claude.exists && !agents.exists ? "missing"
      : claude.exists && !agents.exists ? "only-claude"
      : !claude.exists && agents.exists ? "only-agents"
      : claude.text.replace(/\r\n/g, "\n").trim() === agents.text.replace(/\r\n/g, "\n").trim() ? "synced" : "diverged";
    return succeed({ status, claude, agents });
  }
  putInstructions(workspaceId: string, input: PutInstructions): Result<InstructionsStatus> {
    const root = this.wsRoot(workspaceId); if (!root.ok) return root;
    try {
      mkdirSync(root.value, { recursive: true });
      const targets: ("CLAUDE.md" | "AGENTS.md")[] = input.target === "both" ? ["CLAUDE.md", "AGENTS.md"] : [input.target];
      for (const t of targets) writeFileSync(join(root.value, t), input.text, "utf8");
    } catch (e) { return fail("INTERNAL", String((e as Error).message ?? e)); }
    return this.getInstructions(workspaceId);
  }
  syncInstructions(workspaceId: string, input: SyncInstructions): Result<InstructionsStatus> {
    const cur = this.getInstructions(workspaceId); if (!cur.ok) return cur;
    const src = input.direction === "claude-to-agents" ? cur.value.claude : cur.value.agents;
    const dst: "CLAUDE.md" | "AGENTS.md" = input.direction === "claude-to-agents" ? "AGENTS.md" : "CLAUDE.md";
    if (!src.exists) return fail("NOT_FOUND", `${src.name} não existe na raiz do espaço`);
    return this.putInstructions(workspaceId, { target: dst, text: src.text });
  }

  // ---- árvore de arquivos (confinada ao diretório do espaço) ----
  private wsRoot(workspaceId: string): Result<string> {
    const w = this.store.getWorkspace(workspaceId);
    return w ? succeed(w.cwd) : fail("NOT_FOUND", "espaço não encontrado");
  }
  private resolveIn(root: string, rel: string): Result<{ abs: string; rel: string }> {
    const r = safeRelPath(rel); if (!r.ok) return r;
    return succeed({ abs: r.value ? join(root, r.value) : root, rel: r.value });
  }
  /** Cache curto do `git status` por raiz: listagens repetidas (navegar pastas) não re-spawnam o git. */
  private gitStatusCache = new Map<string, { at: number; map: Map<string, string> }>();
  private async gitStatusMap(root: string): Promise<Map<string, string>> {
    const hit = this.gitStatusCache.get(root);
    if (hit && Date.now() - hit.at < 1500) return hit.map;
    const m = new Map<string, string>();
    const r = await runCmd("git", ["-C", root, "status", "--porcelain", "--untracked-files=all"], { timeoutMs: 4000 });
    if (r.status === 0) for (const line of r.stdout.split("\n")) { if (line.length < 4) continue; const code = line.slice(0, 2).trim() || "M"; const p = line.slice(3).split(" -> ").pop()!.trim(); m.set(p, code); let d = p; while (d.includes("/")) { d = d.slice(0, d.lastIndexOf("/")); if (!m.has(d)) m.set(d, "•"); } }
    this.gitStatusCache.set(root, { at: Date.now(), map: m }); // cacheia também o "não é git" para não martelar
    return m;
  }
  async listTree(workspaceId: string, rel: string): Promise<Result<TreeEntry[]>> {
    const root = this.wsRoot(workspaceId); if (!root.ok) return root;
    const p = this.resolveIn(root.value, rel); if (!p.ok) return p;
    let entries: import("node:fs").Dirent[];
    try { entries = readdirSync(p.value.abs, { withFileTypes: true }); } catch { return fail("NOT_FOUND", "diretório não encontrado"); }
    const git = await this.gitStatusMap(root.value);
    const out: TreeEntry[] = [];
    for (const e of entries) {
      if (e.name === ".git") continue; // metadados do git ficam fora da árvore
      const relPath = p.value.rel ? `${p.value.rel}/${e.name}` : e.name;
      let st: import("node:fs").Stats; try { st = statSync(join(p.value.abs, e.name)); } catch { continue; }
      const g = git.get(relPath);
      out.push({ name: e.name, path: relPath, dir: st.isDirectory(), size: st.isDirectory() ? 0 : st.size, mtime: st.mtime.toISOString(), ...(g ? { git: g } : {}) });
    }
    out.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
    return succeed(out);
  }
  readFile(workspaceId: string, rel: string): Result<FileContent> {
    const root = this.wsRoot(workspaceId); if (!root.ok) return root;
    const p = this.resolveIn(root.value, rel); if (!p.ok) return p;
    let st: import("node:fs").Stats; try { st = statSync(p.value.abs); } catch { return fail("NOT_FOUND", "arquivo não encontrado"); }
    if (st.isDirectory()) return fail("INVALID", "é um diretório");
    const LIMIT = 512 * 1024;
    const fd = openSync(p.value.abs, "r"); const buf = Buffer.alloc(Math.min(st.size, LIMIT)); const n = readSync(fd, buf, 0, buf.length, 0); closeSync(fd);
    const head = buf.subarray(0, n);
    if (looksBinary(head)) return succeed({ path: p.value.rel, size: st.size, binary: true, truncated: false });
    return succeed({ path: p.value.rel, size: st.size, binary: false, text: head.toString("utf8"), truncated: st.size > LIMIT });
  }
  fsOp(workspaceId: string, input: FsOp): Result<{ path: string }> {
    const root = this.wsRoot(workspaceId); if (!root.ok) return root;
    const p = this.resolveIn(root.value, input.path); if (!p.ok) return p;
    if (!p.value.rel && input.op !== "mkdir") return fail("INVALID", "operação na raiz não permitida");
    try {
      if (input.op === "mkdir") mkdirSync(p.value.abs, { recursive: true });
      else if (input.op === "touch") { if (existsSync(p.value.abs)) return fail("CONFLICT", "já existe"); mkdirSync(dirname(p.value.abs), { recursive: true }); writeFileSync(p.value.abs, ""); }
      else if (input.op === "write") { mkdirSync(dirname(p.value.abs), { recursive: true }); writeFileSync(p.value.abs, input.text ?? ""); }
      else if (input.op === "rename") { if (!input.to) return fail("INVALID", "destino obrigatório"); const t = this.resolveIn(root.value, input.to); if (!t.ok) return t; if (existsSync(t.value.abs)) return fail("CONFLICT", "destino já existe"); mkdirSync(dirname(t.value.abs), { recursive: true }); renameSync(p.value.abs, t.value.abs); return succeed({ path: t.value.rel }); }
      else if (input.op === "delete") rmSync(p.value.abs, { recursive: true, force: true });
    } catch (e) { return fail("INTERNAL", String((e as Error).message ?? e)); }
    return succeed({ path: p.value.rel });
  }
  /** Busca por nome (substring) ou, com `content`, por conteúdo (grep -rnI, até 200 linhas). */
  async searchFiles(workspaceId: string, q: string, content: boolean): Promise<Result<SearchHit[]>> {
    const root = this.wsRoot(workspaceId); if (!root.ok) return root;
    if (!q.trim()) return succeed([]);
    if (!content) {
      const SKIP = new Set([".git", "node_modules", "dist", "build", ".cache", ".venv", "__pycache__", "target", ".next"]);
      const out: SearchHit[] = []; let visited = 0; const needle = q.toLowerCase();
      const walk = (dir: string, rel: string, depth: number) => {
        if (out.length >= 200 || visited > 20000 || depth > 8) return;
        let es: import("node:fs").Dirent[] = []; try { es = readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of es) { visited++; const r = rel ? `${rel}/${e.name}` : e.name; if (e.isDirectory() && SKIP.has(e.name)) continue; if (e.name.toLowerCase().includes(needle)) out.push({ path: r }); if (e.isDirectory()) walk(join(dir, e.name), r, depth + 1); if (out.length >= 200) return; }
      };
      walk(root.value, "", 0);
      return succeed(out);
    }
    // grep async com timeout: um repositório grande não trava o event loop nem as outras rotas.
    const r = await runCmd("grep", ["-rnI", "--exclude-dir=.git", "--exclude-dir=node_modules", "--exclude-dir=dist", "--exclude-dir=build", "-m", "20", "--", q, "."], { cwd: root.value, timeoutMs: 8000 });
    const hits: SearchHit[] = [];
    for (const line of r.stdout.split("\n")) { const m = /^\.\/(.+?):(\d+):(.*)$/.exec(line); if (m) hits.push({ path: m[1]!, line: Number(m[2]), text: m[3]!.slice(0, 200) }); if (hits.length >= 200) break; }
    return succeed(hits);
  }

  // ---- arquivos e anexos (compositor) ----
  /** Lista caminhos relativos ao diretório do nó (cwd da sessão ou do espaço), filtrando por substring. */
  listFiles(nodeId: string, query: string, limit = 50): Result<FileEntry[]> {
    const node = this.store.getNode(nodeId);
    if (!node) return fail("NOT_FOUND", "nó não encontrado");
    const w = this.store.getWorkspace(node.workspaceId)!;
    const root = (node.sessionId ? this.store.getSession(node.sessionId)?.cwd : undefined) ?? w.cwd;
    const q = query.toLowerCase();
    const SKIP = new Set([".git", "node_modules", "dist", "build", ".cache", ".venv", "__pycache__", "target", ".next"]);
    const out: FileEntry[] = []; let visited = 0;
    const walk = (dir: string, depth: number) => {
      if (out.length >= limit || visited > 5000 || depth > 5) return;
      let entries: import("node:fs").Dirent[] = [];
      try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (out.length >= limit) return;
        visited++;
        const full = join(dir, e.name); const rel = relative(root, full);
        const isDir = e.isDirectory();
        if (isDir && SKIP.has(e.name)) continue;
        if (!q || rel.toLowerCase().includes(q)) out.push({ path: rel, dir: isDir });
        if (isDir) walk(full, depth + 1);
      }
    };
    walk(root, 0);
    return succeed(out);
  }
  /** Salva um anexo em <dataDir>/attachments/<workspace>/ e devolve o caminho absoluto. */
  saveAttachment(workspaceId: string, input: CreateAttachment): Result<Attachment> {
    if (!this.store.getWorkspace(workspaceId)) return fail("NOT_FOUND", "espaço não encontrado");
    const buf = Buffer.from(input.dataBase64, "base64");
    if (buf.length === 0) return fail("INVALID", "anexo vazio");
    if (buf.length > 25 * 1024 * 1024) return fail("INVALID", "anexo maior que 25 MB");
    const dir = join(this.cfg.dataDir, "attachments", workspaceId);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const id = newId();
    const safe = basename(input.name).replace(/[^\w.\-]+/g, "_").slice(0, 80) || `anexo${extname(input.name)}`;
    const path = join(dir, `${id.slice(0, 8)}-${safe}`);
    writeFileSync(path, buf, { mode: 0o600 });
    return succeed({ attachmentId: id, workspaceId, name: input.name, path, size: statSync(path).size, createdAt: nowIso() });
  }

  // ---- andares (floors) ----
  private git(cwd: string, args: string[]): { ok: boolean; out: string } {
    const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", timeout: GIT_SYNC_TIMEOUT_MS });
    return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
  }
  isGitRepo(cwd: string): boolean { return this.git(cwd, ["rev-parse", "--is-inside-work-tree"]).ok; }
  listFloors(groundId: string): Result<Workspace[]> {
    if (!this.store.getWorkspace(groundId)) return fail("NOT_FOUND", "espaço não encontrado");
    return succeed(this.store.listFloors(groundId));
  }
  /** Cria um andar: workspace-filho com branch própria; worktree git por padrão. */
  createFloor(groundId: string, input: CreateFloor): Result<Workspace> {
    const ground = this.store.getWorkspace(groundId);
    if (!ground) return fail("NOT_FOUND", "espaço não encontrado");
    if (ground.parentId) return fail("INVALID", "andares nascem do térreo, não de outro andar");
    const type = input.floorType ?? "worktree";
    const slug = slugify(input.name);
    const branch = input.branch?.trim() || slug;
    let cwd = ground.cwd;
    if (type === "worktree") {
      if (!this.isGitRepo(ground.cwd)) return fail("UNSUPPORTED", "o diretório do espaço não é um repositório git");
      cwd = input.path ?? join(this.cfg.dataDir, "floors", groundId, slug);
      if (existsSync(cwd)) return fail("CONFLICT", `já existe um diretório em ${cwd}`);
      mkdirSync(dirname(cwd), { recursive: true });
      const exists = this.git(ground.cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]).ok;
      const newBranch = input.newBranch ?? !exists;
      if (newBranch && exists) return fail("CONFLICT", `a branch ${branch} já existe`);
      if (!newBranch && !exists) return fail("NOT_FOUND", `a branch ${branch} não existe`);
      for (const cmd of floorGitPlan({ groundCwd: ground.cwd, path: cwd, branch, newBranch, base: input.base })) {
        const r = this.git(ground.cwd, cmd.slice(2)); // já vem com -C
        if (!r.ok) return fail("INTERNAL", `git falhou: ${r.out}`);
      }
    }
    const w: Workspace = {
      workspaceId: newId(), machineId: this.cfg.machineId, name: input.name, cwd, icon: "layers", color: ground.color,
      sortOrder: this.store.nextWorkspaceOrder(), revision: 0, createdAt: nowIso(), parentId: groundId, branch, floorType: type, status: "working",
      ...(ground.folderId ? { folderId: ground.folderId } : {}),
    };
    this.store.insertWorkspace(w);
    if (input.cloneLayout) {
      // copia notas e textos do térreo (não terminais: processos não se clonam)
      let rev = 0;
      for (const n of this.store.listNodes(groundId)) {
        if (n.kind === "terminal") continue;
        const r = this.createNode(w.workspaceId, { expectedRevision: rev, kind: n.kind, title: n.title, geometry: n.geometry, content: n.content ?? "" });
        if (r.ok) rev = r.value.revision;
      }
    }
    const baseHooks = this.readHooksConfig(groundId);
    const floorHooks: FloorHooksConfig = {
      setup: input.hooks?.setup ?? baseHooks.setup,
      run: input.hooks?.run ?? baseHooks.run,
      teardown: input.hooks?.teardown ?? baseHooks.teardown,
    };
    if (floorHooks.setup || floorHooks.run || floorHooks.teardown) {
      this.store.setMeta(this.hooksMetaKey(w.workspaceId), JSON.stringify(floorHooks));
    }
    if (floorHooks.setup.trim()) {
      void this.startHookSection(w, "setup", floorHooks.setup);
    }
    this.publishSidebar();
    return succeed(this.store.getWorkspace(w.workspaceId)!);
  }

  // ---- #75 hooks de andar (setup / run / teardown + logs ao vivo + MESS_FLOOR_*) ----
  private hookRuns = new Map<string, Map<FloorHookSection, { status: FloorHookStatus; proc?: ChildProcess; promise?: Promise<FloorHookStatus> }>>();
  private hooksMetaKey(workspaceId: string): string { return `hooks.${workspaceId}`; }
  private readHooksConfig(workspaceId: string): FloorHooksConfig {
    const raw = this.store.getMeta(this.hooksMetaKey(workspaceId));
    if (raw) {
      try {
        const j = JSON.parse(raw) as Partial<FloorHooksConfig>;
        return { setup: typeof j.setup === "string" ? j.setup : "", run: typeof j.run === "string" ? j.run : "", teardown: typeof j.teardown === "string" ? j.teardown : "" };
      } catch { /* fallback */ }
    }
    const w = this.store.getWorkspace(workspaceId);
    if (w?.parentId) return this.readHooksConfig(w.parentId);
    if (w) {
      for (const rel of [".messai/hooks.json", ".maestri/hooks.json"]) {
        const p = join(w.cwd, rel);
        if (!existsSync(p)) continue;
        try {
          const j = JSON.parse(readFileSync(p, "utf8")) as Partial<FloorHooksConfig>;
          return { setup: typeof j.setup === "string" ? j.setup : "", run: typeof j.run === "string" ? j.run : "", teardown: typeof j.teardown === "string" ? j.teardown : "" };
        } catch { /* ignorar */ }
      }
    }
    return { setup: "", run: "", teardown: "" };
  }
  private hookStatuses(workspaceId: string): FloorHooksState["status"] {
    const m = this.hookRuns.get(workspaceId);
    const get = (s: FloorHookSection): FloorHookStatus => {
      const cur = m?.get(s)?.status;
      return cur ? { ...cur } : { section: s, state: "idle", log: "" };
    };
    return { setup: get("setup"), run: get("run"), teardown: get("teardown") };
  }
  private hookEnv(w: Workspace, section: FloorHookSection): Record<string, string> {
    const baseEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !/^(CLAUDECODE|CLAUDE_CODE_|CODEX_)/.test(k)) baseEnv[k] = v;
    baseEnv["PATH"] = `${CLI_DIR}${delimiter}${baseEnv["PATH"] ?? ""}`;
    const ground = w.parentId ? this.store.getWorkspace(w.parentId) : undefined;
    return {
      ...baseEnv,
      [AGENT_ENV.floorId]: w.workspaceId,
      [AGENT_ENV.floorName]: w.name,
      [AGENT_ENV.floorBranch]: w.branch ?? "",
      [AGENT_ENV.branchName]: w.branch ?? "",
      [AGENT_ENV.floorPath]: w.cwd,
      [AGENT_ENV.rootPath]: ground ? ground.cwd : w.cwd,
      [AGENT_ENV.projectName]: ground ? ground.name : w.name,
      [AGENT_ENV.workspaceId]: w.workspaceId,
      [AGENT_ENV.workspaceName]: w.name,
      [AGENT_ENV.workspaceDir]: w.cwd,
      [AGENT_ENV.socket]: this.cfg.socketPath,
      [AGENT_ENV.token]: this.cfg.token,
      [AGENT_ENV.hookSection]: section,
      SHELL: this.cfg.defaultShell,
      ...(process.env["MESS_RESOURCES"] ? { MESS_ELECTRON: process.execPath } : {}),
    };
  }
  getFloorHooks(workspaceId: string): Result<FloorHooksState> {
    if (!this.store.getWorkspace(workspaceId)) return fail("NOT_FOUND", "espaço não encontrado");
    return succeed({ workspaceId, hooks: this.readHooksConfig(workspaceId), status: this.hookStatuses(workspaceId) });
  }
  putFloorHooks(workspaceId: string, input: PutFloorHooks): Result<FloorHooksState> {
    if (!this.store.getWorkspace(workspaceId)) return fail("NOT_FOUND", "espaço não encontrado");
    const cur = this.readHooksConfig(workspaceId);
    const next: FloorHooksConfig = {
      setup: input.setup !== undefined ? input.setup : cur.setup,
      run: input.run !== undefined ? input.run : cur.run,
      teardown: input.teardown !== undefined ? input.teardown : cur.teardown,
    };
    this.store.setMeta(this.hooksMetaKey(workspaceId), JSON.stringify(next));
    return this.getFloorHooks(workspaceId);
  }
  private startHookSection(w: Workspace, section: FloorHookSection, cmd: string): Promise<FloorHookStatus> {
    this.stopHookSection(w.workspaceId, section);
    let m = this.hookRuns.get(w.workspaceId);
    if (!m) { m = new Map(); this.hookRuns.set(w.workspaceId, m); }
    const status: FloorHookStatus = { section, state: "running", startedAt: nowIso(), log: "" };
    const entry: { status: FloorHookStatus; proc?: ChildProcess; promise?: Promise<FloorHookStatus> } = { status };
    m.set(section, entry);
    const promise = new Promise<FloorHookStatus>((resolveP) => {
      let proc: ChildProcess;
      try {
        proc = spawn(this.cfg.defaultShell || "/bin/sh", ["-c", cmd], { cwd: w.cwd, env: this.hookEnv(w, section), detached: true, stdio: ["ignore", "pipe", "pipe"] });
      } catch (e) {
        status.state = "failed"; status.exitCode = 1; status.finishedAt = nowIso();
        status.log = String((e as Error).message ?? e);
        this.emit("floorHook", w.workspaceId, { ...status });
        return resolveP({ ...status });
      }
      entry.proc = proc;
      if (proc.pid) status.pid = proc.pid;
      this.emit("floorHook", w.workspaceId, { ...status });
      const onChunk = (c: Buffer | string) => {
        status.log += String(c);
        if (status.log.length > 131072) status.log = status.log.slice(-131072);
        this.emit("floorHook", w.workspaceId, { ...status });
      };
      proc.stdout?.on("data", onChunk);
      proc.stderr?.on("data", onChunk);
      let settled = false;
      const done = (code: number | null) => {
        if (settled) return; settled = true;
        delete entry.proc;
        delete status.pid;
        if (status.state === "running") status.state = code === 0 ? "succeeded" : "failed";
        if (typeof code === "number") status.exitCode = code;
        status.finishedAt = nowIso();
        this.emit("floorHook", w.workspaceId, { ...status });
        resolveP({ ...status });
      };
      proc.on("error", (err) => { onChunk(`\n${String(err.message ?? err)}\n`); done(1); });
      proc.on("close", (code) => done(code));
    });
    entry.promise = promise;
    return promise;
  }
  private stopHookSection(workspaceId: string, section: FloorHookSection): void {
    const entry = this.hookRuns.get(workspaceId)?.get(section);
    if (!entry || entry.status.state !== "running") return;
    entry.status.state = "stopped";
    entry.status.finishedAt = nowIso();
    const pid = entry.proc?.pid;
    if (pid) {
      try { process.kill(-pid, "SIGTERM"); } catch { /* grupo já saiu */ }
      try { entry.proc?.kill("SIGTERM"); } catch { /* processo já saiu */ }
    }
    delete entry.proc;
    delete entry.status.pid;
    this.emit("floorHook", workspaceId, { ...entry.status });
  }
  async runFloorHooks(workspaceId: string, input: RunFloorHookInput): Promise<Result<FloorHooksState>> {
    const w = this.store.getWorkspace(workspaceId);
    if (!w) return fail("NOT_FOUND", "espaço não encontrado");
    const cfg = this.readHooksConfig(workspaceId);
    const wanted = input.section ?? "all";
    const sections: FloorHookSection[] = wanted === "all"
      ? (["setup", "run", "teardown"] as FloorHookSection[]).filter((s) => cfg[s].trim().length > 0)
      : [wanted];
    if (!sections.length) return fail("INVALID", "nenhum comando configurado nos hooks deste andar");
    for (const s of sections) if (!cfg[s].trim()) return fail("INVALID", `a seção "${s}" não tem comando configurado`);
    const first = this.startHookSection(w, sections[0]!, cfg[sections[0]!]);
    const chain = (async () => {
      const r0 = await first;
      if (r0.state !== "succeeded") return;
      for (const s of sections.slice(1)) {
        const curW = this.store.getWorkspace(workspaceId);
        if (!curW) break;
        const r = await this.startHookSection(curW, s, cfg[s]);
        if (r.state !== "succeeded") break;
      }
    })();
    if (input.wait) await chain;
    return this.getFloorHooks(workspaceId);
  }
  stopFloorHooks(workspaceId: string, input: StopFloorHookInput): Result<FloorHooksState> {
    if (!this.store.getWorkspace(workspaceId)) return fail("NOT_FOUND", "espaço não encontrado");
    const wanted = input.section ?? "all";
    const sections: FloorHookSection[] = wanted === "all" ? ["setup", "run", "teardown"] : [wanted];
    for (const s of sections) this.stopHookSection(workspaceId, s);
    return this.getFloorHooks(workspaceId);
  }
  /** Pousar: merge local da branch do andar no térreo. Conflitos abortam o merge e voltam listados. */
  landFloor(floorId: string, input: LandFloor): Result<LandResult> {
    const floor = this.store.getWorkspace(floorId);
    if (!floor?.parentId) return fail("NOT_FOUND", "andar não encontrado");
    const ground = this.store.getWorkspace(floor.parentId)!;
    if (floor.floorType !== "worktree" || !floor.branch) return fail("UNSUPPORTED", "este andar não tem branch própria para pousar");
    const dirty = this.git(ground.cwd, ["status", "--porcelain"]);
    if (dirty.ok && dirty.out) return fail("CONFLICT", "o térreo tem alterações não commitadas; commite ou guarde (stash) antes de pousar");
    const mode = input.mode ?? "merge";
    const args = mode === "squash" ? ["merge", "--squash", floor.branch] : ["merge", "--no-ff", "--no-edit", floor.branch];
    const r = this.git(ground.cwd, args);
    if (!r.ok) {
      const conflicts = parseMergeConflicts(r.out);
      this.git(ground.cwd, ["merge", "--abort"]);
      return succeed({ ok: false, merged: false, conflicts, output: r.out, removed: false });
    }
    if (mode === "squash") { const c = this.git(ground.cwd, ["commit", "--no-edit", "-m", `Pousa andar ${floor.name} (${floor.branch})`]); if (!c.ok) return succeed({ ok: false, merged: false, conflicts: [], output: c.out, removed: false }); }
    let removed = false;
    if (!input.keepFloor) { const d = this.deleteWorkspace(floorId, { deleteBranch: input.deleteBranch ?? false }); removed = d.ok; }
    else this.store.updateWorkspace(floorId, { status: "done" }, floor.revision + 1);
    this.publishSidebar();
    return succeed({ ok: true, merged: true, conflicts: [], output: r.out, removed });
  }

  // ---- pastas e grupos da barra lateral ----
  createFolder(input: CreateFolder): Result<Folder> {
    if (input.parentId && !this.store.getFolder(input.parentId)) return fail("NOT_FOUND", "pasta pai não encontrada");
    const siblings = this.store.listFolders().filter((f) => (f.parentId ?? null) === (input.parentId ?? null));
    const f: Folder = { folderId: newId(), name: input.name, kind: input.kind ?? "folder", sortOrder: siblings.length, collapsed: false, createdAt: nowIso(), ...(input.parentId ? { parentId: input.parentId } : {}) };
    this.store.insertFolder(f);
    this.publishSidebar();
    return succeed(f);
  }
  patchFolder(id: string, input: PatchFolder): Result<Folder> {
    const f = this.store.getFolder(id);
    if (!f) return fail("NOT_FOUND", "pasta não encontrada");
    if (input.parentId) {
      // impede ciclo: o novo pai não pode ser a própria pasta nem um descendente dela
      let p: Folder | undefined = this.store.getFolder(input.parentId);
      if (!p) return fail("NOT_FOUND", "pasta pai não encontrada");
      while (p) { if (p.folderId === id) return fail("INVALID", "uma pasta não pode ficar dentro de si mesma"); p = p.parentId ? this.store.getFolder(p.parentId) : undefined; }
    }
    this.store.updateFolder(id, input);
    this.publishSidebar();
    return succeed(this.store.getFolder(id)!);
  }
  deleteFolder(id: string): Result<void> {
    if (!this.store.getFolder(id)) return fail("NOT_FOUND", "pasta não encontrada");
    this.store.deleteFolder(id);
    this.publishSidebar();
    return succeed(undefined);
  }

  deleteWorkspace(id: string, opts: { deleteBranch?: boolean } = {}): Result<void> {
    const w = this.store.getWorkspace(id);
    if (!w) return fail("NOT_FOUND", "espaço não encontrado");
    // andares primeiro: um térreo não some com andares órfãos
    for (const f of this.store.listFloors(id)) { const r = this.deleteWorkspace(f.workspaceId, opts); if (!r.ok) return r; }
    for (const s of ["setup", "run", "teardown"] as FloorHookSection[]) this.stopHookSection(id, s);
    if (w.parentId) {
      const hk = this.readHooksConfig(id);
      if (hk.teardown.trim() && existsSync(w.cwd)) {
        spawnSync(this.cfg.defaultShell || "/bin/sh", ["-c", hk.teardown], { cwd: w.cwd, env: this.hookEnv(w, "teardown"), stdio: "ignore", timeout: GIT_SYNC_TIMEOUT_MS });
      }
    }
    this.store.deleteMeta(this.hooksMetaKey(id));
    this.hookRuns.delete(id);
    if (w.parentId && w.floorType === "worktree") {
      const ground = this.store.getWorkspace(w.parentId);
      if (ground) {
        spawnSync("git", ["-C", ground.cwd, "worktree", "remove", "--force", w.cwd], { stdio: "ignore", timeout: GIT_SYNC_TIMEOUT_MS });
        spawnSync("git", ["-C", ground.cwd, "worktree", "prune"], { stdio: "ignore", timeout: GIT_SYNC_TIMEOUT_MS });
        if (opts.deleteBranch && w.branch) spawnSync("git", ["-C", ground.cwd, "branch", "-D", w.branch], { stdio: "ignore", timeout: GIT_SYNC_TIMEOUT_MS });
      }
      if (existsSync(w.cwd) && w.cwd.startsWith(join(this.cfg.dataDir, "floors"))) rmSync(w.cwd, { recursive: true, force: true });
    }
    for (const s of this.store.listSessions(id)) this.sessions.dispose(s.sessionId);
    this.store.transaction(() => {
      for (const s of this.store.listSessions(id)) this.store.deleteSession(s.sessionId);
      this.store.deleteWorkspace(id);
    });
    this.publishSidebar();
    return succeed(undefined);
  }

  createNode(workspaceId: string, input: CreateNode): Result<{ node: Node; session?: Session; revision: number }> {
    const w = this.store.getWorkspace(workspaceId);
    if (!w) return fail("NOT_FOUND", "espaço não encontrado");
    const rev = checkRevision(w, input.expectedRevision);
    if (!rev.ok) return rev;
    const valid = validateNewNode({ kind: input.kind, command: input.command });
    if (!valid.ok) return valid;

    const node: Node = {
      nodeId: newId(), workspaceId, kind: input.kind,
      title: input.title ?? (input.kind === "terminal" ? "Terminal" : input.kind === "text" ? "Texto" : input.kind === "tree" ? "Arquivos" : input.kind === "binder" ? "Fichário" : "Nota"),
      geometry: normalizeGeometry(input.geometry), createdAt: nowIso(),
      ...(input.kind === "note" || input.kind === "text" ? { content: input.content ?? "" } : {}),
      ...(input.kind === "tree" ? { content: input.content ?? JSON.stringify({ root: "", mode: "list" }) } : {}),
      ...(input.kind === "binder" ? { content: input.content ?? JSON.stringify({ pages: [{ id: "p1", title: "Página 1", content: "" }], active: "p1", color: "" }) } : {}),
      ...(input.kind === "terminal" && input.roleId ? { roleId: input.roleId } : {}),
      // #56 aparência do terminal (vinda do preset)
      ...(input.kind === "terminal" && input.color ? { color: input.color } : {}),
      ...(input.kind === "terminal" && input.icon ? { icon: input.icon } : {}),
      ...(input.kind === "terminal" && input.termTheme && input.termTheme !== "system" ? { termTheme: input.termTheme } : {}),
      ...(input.kind === "terminal" && input.skillIds?.length ? { skillIds: input.skillIds } : {}),
      ...(input.kind === "terminal" && input.maestro ? { maestro: true } : {}), // #29
    };
    for (const id of node.skillIds ?? []) if (!this.store.getSkill(id)) return fail("NOT_FOUND", `habilidade não encontrada: ${id}`);
    if (node.roleId && !this.store.getRole(node.roleId)) return fail("NOT_FOUND", "papel não encontrado");
    let titleAuto = true;
    if (input.kind === "note") {
      if (input.color) node.color = input.color;
      if (input.filePath) {
        if (!/\.(md|markdown|txt)$/i.test(input.filePath)) return fail("INVALID", "só arquivos .md ou .txt podem virar nota");
        if (!existsSync(input.filePath)) return fail("NOT_FOUND", "arquivo não encontrado");
        node.filePath = input.filePath; node.content = readFileSync(input.filePath, "utf8");
        if (!input.title) node.title = deriveNoteTitle(node.content) ?? input.filePath.split("/").pop()!.replace(/\.(md|markdown|txt)$/i, "");
      } else {
        node.filePath = join(this.notesDir(workspaceId), `${node.nodeId.slice(0, 8)}-${noteFileName(input.title ?? deriveNoteTitle(node.content ?? "") ?? "nota")}`);
        if (!input.title) { const t = deriveNoteTitle(node.content ?? ""); if (t) node.title = t; }
      }
      if (input.title) titleAuto = false;
    }
    let session: Session | undefined;
    if (input.kind === "terminal") {
      if (input.persistent && !SessionManager.tmuxAvailable()) return fail("UNSUPPORTED", "tmux não está instalado nesta máquina");
      const command = input.command ?? this.cfg.defaultShell;
      let args = input.args ?? [];
      // Retomada pós-reboot: se for agente de IA que deixa fixar o id no start (claude), gera e injeta
      // o --session-id e guarda. Os que não deixam (codex/opencode) têm o id capturado depois (async).
      const k = agentKind(command, args);
      const recipe = agentResume(k.agentType);
      let resumeId: string | undefined;
      if (k.isAgent && recipe.startArgs) { resumeId = randomUUID(); args = [...args, ...recipe.startArgs(resumeId)]; }
      const base = SessionManager.blank({
        sessionId: newId(), workspaceId, nodeId: node.nodeId,
        command, args, cwd: input.cwd ?? w.cwd,
        ...(input.persistent ? { persistent: true } : {}),
        ...(resumeId ? { resumeId } : {}),
      });
      node.sessionId = base.sessionId;
      this.store.transaction(() => { this.store.insertNode(node); this.store.insertSession(base); this.store.bumpRevision(workspaceId, rev.value); });
      session = this.sessions.start(base, this.plan(w, node, base));
    } else {
      this.store.transaction(() => { this.store.insertNode(node, titleAuto); this.store.bumpRevision(workspaceId, rev.value); });
      if (node.kind === "note" && node.filePath && !input.filePath) this.writeNoteFile(node, node.content ?? "");
      else if (node.kind === "note" && node.filePath) { try { this.noteMtime.set(node.nodeId, statSync(node.filePath).mtimeMs); } catch { /* ignorar */ } }
      if (node.kind === "note" && node.filePath) this.watchNote(node.filePath, workspaceId);
    }
    this.publish(workspaceId);
    return succeed(session ? { node, session, revision: rev.value } : { node, revision: rev.value });
  }

  /** Duplica um nó: cria uma cópia deslocada com os mesmos dados. Terminal relança o mesmo comando/cwd/papel. */
  duplicateNode(nodeId: string, expectedRevision: number): Result<{ node: Node; session?: Session; revision: number }> {
    const node = this.store.getNode(nodeId);
    if (!node) return fail("NOT_FOUND", "nó não encontrado");
    const OFF = 32;
    const geometry = { x: node.geometry.x + OFF, y: node.geometry.y + OFF, w: node.geometry.w, h: node.geometry.h };
    const input: CreateNode = { expectedRevision, kind: node.kind, title: node.title, geometry };
    if (node.kind === "terminal") {
      const sess = node.sessionId ? this.store.getSession(node.sessionId) : undefined;
      if (sess) { input.command = sess.command; input.args = sess.args; input.cwd = sess.cwd; if (sess.persistent) input.persistent = true; }
      if (node.roleId) input.roleId = node.roleId;
      if (node.maestro) input.maestro = true;
    } else {
      // nota/texto/árvore: copia o conteúdo. Nota ligada a arquivo vira nota do app com o mesmo conteúdo (não liga dois nós ao mesmo .md).
      input.content = node.content ?? "";
      if (node.kind === "note" && node.color) input.color = node.color;
    }
    return this.createNode(node.workspaceId, input);
  }

  /** Move vários nós numa única revisão (alinhar/organizar em grade). Ignora ids que não são do espaço. */
  applyLayout(workspaceId: string, expectedRevision: number, moves: { nodeId: string; geometry: Node["geometry"] }[]): Result<{ revision: number }> {
    const w = this.store.getWorkspace(workspaceId);
    if (!w) return fail("NOT_FOUND", "espaço não encontrado");
    const rev = checkRevision(w, expectedRevision);
    if (!rev.ok) return rev;
    const valid = moves.filter((m) => { const n = this.store.getNode(m.nodeId); return !!n && n.workspaceId === workspaceId; });
    this.store.transaction(() => {
      for (const m of valid) this.store.updateNode(m.nodeId, { geometry: normalizeGeometry(m.geometry) });
      this.store.bumpRevision(workspaceId, rev.value);
    });
    this.publish(workspaceId);
    return succeed({ revision: rev.value });
  }

  private plan(w: Workspace, node: Node, s: Session) {
    const baseEnv: Record<string, string> = {};
    // Não herdar marcadores de sessão de agentes que possam ter lançado o runtime.
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !/^(CLAUDECODE|CLAUDE_CODE_|CODEX_)/.test(k)) baseEnv[k] = v;
    baseEnv["PATH"] = `${CLI_DIR}${delimiter}${baseEnv["PATH"] ?? ""}`;
    const role = node.roleId ? this.store.getRole(node.roleId) : undefined;
    const skills = (node.skillIds ?? []).map((id) => this.store.getSkill(id)).filter((k): k is Skill => !!k); // #57
    const ground = w.parentId ? this.store.getWorkspace(w.parentId) : undefined;
    const inject = {
      ...(role ? { [AGENT_ENV.roleName]: role.name, [AGENT_ENV.roleInstructions]: roleText(role) } : {}),
      ...(skills.length ? { [AGENT_ENV.skills]: skills.map((k) => k.name).join(", "), [AGENT_ENV.skillsText]: skillsText(skills) } : {}),
      ...(ground ? { [AGENT_ENV.floorId]: w.workspaceId, [AGENT_ENV.floorName]: w.name, [AGENT_ENV.floorBranch]: w.branch ?? "", [AGENT_ENV.branchName]: w.branch ?? "", [AGENT_ENV.floorPath]: w.cwd, [AGENT_ENV.rootPath]: ground.cwd, [AGENT_ENV.projectName]: ground.name } : { [AGENT_ENV.rootPath]: w.cwd, [AGENT_ENV.projectName]: w.name }),
      [AGENT_ENV.socket]: this.cfg.socketPath, [AGENT_ENV.token]: this.cfg.token,
      [AGENT_ENV.workspaceId]: w.workspaceId, [AGENT_ENV.workspaceName]: w.name, [AGENT_ENV.workspaceDir]: w.cwd,
      [AGENT_ENV.nodeId]: node.nodeId, [AGENT_ENV.sessionId]: s.sessionId,
      ...(node.maestro ? { [AGENT_ENV.maestro]: "1" } : {}), // #29
      SHELL: this.cfg.defaultShell,
      // Empacotado: o launcher `mess` roda o CLI com o Node do Electron (sem Node do sistema).
      ...(process.env["MESS_RESOURCES"] ? { MESS_ELECTRON: process.execPath } : {}),
    };
    const plan = planLocalTerminal({ command: s.command, args: applySkills(s.command, applyRole(s.command, s.args, role), skills), cwd: s.cwd, defaultShell: this.cfg.defaultShell, baseEnv, inject });
    return s.persistent ? wrapInTmux(plan, tmuxSessionName(s.sessionId), { ...inject, PATH: baseEnv["PATH"]! }, this.cfg.tmuxSocket) : plan;
  }
  /** Reinicia o processo de um nó terminal cuja sessão saiu ou se perdeu. Mesmo sessionId. */
  // #56 — presets de Início rápido (persistidos na meta; padrões como semente).
  presetDefs(): PresetInput[] { return parsePresets(this.store.getMeta(PRESETS_META_KEY), defaultPresets(this.cfg.defaultShell)); }
  putPresets(list: PresetInput[]): Result<PresetInput[]> {
    const v = validatePresets(list); if (!v.ok) return v;
    this.store.setMeta(PRESETS_META_KEY, JSON.stringify(list));
    return succeed(list);
  }
  resetPresets(): PresetInput[] { const d = defaultPresets(this.cfg.defaultShell); this.store.setMeta(PRESETS_META_KEY, JSON.stringify(d)); return d; }

  // #55 — configurações do runtime, persistidas na tabela meta (chave `settings.<nome>`).
  settings(): RuntimeSettings {
    const lim = Number(this.store.getMeta("settings.termMemLimitMb") ?? 0) || 0;
    const act = this.store.getMeta("settings.termMemAction");
    return {
      restoreSessions: this.store.getMeta("settings.restoreSessions") !== "0",
      ...(lim > 0 ? { termMemLimitMb: lim } : {}),
      ...(act === "kill" || act === "warn" ? { termMemAction: act } : {}),
    };
  }
  patchSettings(p: PatchRuntimeSettings): Result<RuntimeSettings> {
    if (p.restoreSessions !== undefined) this.store.setMeta("settings.restoreSessions", p.restoreSessions ? "1" : "0");
    if (p.termMemLimitMb !== undefined) this.store.setMeta("settings.termMemLimitMb", String(Math.max(0, Math.round(p.termMemLimitMb))));
    if (p.termMemAction !== undefined) this.store.setMeta("settings.termMemAction", p.termMemAction === "kill" ? "kill" : "warn");
    return succeed(this.settings());
  }

  /** Na subida: reanexa sessões tmux que sobreviveram ao runtime anterior; as demais viram `lost`. */
  /**
   * Restaura o workspace no boot (à prova de reboot): o banco é a verdade do que deve estar aberto.
   * tmux vivo (reinício do runtime) → reanexa; tmux morto (reboot / "Encerrar tudo") → RE-SOBE. Agente
   * com id guardado → retoma a conversa (claude --resume etc.); shell/sem-id → reabre limpo.
   */
  recoverPersistent(): { reattached: number; respawned: number; lost: number; skipped: number } {
    let reattached = 0, respawned = 0, lost = 0, skipped = 0;
    const restore = this.settings().restoreSessions; // #55: desligado → não RE-SOBE após reboot (tmux vivo ainda reanexa)
    for (const s of this.store.listSessions()) {
      if (!s.persistent || (s.state !== "running" && s.state !== "starting")) continue;
      const node = this.store.getNode(s.nodeId); const w = node && this.store.getWorkspace(node.workspaceId);
      if (!node || !w) { this.store.updateSession(s.sessionId, { state: "lost", pid: null }); lost++; continue; }
      if (this.sessions.tmuxAlive(s.sessionId)) { this.sessions.start({ ...s, state: "starting" }, this.plan(w, node, s)); reattached++; }
      else if (!restore) { this.store.updateSession(s.sessionId, { state: "lost", pid: null }); skipped++; }
      else { const r = this.resumeSession(s); this.sessions.start({ ...r, state: "starting" }, this.plan(w, node, r)); respawned++; }
    }
    return { reattached, respawned, lost, skipped };
  }

  /**
   * Monta a sessão para RE-SUBIR no restore. Agente → comando de retomada do CLI (claude com id guardado
   * retoma determinístico; os demais "continuam a última"); shell → o comando original (reabre limpo).
   */
  private resumeSession(s: Session): Session {
    const k = agentKind(s.command, s.args);
    if (!k.isAgent) return s;
    const r = agentResume(k.agentType).resume?.(s.resumeId ?? null, s.args);
    return r ? { ...s, command: r.command, args: r.args } : s;
  }

  restartTerminal(nodeId: string): Result<Session> {
    const node = this.store.getNode(nodeId);
    if (!node?.sessionId) return fail("NOT_FOUND", "nó terminal não encontrado");
    const w = this.store.getWorkspace(node.workspaceId)!;
    const s = this.store.getSession(node.sessionId);
    if (!s) return fail("NOT_FOUND", "sessão não encontrada");
    if (s.state === "running") return fail("CONFLICT", "sessão já está rodando");
    this.sessions.dispose(s.sessionId);
    this.store.updateSession(s.sessionId, { state: "starting", exitCode: null, pid: null });
    return succeed(this.sessions.start({ ...s, state: "starting" }, this.plan(w, node, s)));
  }

  createDrawing(workspaceId: string, input: CreateDrawing): Result<Drawing> {
    const w = this.store.getWorkspace(workspaceId);
    if (!w) return fail("NOT_FOUND", "espaço não encontrado");
    const rev = checkRevision(w, input.expectedRevision);
    if (!rev.ok) return rev;
    const d: Drawing = { drawingId: newId(), workspaceId, kind: input.kind, points: input.points.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10] as [number, number]), color: input.color, width: input.width, createdAt: nowIso() };
    this.store.transaction(() => { this.store.insertDrawing(d); this.store.bumpRevision(workspaceId, rev.value); });
    this.publish(workspaceId);
    return succeed(d);
  }
  deleteDrawing(drawingId: string, expectedRevision: number): Result<void> {
    const d = this.store.getDrawing(drawingId);
    if (!d) return fail("NOT_FOUND", "desenho não encontrado");
    const w = this.store.getWorkspace(d.workspaceId)!;
    const rev = checkRevision(w, expectedRevision);
    if (!rev.ok) return rev;
    this.store.transaction(() => { this.store.deleteDrawing(drawingId); this.store.bumpRevision(d.workspaceId, rev.value); });
    this.publish(d.workspaceId);
    return succeed(undefined);
  }

  patchDrawing(drawingId: string, input: PatchDrawing): Result<Drawing> {
    const d = this.store.getDrawing(drawingId);
    if (!d) return fail("NOT_FOUND", "desenho não encontrado");
    const w = this.store.getWorkspace(d.workspaceId)!;
    const rev = checkRevision(w, input.expectedRevision);
    if (!rev.ok) return rev;
    const points = input.points.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10] as [number, number]);
    this.store.transaction(() => { this.store.updateDrawingPoints(drawingId, points); this.store.bumpRevision(d.workspaceId, rev.value); });
    this.publish(d.workspaceId);
    return succeed({ ...d, points });
  }

  groupDrawings(workspaceId: string, input: GroupDrawings): Result<{ revision: number }> {
    const w = this.store.getWorkspace(workspaceId);
    if (!w) return fail("NOT_FOUND", "espaço não encontrado");
    const rev = checkRevision(w, input.expectedRevision);
    if (!rev.ok) return rev;
    const ids = input.drawingIds.filter((id) => { const d = this.store.getDrawing(id); return !!d && d.workspaceId === workspaceId; });
    const groupId = input.grouped ? newId() : null;
    this.store.transaction(() => { this.store.setDrawingGroup(ids, groupId); this.store.bumpRevision(workspaceId, rev.value); });
    this.publish(workspaceId);
    return succeed({ revision: rev.value });
  }

  // ---- #71 partituras ----
  listScores(): Score[] { return this.store.listScores(); }
  /** Salva a seleção (ou o espaço todo) como partitura: comando/args/cwd do terminal, papel e skills por NOME, aparência, conteúdo, posições relativas e conexões internas. */
  saveScore(workspaceId: string, input: SaveScore): Result<Score> {
    const w = this.store.getWorkspace(workspaceId);
    if (!w) return fail("NOT_FOUND", "espaço não encontrado");
    const rev = checkRevision(w, input.expectedRevision);
    if (!rev.ok) return rev;
    if (this.store.findScoreByName(input.name)) return fail("CONFLICT", "já existe uma partitura com esse nome");
    const all = this.store.listNodes(workspaceId);
    const pick = input.nodeIds?.length ? all.filter((n) => input.nodeIds!.includes(n.nodeId)) : all;
    if (!pick.length) return fail("INVALID", "nada para salvar");
    const ids = new Set(pick.map((n) => n.nodeId)); const keyOf = new Map(pick.map((n, i) => [n.nodeId, `n${i + 1}`]));
    const minX = Math.min(...pick.map((n) => n.geometry.x)), minY = Math.min(...pick.map((n) => n.geometry.y));
    const nodes: ScoreNode[] = pick.map((n) => {
      const ses = n.kind === "terminal" && n.sessionId ? this.store.getSession(n.sessionId) : undefined;
      const role = n.roleId ? this.store.getRole(n.roleId) : undefined;
      const skillNames = (n.skillIds ?? []).map((id) => this.store.getSkill(id)?.name).filter((x): x is string => !!x);
      return { key: keyOf.get(n.nodeId)!, kind: n.kind, title: n.title, geometry: { ...n.geometry, x: n.geometry.x - minX, y: n.geometry.y - minY },
        ...(n.kind !== "terminal" && n.content !== undefined ? { content: n.content } : {}), ...(n.color ? { color: n.color } : {}), ...(n.icon ? { icon: n.icon } : {}), ...(n.termTheme ? { termTheme: n.termTheme } : {}),
        ...(role ? { roleName: role.name } : {}), ...(skillNames.length ? { skillNames } : {}),
        ...(ses ? { command: ses.command, args: ses.args, cwd: ses.cwd, ...(ses.persistent ? { persistent: true } : {}) } : {}) };
    });
    const connections = connectionsWithin(this.store.listConnections(workspaceId), ids).map((c) => ({ from: keyOf.get(c.sourceNodeId)!, to: keyOf.get(c.targetNodeId)!, ...(c.style && c.style !== "rope" ? { style: c.style } : {}) }));
    const sc: Score = { scoreId: newId(), name: input.name.trim(), description: (input.description ?? "").trim(), nodes, connections, createdAt: nowIso() };
    this.store.insertScore(sc);
    return succeed(sc);
  }
  patchScore(id: string, input: PatchScore): Result<Score> {
    if (!this.store.getScore(id)) return fail("NOT_FOUND", "partitura não encontrada");
    const dup = input.name ? this.store.findScoreByName(input.name) : undefined;
    if (dup && dup.scoreId !== id) return fail("CONFLICT", "já existe uma partitura com esse nome");
    this.store.updateScore(id, { name: input.name?.trim(), description: input.description?.trim() });
    return succeed(this.store.getScore(id)!);
  }
  deleteScore(id: string): Result<void> { if (!this.store.getScore(id)) return fail("NOT_FOUND", "partitura não encontrada"); this.store.deleteScore(id); return succeed(undefined); }
  /** Coloca a partitura num espaço/andar a partir de `at`: recria nós (terminais sobem com comando/papel/skills/aparência), conexões e layout relativo. Papéis/skills inexistentes viram aviso. */
  placeScore(workspaceId: string, scoreId: string, input: PlaceScore): Result<PlaceScoreResult> {
    const sc = this.store.getScore(scoreId); if (!sc) return fail("NOT_FOUND", "partitura não encontrada");
    const w0 = this.store.getWorkspace(workspaceId); if (!w0) return fail("NOT_FOUND", "espaço não encontrado");
    const rev0 = checkRevision(w0, input.expectedRevision); if (!rev0.ok) return rev0;
    const geos = placeGeometries(sc.nodes.map((n) => ({ key: n.key, geometry: n.geometry })), input.at);
    const warnings: string[] = []; const made = new Map<string, string>(); const nodeIds: string[] = []; const connectionIds: string[] = [];
    const cur = () => this.store.getWorkspace(workspaceId)!.revision;
    for (const n of sc.nodes) {
      const role = n.roleName ? this.store.findRoleByName(n.roleName) : undefined; if (n.roleName && !role) warnings.push(`papel "${n.roleName}" não existe neste computador (${n.title})`);
      const skills = (n.skillNames ?? []).map((nm) => ({ nm, s: this.store.findSkillByName(nm) })); for (const k of skills) if (!k.s) warnings.push(`habilidade "${k.nm}" não existe neste computador (${n.title})`);
      const skillIds = skills.map((k) => k.s?.skillId).filter((x): x is string => !!x);
      const cwd = n.cwd && existsSync(n.cwd) ? n.cwd : undefined; if (n.cwd && !cwd) warnings.push(`diretório "${n.cwd}" não existe; usando o do espaço (${n.title})`);
      const r = this.createNode(workspaceId, { expectedRevision: cur(), kind: n.kind, title: n.title, geometry: geos.get(n.key)!,
        ...(n.content !== undefined ? { content: n.content } : {}), ...(n.color ? { color: n.color } : {}), ...(n.icon ? { icon: n.icon } : {}), ...(n.termTheme ? { termTheme: n.termTheme as never } : {}),
        ...(role ? { roleId: role.roleId } : {}), ...(skillIds.length ? { skillIds } : {}),
        ...(n.kind === "terminal" && n.command ? { command: n.command, args: n.args ?? [] } : {}), ...(cwd ? { cwd } : {}), ...(n.persistent ? { persistent: true } : {}) });
      if (!r.ok) { warnings.push(`não criou "${n.title}": ${r.error.message}`); continue; }
      made.set(n.key, r.value.node.nodeId); nodeIds.push(r.value.node.nodeId);
    }
    for (const c of sc.connections) {
      const a = made.get(c.from), b = made.get(c.to); if (!a || !b) continue;
      const r = this.createConnection(workspaceId, { expectedRevision: cur(), sourceNodeId: a, targetNodeId: b });
      if (!r.ok) { warnings.push(`conexão não criada: ${r.error.message}`); continue; }
      connectionIds.push(r.value.connectionId);
      if (c.style && c.style !== "rope") this.patchConnection(r.value.connectionId, { expectedRevision: cur(), style: c.style as never });
    }
    return succeed({ nodeIds, connectionIds, warnings, revision: cur() });
  }

  // ---- #78 grupos de nós (contêiner com rótulo/cor; membros movem juntos; grupo vazio some) ----
  createNodeGroup(workspaceId: string, input: CreateNodeGroup): Result<{ group: NodeGroup; revision: number }> {
    const w = this.store.getWorkspace(workspaceId);
    if (!w) return fail("NOT_FOUND", "espaço não encontrado");
    const rev = checkRevision(w, input.expectedRevision);
    if (!rev.ok) return rev;
    const ids = [...new Set(input.nodeIds)].filter((id) => this.store.getNode(id)?.workspaceId === workspaceId);
    if (!ids.length) return fail("INVALID", "nenhum nó válido para agrupar");
    const g: NodeGroup = { groupId: newId(), workspaceId, label: (input.label ?? "").trim(), color: input.color ?? "", createdAt: nowIso() };
    this.store.transaction(() => { this.store.insertGroup(g); this.store.setNodesGroup(ids, g.groupId); this.store.pruneEmptyGroups(workspaceId); this.store.bumpRevision(workspaceId, rev.value); });
    this.publish(workspaceId);
    return succeed({ group: g, revision: rev.value });
  }
  patchNodeGroup(id: string, input: PatchNodeGroup): Result<{ group: NodeGroup | null; revision: number }> {
    const g = this.store.getGroup(id);
    if (!g) return fail("NOT_FOUND", "grupo não encontrado");
    const w = this.store.getWorkspace(g.workspaceId)!;
    const rev = checkRevision(w, input.expectedRevision);
    if (!rev.ok) return rev;
    const add = (input.addNodeIds ?? []).filter((n) => this.store.getNode(n)?.workspaceId === g.workspaceId);
    const remove = (input.removeNodeIds ?? []).filter((n) => this.store.getNode(n)?.groupId === id);
    this.store.transaction(() => {
      this.store.updateGroup(id, { label: input.label?.trim(), color: input.color });
      if (add.length) this.store.setNodesGroup(add, id);
      if (remove.length) this.store.setNodesGroup(remove, null);
      this.store.pruneEmptyGroups(g.workspaceId);
      this.store.bumpRevision(g.workspaceId, rev.value);
    });
    this.publish(g.workspaceId);
    return succeed({ group: this.store.getGroup(id) ?? null, revision: rev.value }); // null = ficou vazio e sumiu
  }
  /** Desagrupar: o grupo some; os nós ficam onde estão. */
  deleteNodeGroup(id: string, expectedRevision: number): Result<void> {
    const g = this.store.getGroup(id);
    if (!g) return fail("NOT_FOUND", "grupo não encontrado");
    const w = this.store.getWorkspace(g.workspaceId)!;
    const rev = checkRevision(w, expectedRevision);
    if (!rev.ok) return rev;
    this.store.transaction(() => { this.store.deleteGroup(id); this.store.bumpRevision(g.workspaceId, rev.value); });
    this.publish(g.workspaceId);
    return succeed(undefined);
  }

  patchConnection(id: string, input: PatchConnection): Result<Connection> {
    const c = this.store.getConnection(id);
    if (!c) return fail("NOT_FOUND", "conexão não encontrada");
    const w = this.store.getWorkspace(c.workspaceId)!;
    const rev = checkRevision(w, input.expectedRevision);
    if (!rev.ok) return rev;
    this.store.transaction(() => { this.store.updateConnection(id, { style: input.style, label: input.label }); this.store.bumpRevision(c.workspaceId, rev.value); });
    this.publish(c.workspaceId);
    return succeed(this.store.getConnection(id)!);
  }
  createConnection(workspaceId: string, input: CreateConnection): Result<Connection> {
    const w = this.store.getWorkspace(workspaceId);
    if (!w) return fail("NOT_FOUND", "espaço não encontrado");
    const rev = checkRevision(w, input.expectedRevision);
    if (!rev.ok) return rev;
    const a = this.store.getNode(input.sourceNodeId), b = this.store.getNode(input.targetNodeId);
    if (!a || !b || a.workspaceId !== workspaceId || b.workspaceId !== workspaceId) return fail("INVALID", "nós inválidos para este espaço");
    if (a.nodeId === b.nodeId) return fail("INVALID", "um nó não se conecta a si mesmo");
    if (this.store.listConnections(workspaceId).some((c) => c.sourceNodeId === a.nodeId && c.targetNodeId === b.nodeId)) return fail("CONFLICT", "conexão já existe");
    const c: Connection = { connectionId: newId(), workspaceId, sourceNodeId: a.nodeId, targetNodeId: b.nodeId, createdAt: nowIso(), ...(input.label ? { label: input.label } : {}) };
    this.store.transaction(() => { this.store.insertConnection(c); this.store.bumpRevision(workspaceId, rev.value); });
    this.publish(workspaceId);
    return succeed(c);
  }

  deleteConnection(connectionId: string, expectedRevision: number): Result<void> {
    const c = this.store.getConnection(connectionId);
    if (!c) return fail("NOT_FOUND", "conexão não encontrada");
    const w = this.store.getWorkspace(c.workspaceId)!;
    const rev = checkRevision(w, expectedRevision);
    if (!rev.ok) return rev;
    this.store.transaction(() => { this.store.deleteConnection(connectionId); this.store.bumpRevision(c.workspaceId, rev.value); });
    this.publish(c.workspaceId);
    return succeed(undefined);
  }

  /** Nós ligados a um nó, nos dois sentidos. Base para agentes lerem contexto. */
  connectedNodes(nodeId: string): Result<{ node: Node; direction: "in" | "out"; connectionId: string; agentType?: string }[]> {
    const me = this.store.getNode(nodeId);
    if (!me) return fail("NOT_FOUND", "nó não encontrado");
    const out: { node: Node; direction: "in" | "out"; connectionId: string; agentType?: string }[] = [];
    for (const c of this.store.listConnections(me.workspaceId)) {
      const otherId = c.sourceNodeId === nodeId ? c.targetNodeId : c.targetNodeId === nodeId ? c.sourceNodeId : null;
      if (!otherId) continue;
      const node = this.store.getNode(otherId);
      if (!node) continue;
      const row: { node: Node; direction: "in" | "out"; connectionId: string; agentType?: string } = { node, direction: c.sourceNodeId === nodeId ? "out" : "in", connectionId: c.connectionId };
      if (node.kind === "terminal" && node.sessionId) { const s = this.store.getSession(node.sessionId); if (s) row.agentType = agentKind(s.command, s.args).agentType; }
      out.push(row);
    }
    return succeed(out);
  }

  /** Identidade (agente de IA × shell) de um nó terminal. */
  private kindOfNode(node: Node): { isAgent: boolean; agentType: string } {
    if (node.kind === "terminal" && node.sessionId) { const s = this.store.getSession(node.sessionId); if (s) return agentKind(s.command, s.args); }
    return { isAgent: false, agentType: "genericShell" };
  }

  /** Envia mensagem de um nó terminal a outro nó conectado; entrega como prompt se o destino estiver rodando. */
  sendMessage(fromNodeId: string, input: SendMessage): Result<Message> {
    const from = this.store.getNode(fromNodeId);
    if (!from) return fail("NOT_FOUND", "nó de origem não encontrado");
    const nodes = this.store.listNodes(from.workspaceId);
    const to = resolveNodeRef(nodes, input.to);
    if (!to.ok) return to;
    if (to.value.kind !== "terminal") return fail("INVALID", "o destino precisa ser um terminal");
    const allowed = canMessage(this.store.listConnections(from.workspaceId), fromNodeId, to.value.nodeId);
    if (!allowed.ok) return allowed;
    const m: Message = { messageId: newId(), workspaceId: from.workspaceId, fromNodeId, toNodeId: to.value.nodeId, text: input.text, createdAt: nowIso(), delivered: false, ...(input.replyTo ? { replyTo: input.replyTo } : {}) };
    this.store.insertMessage(m);
    if (to.value.sessionId) {
      const d = this.sessions.deliver(to.value.sessionId, formatDelivery({ messageId: m.messageId, fromTitle: from.title, text: m.text, replyTo: m.replyTo }));
      if (d.ok) { this.store.markDelivered(m.messageId); m.delivered = true; }
    }
    this.emit("message", m);
    return succeed(m);
  }

  /**
   * `ask` bloqueante (paridade com o Maestri): entrega o prompt no destino e espera ele assentar,
   * devolvendo a "última tela" como resposta. Para shell cru isso traz a saída do comando; para
   * agente de IA, a resposta dele. Timeout/quiescência dependem do tipo (agente anima enquanto pensa).
   */
  async ask(fromNodeId: string, input: { to: string; text: string; timeoutMs?: number; noWait?: boolean; replyTo?: string }, opts: { bypassConnection?: boolean } = {}): Promise<Result<{ messageId: string; delivered: boolean; response: string; timedOut: boolean; agentType: string }>> {
    const from = this.store.getNode(fromNodeId);
    if (!from) return fail("NOT_FOUND", "nó de origem não encontrado");
    const nodes = this.store.listNodes(from.workspaceId);
    const to = resolveNodeRef(nodes, input.to);
    if (!to.ok) return to;
    if (to.value.kind !== "terminal") return fail("INVALID", "o destino precisa ser um terminal");
    const allowed = opts.bypassConnection && fromNodeId !== to.value.nodeId ? succeed(undefined) : canMessage(this.store.listConnections(from.workspaceId), fromNodeId, to.value.nodeId); // #70 mesma banda dispensa a ligação
    if (!allowed.ok) return allowed;
    const kind = this.kindOfNode(to.value);
    const m: Message = { messageId: newId(), workspaceId: from.workspaceId, fromNodeId, toNodeId: to.value.nodeId, text: input.text, createdAt: nowIso(), delivered: false, ...(input.replyTo ? { replyTo: input.replyTo } : {}) };
    this.store.insertMessage(m);
    const payload = formatDelivery({ messageId: m.messageId, fromTitle: from.title, text: m.text, replyTo: input.replyTo });
    const sid = to.value.sessionId;
    const deliverNow = () => { const d = this.sessions.deliver(sid!, payload); if (d.ok) { this.store.markDelivered(m.messageId); m.delivered = true; } return d.ok; };
    if (!sid || this.sessions.get(sid)?.state !== "running") {
      this.emit("message", m); // fica na caixa de entrada para quando subir
      return succeed({ messageId: m.messageId, delivered: false, response: "", timedOut: false, agentType: kind.agentType });
    }
    if (input.noWait) { deliverNow(); this.emit("message", m); return succeed({ messageId: m.messageId, delivered: m.delivered, response: "", timedOut: false, agentType: kind.agentType }); }
    const idleMs = kind.isAgent ? 1500 : 600;
    const timeoutMs = Math.min(input.timeoutMs ?? (kind.isAgent ? 180_000 : 20_000), 600_000);
    const cap = await this.sessions.awaitReply(sid, { idleMs, timeoutMs, trigger: deliverNow });
    this.emit("message", m);
    // A resposta é a "última tela" renderizada (o headless resolve os \r de sobrescrita), não o
    // fluxo bruto — senão o cabeçalho/corpo se misturam na mesma linha por causa do carriage return.
    const screen = this.sessions.screen(sid) ?? "";
    return succeed({ messageId: m.messageId, delivered: m.delivered, response: this.cleanReply(stripAnsi(screen)), timedOut: cap.timedOut, agentType: kind.agentType });
  }

  /**
   * Limpa a captura: remove o eco do nosso cabeçalho (`[MessAI] …` até o fim da linha — num shell
   * ele vem depois do prompt, ex. `$ # [MessAI] …`, por isso não dá pra ancorar no início), apara
   * espaços à direita e colapsa linhas vazias repetidas.
   */
  private cleanReply(s: string): string {
    const lines = s.split(/\r?\n/).map((l) => l.replace(/#?\s*\[MessAI\][^\n]*$/, "").replace(/\s+$/, ""));
    const out: string[] = [];
    for (const l of lines) { if (l === "" && (out.length === 0 || out[out.length - 1] === "")) continue; out.push(l); }
    return out.join("\n").trim();
  }

  /** Lê a tela atual de um terminal conectado, sem enviar nada (paridade com `maestri check`). */
  checkPeer(fromNodeId: string, ref: string): Result<{ agentType: string; screen: string }> {
    const from = this.store.getNode(fromNodeId);
    if (!from) return fail("NOT_FOUND", "nó de origem não encontrado");
    const nodes = this.store.listNodes(from.workspaceId);
    const to = resolveNodeRef(nodes, ref);
    if (!to.ok) return to;
    if (to.value.kind !== "terminal") return fail("INVALID", "o destino precisa ser um terminal");
    const allowed = canMessage(this.store.listConnections(from.workspaceId), fromNodeId, to.value.nodeId);
    if (!allowed.ok) return allowed;
    const screen = to.value.sessionId ? this.sessions.screen(to.value.sessionId) : undefined;
    return succeed({ agentType: this.kindOfNode(to.value).agentType, screen: screen ?? "" });
  }

  inbox(nodeId: string, unreadOnly: boolean, markRead: boolean): Result<{ messages: (Message & { fromTitle: string })[] }> {
    const me = this.store.getNode(nodeId);
    if (!me) return fail("NOT_FOUND", "nó não encontrado");
    const titles = new Map(this.store.listNodes(me.workspaceId).map((n) => [n.nodeId, n.title]));
    const list = this.store.listInbox(nodeId, unreadOnly).map((m) => ({ ...m, fromTitle: titles.get(m.fromNodeId) ?? m.fromNodeId.slice(0, 8) }));
    if (markRead && list.length) { this.store.markRead(list.map((m) => m.messageId), nowIso()); this.publish(me.workspaceId); }
    return succeed({ messages: list });
  }

  getMessage(id: string): Message | undefined { return this.store.getMessage(id); }
  unreadCounts(workspaceId: string): Record<string, number> { return this.store.unreadCounts(workspaceId); }

  patchNode(nodeId: string, input: PatchNode, byAgent = false): Result<Node> {
    const node = this.store.getNode(nodeId);
    if (!node) return fail("NOT_FOUND", "nó não encontrado");
    const w = this.store.getWorkspace(node.workspaceId)!;
    const rev = checkRevision(w, input.expectedRevision);
    if (!rev.ok) return rev;
    if (node.kind === "note" && byAgent && node.locked && (input.content !== undefined || input.title !== undefined || input.filePath !== undefined)) return fail("FORBIDDEN", "nota bloqueada: agentes só podem ler");
    if (typeof input.groupId === "string") { const g = this.store.getGroup(input.groupId); if (!g || g.workspaceId !== node.workspaceId) return fail("NOT_FOUND", "grupo não encontrado neste espaço"); } // #78
    let title = input.title; let titleAuto: boolean | undefined;
    let filePath: string | undefined;
    if (node.kind === "note") {
      if (input.title !== undefined) titleAuto = false;
      else if (input.content !== undefined && this.store.isTitleAuto(nodeId)) title = deriveNoteTitle(input.content) ?? "Nota";
      if (input.filePath && input.filePath !== node.filePath) {
        if (!/\.(md|markdown|txt)$/i.test(input.filePath)) return fail("INVALID", "o destino precisa ser .md ou .txt");
        if (existsSync(input.filePath)) return fail("CONFLICT", "já existe um arquivo nesse caminho");
        mkdirSync(dirname(input.filePath), { recursive: true });
        if (node.filePath && existsSync(node.filePath)) renameSync(node.filePath, input.filePath); else writeFileSync(input.filePath, node.content ?? "");
        filePath = input.filePath; this.noteMtime.delete(nodeId);
      }
    }
    this.store.transaction(() => {
      this.store.updateNode(nodeId, { title, geometry: input.geometry ? normalizeGeometry(input.geometry) : undefined, content: input.content, locked: input.locked, color: input.color, filePath, titleAuto, icon: input.icon, termTheme: input.termTheme === "system" ? null : input.termTheme, groupId: input.groupId, maestro: node.kind === "terminal" ? input.maestro : undefined, memLimitMb: node.kind === "terminal" && input.memLimitMb !== undefined ? (input.memLimitMb || null) : undefined });
      if (input.groupId !== undefined) this.store.pruneEmptyGroups(node.workspaceId); // #78 sair de um grupo pode esvaziá-lo
      this.store.bumpRevision(node.workspaceId, rev.value);
    });
    if (node.kind === "note" && input.content !== undefined) this.writeNoteFile(this.store.getNode(nodeId)!, input.content);
    else if (filePath) { try { this.noteMtime.set(nodeId, statSync(filePath).mtimeMs); } catch { /* ignorar */ } }
    if (input.skillIds !== undefined) { const r = this.setNodeSkills(nodeId, input.skillIds); if (!r.ok) return r; } // já publica (e reinicia o processo se rodando)
    if (input.roleId !== undefined && (node.roleId ?? null) !== input.roleId) {
      const r = this.setNodeRole(nodeId, input.roleId); // já publica
      if (!r.ok) return r;
    } else if (input.skillIds === undefined) this.publish(node.workspaceId);
    return succeed(this.store.getNode(nodeId)!);
  }

  deleteNode(nodeId: string, expectedRevision: number): Result<void> {
    const node = this.store.getNode(nodeId);
    if (!node) return fail("NOT_FOUND", "nó não encontrado");
    const w = this.store.getWorkspace(node.workspaceId)!;
    const rev = checkRevision(w, expectedRevision);
    if (!rev.ok) return rev;
    if (node.sessionId) this.sessions.dispose(node.sessionId);
    if (node.kind === "note" && node.filePath) this.unwatchNote(node.filePath);
    if (node.kind === "note" && node.filePath && node.filePath.startsWith(this.notesDir(node.workspaceId))) { try { unlinkSync(node.filePath); } catch { /* já removido */ } }
    this.noteMtime.delete(nodeId);
    this.store.transaction(() => {
      if (node.sessionId) this.store.deleteSession(node.sessionId);
      this.store.deleteNode(nodeId);
      if (node.groupId) this.store.pruneEmptyGroups(node.workspaceId); // #78
      for (const b of this.store.listBands(node.workspaceId)) if (b.nodeIds.includes(nodeId)) this.store.updateBand(b.bandId, { nodeIds: b.nodeIds.filter((i) => i !== nodeId) }); // #70
      this.store.bumpRevision(node.workspaceId, rev.value);
    });
    this.publish(node.workspaceId);
    return succeed(undefined);
  }

  // ---------- #70 Bandas ----------
  private asking = new Map<string, Set<string>>(); // bandId -> nós com pergunta em andamento (efêmero)
  private bandView(b: Band): Band {
    const alive = new Set(this.store.listNodes(b.workspaceId).filter((n) => n.kind === "terminal").map((n) => n.nodeId));
    return { ...b, nodeIds: b.nodeIds.filter((id) => alive.has(id)), asking: [...(this.asking.get(b.bandId) ?? [])] };
  }
  listBands(workspaceId: string): Band[] { return this.store.listBands(workspaceId).map((b) => this.bandView(b)); }
  private validBandNodes(workspaceId: string, ids: string[] | undefined): string[] {
    return [...new Set(ids ?? [])].filter((id) => { const n = this.store.getNode(id); return n?.kind === "terminal" && n.workspaceId === workspaceId; });
  }
  createBand(workspaceId: string, input: CreateBand): Result<Band> {
    if (!this.store.getWorkspace(workspaceId)) return fail("NOT_FOUND", "espaço não encontrado");
    const name = input.name.trim(); if (!name) return fail("INVALID", "a banda precisa de um nome");
    if (this.store.listBands(workspaceId).some((b) => b.name.toLowerCase() === name.toLowerCase())) return fail("CONFLICT", `já existe uma banda "${name}" neste espaço`);
    const b: Band = { bandId: newId(), workspaceId, name, color: input.color ?? "", nodeIds: this.validBandNodes(workspaceId, input.nodeIds), asking: [], createdAt: nowIso() };
    this.store.insertBand(b);
    this.publish(workspaceId);
    return succeed(this.bandView(b));
  }
  patchBand(id: string, input: PatchBand): Result<Band> {
    const b = this.store.getBand(id);
    if (!b) return fail("NOT_FOUND", "banda não encontrada");
    const name = input.name?.trim();
    if (name && this.store.listBands(b.workspaceId).some((o) => o.bandId !== id && o.name.toLowerCase() === name.toLowerCase())) return fail("CONFLICT", `já existe uma banda "${name}" neste espaço`);
    const remove = new Set(input.removeNodeIds ?? []);
    const ids = [...new Set([...this.bandView(b).nodeIds, ...this.validBandNodes(b.workspaceId, input.addNodeIds)])].filter((n) => !remove.has(n));
    this.store.updateBand(id, { name: name || undefined, color: input.color, nodeIds: ids });
    this.publish(b.workspaceId);
    return succeed(this.bandView(this.store.getBand(id)!));
  }
  deleteBand(id: string): Result<void> {
    const b = this.store.getBand(id);
    if (!b) return fail("NOT_FOUND", "banda não encontrada");
    this.store.deleteBand(id); this.asking.delete(id);
    this.publish(b.workspaceId);
    return succeed(undefined);
  }
  /** Banda por id (ou prefixo) ou nome, dentro de um espaço. */
  findBand(workspaceId: string, ref: string): Result<Band> {
    const r = ref.trim().toLowerCase();
    const hits = this.store.listBands(workspaceId).filter((b) => b.bandId === r || b.bandId.startsWith(r) || b.name.toLowerCase() === r);
    if (hits.length === 1) return succeed(this.bandView(hits[0]!));
    return hits.length ? fail("CONFLICT", `"${ref}" é ambíguo entre bandas`) : fail("NOT_FOUND", `nenhuma banda corresponde a "${ref}"`);
  }
  /**
   * Pergunta (ou, com `noWait`, transmite) o mesmo texto a todos os membros em paralelo e coleta a "última tela" de cada um.
   * Humano (sem `fromNodeId`): digita o texto nos terminais. Agente: mensagem rastreável (`ask`); só fala com quem está
   * conectado a ele — ou, se ele próprio é da banda, com os colegas dela.
   */
  async askBand(bandId: string, input: AskBand): Promise<Result<BandAskResult>> {
    const band0 = this.store.getBand(bandId);
    if (!band0) return fail("NOT_FOUND", "banda não encontrada");
    const band = this.bandView(band0);
    const from = input.fromNodeId ? this.store.getNode(input.fromNodeId) : undefined;
    if (input.fromNodeId && (!from || from.workspaceId !== band.workspaceId)) return fail("NOT_FOUND", "nó de origem não encontrado neste espaço");
    const members = band.nodeIds.map((id) => this.store.getNode(id)!).filter((n) => n && n.nodeId !== from?.nodeId);
    if (!members.length) return fail("INVALID", "a banda não tem outros membros");
    const conns = from ? this.store.listConnections(band.workspaceId) : [];
    const inBand = !!from && band.nodeIds.includes(from.nodeId);
    const set = this.asking.get(bandId) ?? new Set<string>(); this.asking.set(bandId, set);
    const one = async (to: Node): Promise<BandAnswer> => {
      const kind = this.kindOfNode(to);
      const base = { nodeId: to.nodeId, title: to.title, agentType: kind.agentType };
      const fail1 = (error: string, delivered = false): BandAnswer => ({ ...base, delivered, response: "", timedOut: false, error });
      const sid = to.sessionId;
      if (from) {
        if (!inBand) { const ok = canMessage(conns, from.nodeId, to.nodeId); if (!ok.ok) return fail1(ok.error.message); }
        set.add(to.nodeId);
        try {
          const r = await this.ask(from.nodeId, { to: to.nodeId, text: input.text, ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}), ...(input.noWait ? { noWait: true } : {}) }, { bypassConnection: true });
          return r.ok ? { ...base, delivered: r.value.delivered, response: r.value.response, timedOut: r.value.timedOut } : fail1(r.error.message);
        } finally { set.delete(to.nodeId); }
      }
      if (!sid || this.sessions.get(sid)?.state !== "running") return fail1("o terminal não está rodando");
      const type = () => { this.sessions.deliver(sid, `${input.text.replace(/\r?\n/g, " ")}\r`); };
      if (input.noWait) { type(); return { ...base, delivered: true, response: "", timedOut: false }; }
      set.add(to.nodeId);
      try {
        const cap = await this.sessions.awaitReply(sid, { idleMs: kind.isAgent ? 1500 : 600, timeoutMs: Math.min(input.timeoutMs ?? (kind.isAgent ? 180_000 : 20_000), 600_000), trigger: type });
        return { ...base, delivered: true, response: this.cleanReply(stripAnsi(this.sessions.screen(sid) ?? "")), timedOut: cap.timedOut };
      } finally { set.delete(to.nodeId); }
    };
    if (!input.noWait) this.publish(band.workspaceId);
    const answers: BandAnswer[] = [];
    const tick = input.noWait ? undefined : setInterval(() => { try { this.publish(band.workspaceId); } catch { /* espaço removido */ } }, 1500);
    try {
      answers.push(...await Promise.all(members.map(async (m) => { const a = await one(m); if (!input.noWait && this.store.getWorkspace(band.workspaceId)) this.publish(band.workspaceId); return a; })));
    } finally { if (tick) clearInterval(tick); }
    return succeed({ bandId, name: band.name, answers });
  }
  /** Transmitir (broadcast): entrega e não espera resposta. */
  broadcastBand(bandId: string, input: Omit<AskBand, "noWait" | "timeoutMs">): Promise<Result<BandAskResult>> { return this.askBand(bandId, { ...input, noWait: true }); }

  // ---------- #29 Modo Maestro ----------
  /** O terminal precisa ser condutor. (Hoje o token do runtime é global — a credencial por agente é o #87; aqui a regra vale para o CLI/API.) */
  private requireMaestro(nodeId: string): Result<Node> {
    const n = this.store.getNode(nodeId);
    if (!n || n.kind !== "terminal") return fail("NOT_FOUND", "terminal não encontrado");
    if (!n.maestro) return fail("FORBIDDEN", "este terminal não é um condutor: ligue o Modo Maestro nele");
    return succeed(n);
  }
  /** Alvo de dispensar/reatribuir: terminal do mesmo espaço, ligado ao condutor (ele recruta e ligou), nunca o próprio condutor. */
  private maestroTarget(maestro: Node, ref: string): Result<Node> {
    const to = resolveNodeRef(this.store.listNodes(maestro.workspaceId).filter((n) => n.kind === "terminal"), ref);
    if (!to.ok) return to;
    if (to.value.nodeId === maestro.nodeId) return fail("INVALID", "o condutor não age sobre si mesmo");
    const ok = canMessage(this.store.listConnections(maestro.workspaceId), maestro.nodeId, to.value.nodeId);
    if (!ok.ok) return fail("FORBIDDEN", "o condutor só age sobre terminais ligados a ele");
    return succeed(to.value);
  }
  private freeSpotNear(anchor: Node, nodes: Node[], w: number, h: number): Node["geometry"] {
    const x = anchor.geometry.x + anchor.geometry.w + 60;
    for (let k = 0; k < 40; k++) {
      const y = anchor.geometry.y + k * (h + 30);
      if (!nodes.some((n) => x < n.geometry.x + n.geometry.w && x + w > n.geometry.x && y < n.geometry.y + n.geometry.h && y + h > n.geometry.y)) return { x, y, w, h };
    }
    return { x, y: anchor.geometry.y + 40 * (h + 30), w, h };
  }
  /** Recruta um terminal (por preset ou comando), liga ao condutor, opcionalmente com papel e numa banda. */
  recruit(maestroId: string, input: MaestroRecruit): Result<{ node: Node; bandId?: string }> {
    const m = this.requireMaestro(maestroId); if (!m.ok) return m;
    const maestro = m.value;
    const w = this.store.getWorkspace(maestro.workspaceId)!;
    let command = input.command; let args = input.args ?? []; let preset: PresetInput | undefined;
    if (input.preset) {
      const p = input.preset.toLowerCase();
      preset = this.presetDefs().find((x) => x.enabled && (x.id === p || x.label.toLowerCase() === p));
      if (!preset) return fail("NOT_FOUND", `preset não encontrado (ou desligado): ${input.preset}`);
      if (preset.target !== "terminal") return fail("INVALID", "esse preset não abre terminal");
      command = preset.command; args = input.args ?? preset.args;
    }
    if (!command) return fail("INVALID", "informe um preset ou um comando para recrutar");
    let roleId: string | undefined;
    if (input.roleName) { const r = this.store.listRoles().find((x) => x.name.toLowerCase() === input.roleName!.toLowerCase()); if (!r) return fail("NOT_FOUND", `papel não encontrado: ${input.roleName}`); roleId = r.roleId; }
    const geometry = this.freeSpotNear(maestro, this.store.listNodes(w.workspaceId), 560, 340);
    const made = this.createNode(w.workspaceId, { expectedRevision: w.revision, kind: "terminal", title: input.name ?? preset?.label ?? "Agente", geometry, command, args, ...(input.cwd ? { cwd: input.cwd } : {}), ...(roleId ? { roleId } : {}), ...(preset?.color ? { color: preset.color } : {}), ...(preset?.icon ? { icon: preset.icon } : {}), ...(preset && preset.theme !== "system" ? { termTheme: preset.theme } : {}), ...(input.persistent ? { persistent: true } : {}) });
    if (!made.ok) return made;
    const node = made.value.node;
    const link = this.createConnection(w.workspaceId, { expectedRevision: this.store.getWorkspace(w.workspaceId)!.revision, sourceNodeId: maestro.nodeId, targetNodeId: node.nodeId });
    if (!link.ok) return link;
    let bandId: string | undefined;
    if (input.band) {
      let b = this.findBand(w.workspaceId, input.band);
      if (!b.ok && b.error.code === "NOT_FOUND") b = this.createBand(w.workspaceId, { name: input.band });
      if (!b.ok) return b;
      const pb = this.patchBand(b.value.bandId, { addNodeIds: [node.nodeId, ...(b.value.nodeIds.includes(maestro.nodeId) ? [] : [maestro.nodeId])] });
      if (!pb.ok) return pb;
      bandId = pb.value.bandId;
    }
    return succeed({ node: this.store.getNode(node.nodeId)!, ...(bandId ? { bandId } : {}) });
  }
  /** Dispensa (encerra e remove) um terminal ligado ao condutor. */
  dismiss(maestroId: string, ref: string): Result<{ nodeId: string; title: string }> {
    const m = this.requireMaestro(maestroId); if (!m.ok) return m;
    const t = this.maestroTarget(m.value, ref); if (!t.ok) return t;
    const w = this.store.getWorkspace(m.value.workspaceId)!;
    const r = this.deleteNode(t.value.nodeId, w.revision); if (!r.ok) return r;
    return succeed({ nodeId: t.value.nodeId, title: t.value.title });
  }
  /** Reatribui o papel de um terminal ligado ao condutor (reinicia só o processo dele); `null` remove. */
  assignRole(maestroId: string, ref: string, roleName: string | null): Result<Node> {
    const m = this.requireMaestro(maestroId); if (!m.ok) return m;
    const t = this.maestroTarget(m.value, ref); if (!t.ok) return t;
    let roleId: string | null = null;
    if (roleName !== null) { const r = this.store.listRoles().find((x) => x.name.toLowerCase() === roleName.toLowerCase()); if (!r) return fail("NOT_FOUND", `papel não encontrado: ${roleName}`); roleId = r.roleId; }
    return this.setNodeRole(t.value.nodeId, roleId);
  }

  // ---------- #80 Monitor de processos do terminal + limite de memória ----------
  private effectiveRootPid(s: Session): number | null {
    if (s.state !== "running") return null;
    if (s.persistent) {
      try {
        const out = execFileSync("tmux", ["-L", this.cfg.tmuxSocket, "list-panes", "-t", tmuxSessionName(s.sessionId), "-F", "#{pane_pid}"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
        const p = Number(out.split(/\s+/)[0]);
        if (Number.isInteger(p) && p > 0) return p;
      } catch { /* fallback pro pid do pty */ }
    }
    return s.pid ?? null;
  }
  sessionProcs(sessionId: string): Result<SessionProcs> {
    const s = this.sessions.get(sessionId);
    if (!s) return fail("NOT_FOUND", "sessão não encontrada");
    const node = this.store.getNode(s.nodeId);
    const cfg = this.settings();
    const limitMb = (node?.memLimitMb && node.memLimitMb > 0) ? node.memLimitMb : (cfg.termMemLimitMb && cfg.termMemLimitMb > 0 ? cfg.termMemLimitMb : null);
    const action = cfg.termMemAction === "kill" ? "kill" : "warn";
    const rootPid = this.effectiveRootPid(s);
    const processes = rootPid ? readProcTree(rootPid) : [];
    const totalRssKb = processes.reduce((acc, p) => acc + p.rssKb, 0);
    const overLimit = limitMb !== null && totalRssKb > limitMb * 1024;
    if (overLimit && action === "kill" && s.state === "running") {
      // Encerra o processo filho que mais consome memória (ou a sessão se só houver o shell raiz)
      const children = processes.filter((p) => p.pid !== rootPid).sort((a, b) => b.rssKb - a.rssKb);
      if (children[0]) { try { process.kill(children[0].pid, "SIGKILL"); } catch { /* já saiu */ } }
      else this.sessions.stop(sessionId);
    }
    return succeed({ sessionId, nodeId: s.nodeId, rootPid, totalRssKb, limitMb, overLimit, action, processes });
  }
  killSessionProc(sessionId: string, input: KillProcInput): Result<{ killed: number }> {
    const s = this.sessions.get(sessionId);
    if (!s) return fail("NOT_FOUND", "sessão não encontrada");
    const rootPid = this.effectiveRootPid(s);
    if (!rootPid) return fail("SESSION_NOT_RUNNING", "o terminal não está rodando");
    const tree = readProcTree(rootPid);
    if (!tree.some((p) => p.pid === input.pid)) return fail("FORBIDDEN", "o processo não pertence à árvore deste terminal");
    try { process.kill(input.pid, input.signal ?? "SIGTERM"); } catch (e) { return fail("INTERNAL", String((e as Error).message ?? e)); }
    return succeed({ killed: input.pid });
  }
}