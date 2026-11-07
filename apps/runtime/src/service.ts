import { AGENT_ENV, type TreeEntry, type FileContent, type FsOp, type SearchHit, type CreateFloor, type LandFloor, type LandResult, type Role, type CreateRole, type PatchRole, type ChatMessage, type SendChat, type Attachment, type CreateAttachment, type FileEntry, type Connection, type CreateConnection, type PatchConnection, type CreateDrawing, type PatchDrawing, type GroupDrawings, type CreateFolder, type CreateNode, type Drawing, type Folder, type Message, type PatchFolder, type SendMessage, type Sidebar, type CreateWorkspace, type Node, type PatchNode, type PatchWorkspace, type Session, type Workspace, type WorkspaceSnapshot, type TaskFinished, type TaskSummary } from "@messai/contracts";
import type { RuntimeSettings, PatchRuntimeSettings, PresetInput, Skill, CreateSkill, PatchSkill, FindHit, FindKind, NodeGroup, CreateNodeGroup, PatchNodeGroup, AttentionItem, Score, ScoreNode, SaveScore, PatchScore, PlaceScore, PlaceScoreResult } from "@messai/contracts";
import type { ChatAttachment, ExportAttachment, InstructionsStatus, InstructionFileInfo, PutInstructions, SyncInstructions } from "@messai/contracts";
import type { Band, CreateBand, PatchBand, AskBand, BandAnswer, BandAskResult, MaestroRecruit, BinderOp, BinderView } from "@messai/contracts";
import type { FloorHookSection, FloorHooksConfig, PutFloorHooks, FloorHookStatus, FloorHooksState, RunFloorHookInput, StopFloorHookInput, FloorCopyInfo, PutFloorExcludes, ConnectedPeer, CrossNodeCandidate, GitHostEntry, PutGitHostsInput, FloorPrState, CreateFloorPrInput, PatchFloorPrInput, FloorPrReviewStatus, FloorPrChecksStatus, EnvVarEntry, PutEnvVarsInput, EnvironmentsState, WorkspaceBundle, WorkspaceBundlePreview, ImportWorkspaceInput, DuplicateWorkspaceInput, BundleNode, BundleConnection, BundleGroup, BundleBand, BundleDrawing, NotificationItem, NotificationKind, SendNotifyInput, Routine, CreateRoutineInput, PatchRoutineInput, RoutineRunResult } from "@messai/contracts";
import { WORKSPACE_BUNDLE_FORMAT } from "@messai/contracts";
import type { AgentCapability, IssueAgentTokenInput, AgentTokenInfo, Approval, CreateApproval, NodeIsolation } from "@messai/contracts";
import { ISOLATED_APPROVABLE_CAPS, ISOLATED_DEFAULT_CAPS, validateIsolation, normalizePortalUrl, parsePortal, serializePortal } from "@messai/domain";
import { PortalManager, type PortalFrame } from "./portal.js";
import { DeviceManager, listDevices, type DeviceFrame } from "./device.js";
import type { DeviceList, DeviceState, DeviceAct, DeviceActResult, DeviceUiTree, DeviceScreenshot } from "@messai/contracts";
import { isAdbSerial, isAvdName } from "@messai/domain";
import type { PortalState, PortalAct, PortalActResult, PortalSnapshot, PortalScreenshot } from "@messai/contracts";
import { buildIsolatedPlan, probeIsolation } from "./isolation.js";
import { readProcTree } from "./procs.js";
import * as gitops from "./git.js";
import { isSafeRef } from "./git.js";
import type { GitInfo, GitCommitEntry, GitDiff, GitOpResult, GitCommitInput, GitBranchInput, GitCheckoutInput, GitMergeInput, GitPushInput } from "@messai/contracts";
import type { SessionProcs, KillProcInput } from "@messai/contracts";
import { listProviders } from "./providers.js";
import { probeAccounts } from "./accounts.js";
import { backupName, copyBackupFiles, dataStats, isBackupName, listBackups, validateBackup, validateMoveTarget, writeManifest, type BackupEntry } from "./data.js";
import { BUILD_VERSION } from "@messai/contracts";
import { defaultPresets, parsePresets, validatePresets, PRESETS_META_KEY } from "./presets.js";
import { applyRole, withAgentAutonomy, parseNodeColor, parseBinder, serializeBinder, binderAddPage, binderPatchPage, binderFindPage, binderDeletePage, binderMovePage, binderBringToFront, binderSetActive, roleText, deriveNoteTitle, noteFileName, wrapInTmux, tmuxSessionName, slugify, floorGitPlan, parseMergeConflicts, DEFAULT_FLOOR_EXCLUDES, normalizeFloorExcludes, shouldExcludeFloorDir, parseGitRemote, buildPrCompareUrl, normalizeEnvVars, mergeEnvLayers, safeRelPath, isWithinCanonicalRoot, looksBinary, canMessage, checkRevision, formatDelivery, normalizeGeometry, planLocalTerminal, resolveNodeRef, resolveCrossNodeRef, validateNewNode, agentKind, agentResume, stripAnsi, fail, succeed, type Result, applySkills, skillsText, placeGeometries, connectionsWithin } from "@messai/domain";
import { createHash, randomUUID, randomBytes, timingSafeEqual } from "node:crypto";
import { Companion } from "./companion.js";
import type { Store } from "@messai/storage";
import { EventEmitter } from "node:events";
import { newId, nowIso, type Config } from "./config.js";
import { dirname, join, delimiter, basename, extname, relative, isAbsolute, resolve } from "node:path";
import { chmodSync, closeSync, constants as fsConstants, copyFileSync, existsSync, lstatSync, mkdirSync, openSync, readlinkSync, realpathSync, readSync, readdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
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

export type ServiceEvents = { workspace: [snapshot: WorkspaceSnapshot]; message: [message: Message]; sidebar: [sidebar: Sidebar]; chat: [message: ChatMessage]; taskSummary: [summary: TaskSummary]; floorHook: [workspaceId: string, status: FloorHookStatus]; notification: [notification: NotificationItem]; approval: [approval: Approval]; portalFrame: [nodeId: string, frame: PortalFrame]; portalState: [state: PortalState]; deviceFrame: [nodeId: string, frame: DeviceFrame]; deviceState: [state: DeviceState] };

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

/** Conteúdo do nó `device`: JSON {serial?, avd?} (a última seleção). Tolerante a lixo; só valores bem formados. */
function parseDeviceContent(content: string | undefined): { serial?: string; avd?: string } {
  try { const j = JSON.parse(content ?? "") as { serial?: unknown; avd?: unknown }; return { ...(typeof j.serial === "string" && isAdbSerial(j.serial) ? { serial: j.serial } : {}), ...(typeof j.avd === "string" && isAvdName(j.avd) ? { avd: j.avd } : {}) }; } catch { return {}; }
}

export class WorkspaceService extends EventEmitter<ServiceEvents> {
  /** Companheiro (#66): resume turnos concluídos com modelo local; sem Ollama, fica quieto. */
  readonly companion: Companion;
  /** #73 dispositivos Android: uma sessão adb por nó `device`; a seleção (serial/AVD) é gravada no nó SEM mexer na revisão do espaço. */
  readonly devices = new DeviceManager({
    onState: (_id, st) => this.emit("deviceState", st),
    onFrame: (id, f) => this.emit("deviceFrame", id, f),
    onBound: (id, sel) => { const n = this.store.getNode(id); if (n?.kind === "device") { const cur = JSON.stringify(parseDeviceContent(n.content)); const next = JSON.stringify({ ...parseDeviceContent(n.content), ...sel }); if (cur !== next) this.store.updateNode(id, { content: next }); } },
  });
  /** #26 portais: um navegador por nó `portal`, criado sob demanda. A URL atual é gravada no conteúdo do nó SEM mexer na revisão do espaço. */
  readonly portals = new PortalManager({
    onState: (_id, st) => this.emit("portalState", st),
    onFrame: (id, f) => this.emit("portalFrame", id, f),
    onUrl: (id, url) => { const n = this.store.getNode(id); if (n?.kind === "portal" && parsePortal(n.content).url !== url) this.store.updateNode(id, { content: serializePortal({ url }) }); },
  });
  /** #85 histórico recente de notificações em memória (para inspeção e testes). */
  private recentNotifications: NotificationItem[] = [];
  /** #27 timer de execução de rotinas agendadas. */
  private routineTimer: ReturnType<typeof setInterval> | null = null;
  private runningRoutines = new Set<string>();
  constructor(private readonly cfg: Config, private readonly store: Store, readonly sessions: SessionManager) {
    super();
    this.companion = new Companion({ enabled: cfg.companionEnabled, ollamaUrl: cfg.ollamaUrl, ollamaModel: cfg.ollamaModel });
    // #65 → #66: cada turno concluído de agente vira (quando há modelo) um resumo + próximo passo, fora do caminho de requisição.
    this.sessions.on("taskFinished", (ev) => {
      const node = this.store.getNode(ev.nodeId);
      const ws = this.store.getWorkspace(ev.workspaceId);
      this.emitNotification({
        kind: "agent",
        title: node ? `${node.title}${ws ? ` (${ws.name})` : ""}` : "Agente concluiu",
        body: "Turno concluído — aguardando sua atenção.",
        workspaceId: ev.workspaceId,
        ...(ws ? { workspaceName: ws.name } : {}),
        nodeId: ev.nodeId,
        ...(node ? { nodeTitle: node.title } : {}),
      });
      void this.companion.summarize(ev).then((s) => { if (s) this.emit("taskSummary", s); });
    });
    this.routineTimer = setInterval(() => void this.tickRoutines(), 1000);
    this.routineTimer.unref();
    // #87 credencial do agente morre junto com a sessão dele
    this.sessions.on("session", (s) => {
      if (s.state === "exited" || s.state === "lost" || s.state === "unloaded") this.revokeAgentTokensForNode(s.nodeId);
    });
  }

  // ---- #87 [MESS-02] Credencial por agente + autorização por capacidade ----
  // Guardamos só o SHA-256 do token (persistido na meta para sobreviver ao reinício do runtime: o tmux mantém o env antigo).
  private agentTokensCache: Map<string, { nodeId: string; workspaceId: string; sessionId?: string; hook?: string; capabilities: AgentCapability[]; expiresAt: number }> | null = null;
  private static readonly AGENT_TOKENS_META = "agent.tokens";
  private static readonly AGENT_CAPS_META = "agent.caps";
  private hashToken(t: string): string { return createHash("sha256").update(t).digest("hex"); }
  private get agentTokens() {
    if (!this.agentTokensCache) {
      this.agentTokensCache = new Map();
      try { const j = JSON.parse(this.store.getMeta(WorkspaceService.AGENT_TOKENS_META) ?? "{}") as Record<string, { nodeId: string; workspaceId: string; sessionId?: string; hook?: string; capabilities: AgentCapability[]; expiresAt: number }>; for (const [k, v] of Object.entries(j)) this.agentTokensCache.set(k, v); } catch { /* meta corrompida: começa vazio */ }
    }
    return this.agentTokensCache;
  }
  private saveAgentTokens(): void { this.store.setMeta(WorkspaceService.AGENT_TOKENS_META, JSON.stringify(Object.fromEntries(this.agentTokens))); }
  private readNodeCaps(): Record<string, AgentCapability[]> { try { return JSON.parse(this.store.getMeta(WorkspaceService.AGENT_CAPS_META) ?? "{}") as Record<string, AgentCapability[]>; } catch { return {}; } }
  private writeNodeCaps(nodeId: string, caps: AgentCapability[] | null): void { const all = this.readNodeCaps(); if (caps) all[nodeId] = caps; else delete all[nodeId]; this.store.setMeta(WorkspaceService.AGENT_CAPS_META, JSON.stringify(all)); }
  /** Capacidades do agente de um terminal: as configuradas para o nó ou o padrão (maestro só para condutor). */
  agentCapsFor(node: Node): AgentCapability[] {
    const custom = this.readNodeCaps()[node.nodeId];
    if (custom) return [...custom];
    if (node.isolation) return [...ISOLATED_DEFAULT_CAPS]; // #93 isolado: nada que execute código fora do sandbox
    return ["files:read", "files:write", "chat:post", "nodes:read", "nodes:write", "messages:send", "workspace:manage", "terminal:control", "portals:control", "devices:control", ...(node.maestro ? ["maestro:conduct" as const] : [])];
  }
  /** Emite (rotaciona) a credencial do agente de um terminal; as anteriores do nó são revogadas. */
  issueAgentToken(nodeId: string, input?: IssueAgentTokenInput, sessionId?: string, ttlDefaultSeconds = 86400): Result<AgentTokenInfo> {
    const node = this.store.getNode(nodeId);
    if (!node || node.kind !== "terminal") return fail("NOT_FOUND", "terminal não encontrado");
    if (input?.capabilities) this.writeNodeCaps(nodeId, [...new Set(input.capabilities)]);
    this.revokeAgentTokensForNode(nodeId);
    const sid = sessionId ?? node.sessionId;
    const caps = this.agentCapsFor(node);
    const expiresAt = Date.now() + (input?.ttlSeconds ?? ttlDefaultSeconds) * 1000;
    const token = `agt_${randomBytes(32).toString("base64url")}`;
    this.agentTokens.set(this.hashToken(token), { nodeId, workspaceId: node.workspaceId, ...(sid ? { sessionId: sid } : {}), capabilities: caps, expiresAt });
    this.saveAgentTokens();
    return succeed({ token, nodeId, workspaceId: node.workspaceId, ...(sid ? { sessionId: sid } : {}), capabilities: caps, expiresAt: new Date(expiresAt).toISOString() });
  }
  revokeAgentTokensForNode(nodeId: string): Result<{ revoked: number }> {
    let revoked = 0;
    for (const [k, v] of this.agentTokens) if (v.nodeId === nodeId) { this.agentTokens.delete(k); revoked++; }
    if (revoked) this.saveAgentTokens();
    return succeed({ revoked });
  }
  /** Identifica quem chama: o desktop (token mestre) ou um agente (credencial própria, com capacidades). */
  authenticateToken(raw: string | undefined): { kind: "desktop" } | { kind: "agent"; nodeId: string; workspaceId: string; sessionId?: string; capabilities: Set<AgentCapability> } | null {
    if (!raw) return null;
    const a = Buffer.from(raw); const b = Buffer.from(this.cfg.token);
    if (a.length === b.length && timingSafeEqual(a, b)) return { kind: "desktop" };
    if (!raw.startsWith("agt_")) return null;
    const key = this.hashToken(raw);
    const t = this.agentTokens.get(key);
    if (!t) return null;
    const drop = () => { this.agentTokens.delete(key); this.saveAgentTokens(); return null; };
    if (t.expiresAt <= Date.now()) return drop();
    if (t.hook) { if (!this.store.getWorkspace(t.workspaceId)) return drop(); }
    else if (!this.store.getNode(t.nodeId)) return drop();
    if (t.sessionId) {
      const s = this.store.getSession(t.sessionId);
      if (!s || s.state === "exited" || s.state === "lost" || s.state === "unloaded") return drop();
    }
    return { kind: "agent", nodeId: t.nodeId, workspaceId: t.workspaceId, ...(t.sessionId ? { sessionId: t.sessionId } : {}), capabilities: new Set(t.capabilities) };
  }
  /** Térreo do espaço (ele mesmo ou o pai do andar) — unidade de escopo das credenciais de agente. */
  groundOf(workspaceId: string): string | undefined { const w = this.store.getWorkspace(workspaceId); return w ? (w.parentId ?? w.workspaceId) : undefined; }
  isFloor(workspaceId: string): boolean { return !!this.store.getWorkspace(workspaceId)?.parentId; }
  nodeWorkspaceId(nodeId: string): string | undefined { return this.store.getNode(nodeId)?.workspaceId; }
  sessionWorkspaceId(sessionId: string): string | undefined { return this.store.getSession(sessionId)?.workspaceId; }
  /** Credencial de um hook de andar: escopo do espaço, sem Maestro, revogada quando o hook termina. */
  private issueHookToken(w: Workspace, section: string): string {
    const hook = `${w.workspaceId}:${section}`;
    this.revokeHookToken(hook);
    const token = `agt_${randomBytes(32).toString("base64url")}`;
    this.agentTokens.set(this.hashToken(token), { nodeId: w.workspaceId, workspaceId: w.workspaceId, hook, capabilities: ["files:read", "files:write", "chat:post", "nodes:read", "nodes:write", "messages:send", "workspace:manage"], expiresAt: Date.now() + 7 * 86400 * 1000 });
    this.saveAgentTokens();
    return token;
  }
  private revokeHookToken(hook: string): void {
    let n = 0; for (const [k, v] of this.agentTokens) if (v.hook === hook) { this.agentTokens.delete(k); n++; }
    if (n) this.saveAgentTokens();
  }
  /**
   * Reanexação de tmux vivo: o processo já tem o MESS_TOKEN no env (o `new-session -A` ignora o -e novo),
   * então mantemos a credencial persistida dessa sessão. Se não houver (sessão de versão anterior), emite uma.
   */
  private reattachToken(node: Node, s: Session): string {
    const now = Date.now();
    for (const v of this.agentTokens.values()) if (v.nodeId === node.nodeId && v.sessionId === s.sessionId && v.expiresAt > now) return "";
    return this.agentTokenForSpawn(node, s);
  }
  /** Credencial nova (rotacionada) para cada processo de terminal que sobe; vive enquanto a sessão viver. */
  private agentTokenForSpawn(node: Node, s: Session): string {
    const issued = this.issueAgentToken(node.nodeId, undefined, s.sessionId, 365 * 86400);
    return issued.ok ? issued.value.token : "";
  }

  // ---- #85 Notificações do SO + mess notify ----
  emitNotification(input: Omit<NotificationItem, "notificationId" | "createdAt">): NotificationItem {
    const item: NotificationItem = {
      notificationId: newId(),
      createdAt: nowIso(),
      ...input,
    };
    this.recentNotifications.unshift(item);
    if (this.recentNotifications.length > 100) this.recentNotifications.length = 100;
    this.emit("notification", item);
    return item;
  }

  listNotifications(): NotificationItem[] {
    return [...this.recentNotifications];
  }

  sendNotify(input: SendNotifyInput): Result<NotificationItem> {
    const text = input.text.trim();
    if (!text) return fail("INVALID", "texto da notificação obrigatório");
    const node = input.nodeId ? this.store.getNode(input.nodeId) : undefined;
    const wsId = input.workspaceId ?? node?.workspaceId ?? this.store.listWorkspaces()[0]?.workspaceId;
    if (!wsId) return fail("NOT_FOUND", "nenhum espaço encontrado para a notificação");
    const ws = this.store.getWorkspace(wsId);
    const defaultTitle = node ? `${node.title}${ws ? ` (${ws.name})` : ""}` : ws ? ws.name : "MessAI";
    const title = input.title?.trim() || defaultTitle;
    const item = this.emitNotification({
      kind: "notify",
      title,
      body: text,
      workspaceId: wsId,
      ...(ws ? { workspaceName: ws.name } : {}),
      ...(node ? { nodeId: node.nodeId, nodeTitle: node.title } : input.nodeId ? { nodeId: input.nodeId } : {}),
    });
    return succeed(item);
  }

  // ---- #27 Rotinas: comandos e prompts agendados e recorrentes ----
  private readAllRoutines(): Routine[] {
    const raw = this.store.getMeta("routines.all");
    if (!raw) return [];
    try {
      const arr = JSON.parse(raw) as unknown;
      return Array.isArray(arr) ? (arr as Routine[]) : [];
    } catch { return []; }
  }

  private saveAllRoutines(list: Routine[]): void {
    this.store.setMeta("routines.all", JSON.stringify(list));
  }

  listRoutines(workspaceId?: string): Routine[] {
    const all = this.readAllRoutines();
    return workspaceId ? all.filter((r) => r.workspaceId === workspaceId) : all;
  }

  createRoutine(workspaceId: string, input: CreateRoutineInput): Result<Routine> {
    const w = this.store.getWorkspace(workspaceId);
    if (!w) return fail("NOT_FOUND", "espaço não encontrado");
    const name = input.name.trim();
    const payload = input.payload.trim();
    if (!name || !payload) return fail("INVALID", "nome e comando/prompt obrigatórios");
    if (input.targetNodeId) {
      const n = this.store.getNode(input.targetNodeId);
      if (!n || n.workspaceId !== workspaceId || n.kind !== "terminal") return fail("NOT_FOUND", "terminal de destino não encontrado neste espaço");
    }
    const r: Routine = {
      routineId: newId(),
      workspaceId,
      name,
      actionType: input.actionType,
      ...(input.targetNodeId ? { targetNodeId: input.targetNodeId } : {}),
      payload,
      scheduleType: input.scheduleType ?? "interval",
      intervalSeconds: Math.max(1, Math.round(input.intervalSeconds ?? 300)),
      enabled: input.enabled ?? true,
      wakeIfUnloaded: input.wakeIfUnloaded ?? true,
      runCount: 0,
      createdAt: nowIso(),
    };
    const all = this.readAllRoutines();
    all.push(r);
    this.saveAllRoutines(all);
    return succeed(r);
  }

  patchRoutine(routineId: string, input: PatchRoutineInput): Result<Routine> {
    const all = this.readAllRoutines();
    const idx = all.findIndex((x) => x.routineId === routineId);
    if (idx < 0) return fail("NOT_FOUND", "rotina não encontrada");
    const cur = all[idx]!;
    const next: Routine = {
      ...cur,
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.actionType !== undefined ? { actionType: input.actionType } : {}),
      ...(input.payload !== undefined ? { payload: input.payload.trim() } : {}),
      ...(input.scheduleType !== undefined ? { scheduleType: input.scheduleType } : {}),
      ...(input.intervalSeconds !== undefined ? { intervalSeconds: Math.max(1, Math.round(input.intervalSeconds)) } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.wakeIfUnloaded !== undefined ? { wakeIfUnloaded: input.wakeIfUnloaded } : {}),
    };
    if (input.targetNodeId === null) delete next.targetNodeId;
    else if (input.targetNodeId !== undefined) next.targetNodeId = input.targetNodeId;
    all[idx] = next;
    this.saveAllRoutines(all);
    return succeed(next);
  }

  deleteRoutine(routineId: string): Result<void> {
    const all = this.readAllRoutines();
    const idx = all.findIndex((x) => x.routineId === routineId);
    if (idx < 0) return fail("NOT_FOUND", "rotina não encontrada");
    all.splice(idx, 1);
    this.saveAllRoutines(all);
    return succeed(undefined);
  }

  async runRoutine(routineId: string): Promise<Result<RoutineRunResult>> {
    const all = this.readAllRoutines();
    const r = all.find((x) => x.routineId === routineId);
    if (!r) return fail("NOT_FOUND", "rotina não encontrada");
    const w = this.store.getWorkspace(r.workspaceId);
    if (!w) return fail("NOT_FOUND", "espaço da rotina não encontrado");

    let status: "ok" | "error" = "ok";
    let output = "";

    if (r.actionType === "prompt") {
      const nodes = this.store.listNodes(r.workspaceId).filter((n) => n.kind === "terminal");
      const target = (r.targetNodeId ? nodes.find((n) => n.nodeId === r.targetNodeId) : nodes[0]) ?? null;
      if (!target || !target.sessionId) {
        status = "error";
        output = "nenhum terminal de destino encontrado";
      } else {
        let sess = this.store.getSession(target.sessionId);
        if (sess && sess.state !== "running" && r.wakeIfUnloaded) {
          const rel = this.reloadNode(target.nodeId);
          if (rel.ok) {
            sess = rel.value;
            await new Promise((res) => setTimeout(res, 150));
          }
        }
        const del = this.sessions.deliver(target.sessionId, `${r.payload}\r`);
        if (del.ok) {
          status = "ok";
          output = `prompt entregue a "${target.title}"`;
        } else {
          status = "error";
          output = del.error.message;
        }
      }
    } else {
      const env = { ...process.env, ...this.effectiveEnvForWorkspace(w) } as NodeJS.ProcessEnv;
      try {
        const { stdout } = await execFileP("/bin/sh", ["-c", r.payload], { cwd: w.cwd, env, timeout: 15_000, maxBuffer: 2 * 1024 * 1024, encoding: "utf8" });
        status = "ok";
        output = String(stdout ?? "").trim().slice(0, 500);
      } catch (e) {
        const err = e as { stdout?: string; stderr?: string; message?: string };
        status = "error";
        output = String(err.stderr || err.stdout || err.message || "erro ao executar comando").trim().slice(0, 500);
      }
    }

    const latest = this.readAllRoutines();
    const idx = latest.findIndex((x) => x.routineId === routineId);
    const updated: Routine = {
      ...(idx >= 0 ? latest[idx]! : r),
      lastRunAt: nowIso(),
      lastStatus: status,
      lastOutput: output,
      runCount: ((idx >= 0 ? latest[idx]!.runCount : r.runCount) ?? 0) + 1,
      ...(r.scheduleType === "once" ? { enabled: false } : {}),
    };
    if (idx >= 0) {
      latest[idx] = updated;
      this.saveAllRoutines(latest);
    }
    return succeed({ routine: updated, status, output });
  }

  private async tickRoutines(): Promise<void> {
    const now = Date.now();
    for (const r of this.readAllRoutines()) {
      if (!r.enabled || this.runningRoutines.has(r.routineId)) continue;
      const baseMs = Date.parse(r.lastRunAt ?? r.createdAt);
      if (!Number.isFinite(baseMs)) continue;
      if (now - baseMs >= r.intervalSeconds * 1000) {
        this.runningRoutines.add(r.routineId);
        try { await this.runRoutine(r.routineId); } finally { this.runningRoutines.delete(r.routineId); }
      }
    }
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
    return { workspace, nodes: this.store.listNodes(workspaceId).map((n) => this.redactSecret(this.syncNoteFromDisk(n))), connections: this.store.listConnections(workspaceId), drawings: this.store.listDrawings(workspaceId), groups: this.store.listGroups(workspaceId), bands: this.listBands(workspaceId) };
  }
  /** Nota secreta: o VALOR nunca sai no snapshot (nem pro app nem pros agentes) — só os flags. O humano revela por /v1/nodes/:id/reveal. */
  private redactSecret(n: Node): Node { return n.secret ? { ...n, content: "" } : n; }

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
    if (input.status !== undefined && input.status !== w.status) {
      this.emitNotification({
        kind: "floor",
        title: `Andar "${out.name}" → ${out.status}`,
        body: out.statusText ? `${out.status}: ${out.statusText}` : `Status do andar alterado para ${out.status}`,
        workspaceId: out.workspaceId,
        workspaceName: out.name,
      });
    }
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
  // ---- #93 aprovação humana: o agente PEDE uma capacidade; só o usuário (app) concede ----
  requestApproval(nodeId: string, input: CreateApproval): Result<Approval> {
    const node = this.store.getNode(nodeId);
    if (!node || node.kind !== "terminal") return fail("NOT_FOUND", "terminal não encontrado");
    const cap = input.capability;
    if (this.agentCapsFor(node).includes(cap)) return fail("CONFLICT", `este terminal já possui a capacidade "${cap}"`);
    if (node.isolation && !(ISOLATED_APPROVABLE_CAPS as readonly string[]).includes(cap)) {
      return fail("FORBIDDEN", `"${cap}" não pode ser concedida a um terminal isolado (permitiria executar código fora do sandbox). Peça ao usuário para desligar o isolamento desse terminal.`);
    }
    const pending = this.store.pendingApprovalFor(nodeId, cap); if (pending) return succeed(pending);
    const id = newId();
    this.store.insertApproval({ approvalId: id, nodeId, workspaceId: node.workspaceId, capability: cap, reason: (input.reason ?? "").trim(), createdAt: nowIso() });
    const a = this.store.getApproval(id)!;
    this.emit("approval", a);
    return succeed(a);
  }
  listApprovals(status?: string): Approval[] { return this.store.listApprovals(status); }
  getApproval(id: string): Result<Approval> { const a = this.store.getApproval(id); return a ? succeed(a) : fail("NOT_FOUND", "pedido não encontrado"); }
  /** Aprovar concede a capacidade ao terminal (vale também para a credencial JÁ em uso, sem reiniciar); negar só registra. */
  decideApproval(id: string, approve: boolean): Result<Approval> {
    const a = this.store.getApproval(id);
    if (!a) return fail("NOT_FOUND", "pedido não encontrado");
    if (a.status !== "pending") return fail("CONFLICT", `pedido já ${a.status === "approved" ? "aprovado" : "negado"}`);
    if (approve) {
      const node = this.store.getNode(a.nodeId);
      if (!node) return fail("NOT_FOUND", "terminal não existe mais");
      const caps = [...new Set([...this.agentCapsFor(node), a.capability])];
      this.writeNodeCaps(a.nodeId, caps);
      for (const v of this.agentTokens.values()) if (v.nodeId === a.nodeId) v.capabilities = caps;
      this.saveAgentTokens();
    }
    this.store.decideApproval(id, approve ? "approved" : "denied", nowIso());
    const out = this.store.getApproval(id)!;
    this.emit("approval", out);
    return succeed(out);
  }

  /** Reinicia só o processo do terminal (mesma sessão/nó), relendo o plano — usado quando algo que muda o ambiente muda. */
  private respawnTerminal(nodeId: string): void {
    const node = this.store.getNode(nodeId); if (!node) return;
    const s = node.sessionId ? this.store.getSession(node.sessionId) : undefined;
    if (!s || s.state !== "running") return;
    const w = this.store.getWorkspace(node.workspaceId)!;
    this.sessions.dispose(s.sessionId);
    this.store.updateSession(s.sessionId, { state: "starting", exitCode: null, pid: null });
    this.sessions.start({ ...s, state: "starting" }, this.plan(w, node, s));
  }
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
    for (const ap of this.store.listApprovals("pending")) { const n = this.store.getNode(ap.nodeId); if (n) out.push({ kind: "approval", nodeId: n.nodeId, workspaceId: n.workspaceId, workspaceName: wsName(n.workspaceId), title: n.title, at: ap.createdAt }); } // #93
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
  /** Lê role.json em `<dir>/.messai/roles/<slug>/` e cria/atualiza papéis pelo nome. */
  discoverRoles(dir: string): Result<{ imported: Role[] }> {
    const imported: Role[] = [];
    for (const base of [".messai"]) {
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
    } else {
      // PC novo sem stats-cache.json: ainda mostra plano + limites do plano (vêm da API via credencial OAuth), que é o mais útil
      const lim = await fetchClaudeLimits();
      if (lim && (lim.plan || lim.limits.length)) agents.push({ id: "claude", label: "Claude Code", available: true, ...(lim.plan ? { plan: lim.plan } : {}), limits: lim.limits, ...(lim.limits.length ? {} : { note: "Logado; limites do plano indisponíveis agora." }), metrics: [], models: [] });
      else agents.push({ id: "claude", label: "Claude Code", available: false, note: "Sem uso local (~/.claude/stats-cache.json) nem login do Claude detectado.", metrics: [], models: [] });
    }
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
      if (!isWithinCanonicalRoot(d.value.realRoot, realpathSync(d.value.abs))) return fail("FORBIDDEN", "destino fora do espaço");
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

  // ---- árvore de arquivos (confinada ao diretório do espaço, #86 [MESS-01]) ----
  private wsRoot(workspaceId: string): Result<string> {
    const w = this.store.getWorkspace(workspaceId);
    return w ? succeed(w.cwd) : fail("NOT_FOUND", "espaço não encontrado");
  }
  private resolveIn(
    root: string,
    rel: string,
    opts?: { rejectSymlinkLeaf?: boolean },
  ): Result<{ abs: string; rel: string; realRoot: string }> {
    const r = safeRelPath(rel);
    if (!r.ok) return r;
    let realRoot: string;
    try {
      realRoot = realpathSync(root);
    } catch {
      return fail("NOT_FOUND", "diretório do espaço não encontrado");
    }
    const parts = r.value ? r.value.split("/") : [];
    let cur = realRoot;
    for (let i = 0; i < parts.length; i++) {
      cur = join(cur, parts[i]!);
      const isLeaf = i === parts.length - 1;
      let lst: import("node:fs").Stats | null = null;
      try {
        lst = lstatSync(cur);
      } catch {
        lst = null;
      }
      if (!lst) continue;
      if (lst.isSymbolicLink()) {
        if (isLeaf && opts?.rejectSymlinkLeaf) {
          return fail("FORBIDDEN", "operação não permitida sobre symlink");
        }
        let targetReal: string;
        try {
          targetReal = realpathSync(cur);
        } catch {
          // Symlink quebrado: verifica para onde o link aponta
          try {
            const linkDest = resolve(dirname(cur), readlinkSync(cur));
            if (!isWithinCanonicalRoot(realRoot, linkDest)) {
              return fail("FORBIDDEN", "symlink aponta para fora do espaço");
            }
          } catch {
            return fail("FORBIDDEN", "symlink inválido");
          }
          continue;
        }
        if (!isWithinCanonicalRoot(realRoot, targetReal)) {
          return fail("FORBIDDEN", "caminho atravessa symlink para fora do espaço");
        }
        cur = targetReal;
      } else {
        let realCur: string;
        try {
          realCur = realpathSync(cur);
        } catch {
          continue;
        }
        if (!isWithinCanonicalRoot(realRoot, realCur)) {
          return fail("FORBIDDEN", "caminho fora da raiz canônica do espaço");
        }
        cur = realCur;
      }
    }
    return succeed({ abs: r.value ? join(realRoot, r.value) : realRoot, rel: r.value, realRoot });
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
      const entryAbs = join(p.value.abs, e.name);
      if (e.isSymbolicLink()) {
        try {
          const realEntry = realpathSync(entryAbs);
          if (!isWithinCanonicalRoot(p.value.realRoot, realEntry)) continue;
        } catch { continue; }
      }
      let st: import("node:fs").Stats; try { st = statSync(entryAbs); } catch { continue; }
      const g = git.get(relPath);
      out.push({ name: e.name, path: relPath, dir: st.isDirectory(), size: st.isDirectory() ? 0 : st.size, mtime: st.mtime.toISOString(), ...(g ? { git: g } : {}) });
    }
    out.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
    return succeed(out);
  }
  readFile(workspaceId: string, rel: string): Result<FileContent> {
    const root = this.wsRoot(workspaceId); if (!root.ok) return root;
    const p = this.resolveIn(root.value, rel); if (!p.ok) return p;
    let realTarget: string;
    try { realTarget = realpathSync(p.value.abs); } catch { return fail("NOT_FOUND", "arquivo não encontrado"); }
    if (!isWithinCanonicalRoot(p.value.realRoot, realTarget)) return fail("FORBIDDEN", "arquivo fora da raiz canônica do espaço");
    let st: import("node:fs").Stats; try { st = statSync(realTarget); } catch { return fail("NOT_FOUND", "arquivo não encontrado"); }
    if (st.isDirectory()) return fail("INVALID", "é um diretório");
    const LIMIT = 512 * 1024;
    const fd = openSync(realTarget, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const buf = Buffer.alloc(Math.min(st.size, LIMIT));
    const n = readSync(fd, buf, 0, buf.length, 0);
    closeSync(fd);
    const head = buf.subarray(0, n);
    if (looksBinary(head)) return succeed({ path: p.value.rel, size: st.size, binary: true, truncated: false, mtimeMs: st.mtimeMs });
    return succeed({ path: p.value.rel, size: st.size, binary: false, text: head.toString("utf8"), truncated: st.size > LIMIT, mtimeMs: st.mtimeMs });
  }
  fsOp(workspaceId: string, input: FsOp): Result<{ path: string; mtimeMs?: number }> {
    const root = this.wsRoot(workspaceId); if (!root.ok) return root;
    const rejectSymlinkLeaf = input.op !== "delete";
    const p = this.resolveIn(root.value, input.path, { rejectSymlinkLeaf }); if (!p.ok) return p;
    if (!p.value.rel && input.op !== "mkdir") return fail("INVALID", "operação na raiz não permitida");
    const ensureSafeParent = (targetAbs: string): Result<string> => {
      const parentDir = dirname(targetAbs);
      mkdirSync(parentDir, { recursive: true });
      let realParent: string;
      try { realParent = realpathSync(parentDir); } catch { return fail("NOT_FOUND", "diretório pai não encontrado"); }
      if (!isWithinCanonicalRoot(p.value.realRoot, realParent)) return fail("FORBIDDEN", "diretório pai fora da raiz canônica do espaço");
      return succeed(join(realParent, basename(targetAbs)));
    };
    try {
      if (input.op === "mkdir") {
        mkdirSync(p.value.abs, { recursive: true });
        const realCreated = realpathSync(p.value.abs);
        if (!isWithinCanonicalRoot(p.value.realRoot, realCreated)) return fail("FORBIDDEN", "diretório criado fora do espaço");
      } else if (input.op === "touch") {
        if (existsSync(p.value.abs)) return fail("CONFLICT", "já existe");
        const safeTarget = ensureSafeParent(p.value.abs);
        if (!safeTarget.ok) return safeTarget;
        const fd = openSync(safeTarget.value, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW, 0o644);
        closeSync(fd);
      } else if (input.op === "write") {
        const safeTarget = ensureSafeParent(p.value.abs);
        if (!safeTarget.ok) return safeTarget;
        // editor (#30): se o arquivo mudou no disco desde a leitura (outro agente/ferramenta), recusa em vez de sobrescrever em silêncio
        if (input.expectedMtimeMs !== undefined && existsSync(safeTarget.value) && Math.abs(statSync(safeTarget.value).mtimeMs - input.expectedMtimeMs) > 1) return fail("CONFLICT", "o arquivo mudou no disco desde que foi aberto");
        const fd = openSync(safeTarget.value, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC | fsConstants.O_NOFOLLOW, 0o644);
        try {
          const data = Buffer.from(input.text ?? "", "utf8");
          writeFileSync(fd, data);
        } finally {
          closeSync(fd);
        }
        return succeed({ path: p.value.rel, mtimeMs: statSync(safeTarget.value).mtimeMs });
      } else if (input.op === "rename") {
        if (!input.to) return fail("INVALID", "destino obrigatório");
        const t = this.resolveIn(root.value, input.to, { rejectSymlinkLeaf: true });
        if (!t.ok) return t;
        if (existsSync(t.value.abs)) return fail("CONFLICT", "destino já existe");
        const safeSrc = ensureSafeParent(p.value.abs);
        if (!safeSrc.ok) return safeSrc;
        const safeDst = ensureSafeParent(t.value.abs);
        if (!safeDst.ok) return safeDst;
        renameSync(safeSrc.value, safeDst.value);
        return succeed({ path: t.value.rel });
      } else if (input.op === "delete") {
        const parentDir = dirname(p.value.abs);
        if (existsSync(parentDir)) {
          const realParent = realpathSync(parentDir);
          if (!isWithinCanonicalRoot(p.value.realRoot, realParent)) return fail("FORBIDDEN", "diretório pai fora do espaço");
        }
        let lst: import("node:fs").Stats | null = null;
        try { lst = lstatSync(p.value.abs); } catch { lst = null; }
        if (lst?.isSymbolicLink()) {
          unlinkSync(p.value.abs);
        } else {
          rmSync(p.value.abs, { recursive: true, force: true });
        }
      }
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "ELOOP") return fail("FORBIDDEN", "operação bloqueada em symlink (ELOOP)");
      return fail("INTERNAL", String((e as Error).message ?? e));
    }
    return succeed({ path: p.value.rel });
  }
  // ---- #26 portais ----
  private portalNode(nodeId: string): Result<Node> { const n = this.store.getNode(nodeId); if (!n || n.kind !== "portal") return fail("NOT_FOUND", "portal não encontrado"); return succeed(n); }
  portalState(nodeId: string): Result<PortalState> { const n = this.portalNode(nodeId); if (!n.ok) return n; return succeed(this.portals.state(nodeId, parsePortal(n.value.content).url)); }
  /** Garante a sessão do portal (abre o navegador na URL salva). Erros de ambiente (sem navegador, limite) viram UNSUPPORTED. */
  private async portalSession(nodeId: string): Promise<Result<import("./portal.js").PortalSession>> {
    const n = this.portalNode(nodeId); if (!n.ok) return n;
    try { return succeed(await this.portals.ensure(nodeId, parsePortal(n.value.content).url)); } catch (e) { return fail("UNSUPPORTED", (e as Error).message); }
  }
  portalWatch(nodeId: string, key: string): Result<PortalState> {
    const n = this.portalNode(nodeId); if (!n.ok) return n;
    this.portals.watch(nodeId, key); // não lança o navegador; só assiste se já estiver rodando
    return succeed(this.portals.state(nodeId, parsePortal(n.value.content).url));
  }
  portalUnwatch(nodeId: string, key: string): void { this.portals.unwatch(nodeId, key); }
  async portalAct(nodeId: string, act: PortalAct): Promise<Result<PortalActResult>> {
    if (act.action === "close") { const n = this.portalNode(nodeId); if (!n.ok) return n; await this.portals.close(nodeId); return succeed({ ok: true, state: this.portals.state(nodeId, parsePortal(n.value.content).url) }); }
    if (act.action === "navigate") { const u = normalizePortalUrl(act.url); if (!u.ok) return fail("INVALID", u.reason); } // URL inválida é recusada ANTES de abrir o navegador (e de navegar para a URL salva)
    const s = await this.portalSession(nodeId); if (!s.ok) return s;
    const p = s.value; let value: unknown; let message: string | undefined; let ok = true;
    try {
      switch (act.action) {
        case "navigate": await p.navigate(act.url); break;
        case "back": await p.history(-1); break;
        case "forward": await p.history(1); break;
        case "reload": await p.reload(); break;
        case "click": await p.click(act); break;
        case "mouse": await p.mouse(act.type, act.x, act.y, act.button ?? "left", act.clickCount ?? 1); break;
        case "type": await p.type(act); break;
        case "key": await p.key(act.key); break;
        case "scroll": await p.scroll(act.dx ?? 0, act.dy, act.x, act.y); break;
        case "eval": value = await p.evaluate(act.expression); break;
        case "waitForText": ok = await p.waitForText(act.text, act.timeoutMs); if (!ok) message = `texto não apareceu: ${act.text}`; break;
        case "inspect": value = await p.inspect(act.x, act.y); break;
        case "viewport": await p.setViewport(act.width, act.height); break;
      }
    } catch (e) { return fail("INVALID", (e as Error).message); }
    return succeed({ ok, state: this.portals.state(nodeId), ...(value !== undefined ? { value } : {}), ...(message ? { message } : {}) });
  }
  async portalSnapshot(nodeId: string): Promise<Result<PortalSnapshot>> { const s = await this.portalSession(nodeId); if (!s.ok) return s; try { return succeed(await s.value.snapshot()); } catch (e) { return fail("INVALID", (e as Error).message); } }
  async portalScreenshot(nodeId: string): Promise<Result<PortalScreenshot>> { const s = await this.portalSession(nodeId); if (!s.ok) return s; try { const r = await s.value.screenshot(); return succeed({ mime: "image/png", ...r }); } catch (e) { return fail("INVALID", (e as Error).message); } }
  shutdownPortals(): void { this.portals.killAllSync(); }

  // ---- #73 dispositivos Android ----
  private deviceNode(nodeId: string): Result<Node> { const n = this.store.getNode(nodeId); if (!n || n.kind !== "device") return fail("NOT_FOUND", "dispositivo não encontrado"); return succeed(n); }
  async deviceList(): Promise<Result<DeviceList>> { return succeed(await listDevices()); }
  deviceState(nodeId: string): Result<DeviceState> { const n = this.deviceNode(nodeId); if (!n.ok) return n; return succeed(this.devices.state(nodeId, parseDeviceContent(n.value.content))); }
  /** Garante o dispositivo ligado; depois de reiniciar o runtime reconecta pelo serial salvo (por AVD, só iniciando de novo). */
  private async deviceConn(nodeId: string): Promise<Result<import("./device.js").AdbDevice>> {
    const n = this.deviceNode(nodeId); if (!n.ok) return n;
    let d = this.devices.peek(nodeId);
    if (!d) {
      const saved = parseDeviceContent(n.value.content);
      if (!saved.serial) return fail("INVALID", saved.avd ? `emulador ${saved.avd} parado — inicie-o (mess device <nó> boot ${saved.avd})` : "nenhum dispositivo ligado a este nó (mess device list; mess device <nó> select <serial>)");
      try { await this.devices.select(nodeId, saved.serial, saved.avd); } catch (e) { return fail("INVALID", (e as Error).message); }
      d = this.devices.peek(nodeId);
    }
    return d ? succeed(d) : fail("INVALID", "dispositivo indisponível");
  }
  async deviceWatch(nodeId: string, key: string): Promise<Result<DeviceState>> {
    const n = this.deviceNode(nodeId); if (!n.ok) return n;
    this.devices.watch(nodeId, key);
    if (!this.devices.peek(nodeId)) { const saved = parseDeviceContent(n.value.content); if (saved.serial) void this.devices.select(nodeId, saved.serial, saved.avd).catch(() => {}); } // reconecta ao aparelho salvo ao assistir
    return succeed(this.devices.state(nodeId, parseDeviceContent(n.value.content)));
  }
  deviceUnwatch(nodeId: string, key: string): void { this.devices.unwatch(nodeId, key); }
  async deviceAct(nodeId: string, act: DeviceAct): Promise<Result<DeviceActResult>> {
    const n = this.deviceNode(nodeId); if (!n.ok) return n;
    const st = () => this.devices.state(nodeId, parseDeviceContent(this.store.getNode(nodeId)?.content));
    try {
      switch (act.action) {
        case "select": await this.devices.select(nodeId, act.serial); return succeed({ ok: true, state: st() });
        case "boot": {
          if (act.wait === false) { void this.devices.boot(nodeId, act.avd, !!act.persist).catch(() => {}); await new Promise((r) => setTimeout(r, 30)); return succeed({ ok: true, state: st(), message: "iniciando" }); }
          await this.devices.boot(nodeId, act.avd, !!act.persist); return succeed({ ok: true, state: st() });
        }
        case "shutdown": await this.devices.shutdown(nodeId); return succeed({ ok: true, state: st() });
        case "disconnect": this.devices.disconnect(nodeId); return succeed({ ok: true, state: st() });
        case "scrcpy": await this.devices.scrcpy(nodeId); return succeed({ ok: true, state: st() });
      }
      const c = await this.deviceConn(nodeId); if (!c.ok) return c; const d = c.value;
      switch (act.action) {
        case "tap": await d.tap(act.x, act.y); break;
        case "longpress": await d.longpress(act.x, act.y, act.ms); break;
        case "swipe": await d.swipe(act.x1, act.y1, act.x2, act.y2, act.ms); break;
        case "key": await d.key(act.key); break;
        case "text": await d.typeText(act.text); break;
        case "launch": await d.launch(act.package, act.activity); break;
        case "stop": await d.stopApp(act.package); break;
      }
      this.devices.refreshForeground(nodeId);
      return succeed({ ok: true, state: st() });
    } catch (e) { return fail("INVALID", (e as Error).message); }
  }
  async deviceUi(nodeId: string): Promise<Result<DeviceUiTree>> { const c = await this.deviceConn(nodeId); if (!c.ok) return c; try { return succeed(await c.value.uiTree()); } catch (e) { return fail("INVALID", (e as Error).message); } }
  async deviceScreenshot(nodeId: string): Promise<Result<DeviceScreenshot>> { const c = await this.deviceConn(nodeId); if (!c.ok) return c; try { const s = await c.value.screenshot(); return succeed({ mime: "image/png", data: s.png.toString("base64"), width: s.w, height: s.h }); } catch (e) { return fail("INVALID", (e as Error).message); } }
  async deviceApps(nodeId: string): Promise<Result<string[]>> { const c = await this.deviceConn(nodeId); if (!c.ok) return c; try { return succeed(await c.value.apps()); } catch (e) { return fail("INVALID", (e as Error).message); } }
  shutdownDevices(): void { this.devices.stopAllLoops(); }

  // ---- #30 git do espaço (raiz do espaço; andar = worktree) ----
  private gitRoot(workspaceId: string): Result<string> { const r = this.wsRoot(workspaceId); return r.ok ? succeed(r.value) : r; }
  private gitPath(root: string, p: string): Result<string> { const r = this.resolveIn(root, p); if (!r.ok) return r; if (!r.value.rel) return fail("INVALID", "caminho inválido"); return succeed(r.value.rel); }
  private afterGitWrite(root: string): void { this.gitStatusCache.delete(root); }
  async gitInfo(workspaceId: string): Promise<Result<GitInfo>> { const r = this.gitRoot(workspaceId); if (!r.ok) return r; return succeed(await gitops.gitInfo(r.value)); }
  async gitLog(workspaceId: string, limit: number, path?: string): Promise<Result<GitCommitEntry[]>> {
    const r = this.gitRoot(workspaceId); if (!r.ok) return r;
    let rel: string | undefined; if (path) { const p = this.gitPath(r.value, path); if (!p.ok) return p; rel = p.value; }
    return succeed(await gitops.gitLog(r.value, limit, rel));
  }
  async gitDiff(workspaceId: string, path?: string): Promise<Result<GitDiff>> {
    const r = this.gitRoot(workspaceId); if (!r.ok) return r;
    let rel: string | undefined; if (path) { const p = this.gitPath(r.value, path); if (!p.ok) return p; rel = p.value; }
    return succeed(await gitops.gitDiff(r.value, rel));
  }
  private async gitMutate(workspaceId: string, fn: (root: string) => Promise<GitOpResult>): Promise<Result<GitOpResult>> {
    const r = this.gitRoot(workspaceId); if (!r.ok) return r;
    if (!(await gitops.gitInfo(r.value)).isRepo) return fail("INVALID", "esta pasta não é um repositório git");
    const res = await fn(r.value); this.afterGitWrite(r.value); return succeed(res);
  }
  async gitCommit(workspaceId: string, input: GitCommitInput): Promise<Result<GitOpResult>> {
    const root = this.gitRoot(workspaceId); if (!root.ok) return root;
    const paths: string[] = [];
    for (const p of input.paths ?? []) { const v = this.gitPath(root.value, p); if (!v.ok) return v; paths.push(v.value); }
    return this.gitMutate(workspaceId, (rt) => gitops.gitCommit(rt, input.message, paths));
  }
  async gitBranch(workspaceId: string, input: GitBranchInput): Promise<Result<GitOpResult>> {
    if (!isSafeRef(input.name) || (input.from && !isSafeRef(input.from))) return fail("INVALID", "nome de branch inválido");
    return this.gitMutate(workspaceId, (rt) => gitops.gitCreateBranch(rt, input.name, input.from));
  }
  async gitCheckout(workspaceId: string, input: GitCheckoutInput): Promise<Result<GitOpResult>> {
    if (!isSafeRef(input.branch)) return fail("INVALID", "nome de branch inválido");
    return this.gitMutate(workspaceId, (rt) => gitops.gitCheckout(rt, input.branch));
  }
  async gitMerge(workspaceId: string, input: GitMergeInput): Promise<Result<GitOpResult>> {
    if (input.abort) return this.gitMutate(workspaceId, (rt) => gitops.gitMergeAbort(rt));
    if (!input.branch || !isSafeRef(input.branch)) return fail("INVALID", "nome de branch inválido");
    const b = input.branch; return this.gitMutate(workspaceId, (rt) => gitops.gitMerge(rt, b));
  }
  async gitPull(workspaceId: string): Promise<Result<GitOpResult>> { return this.gitMutate(workspaceId, (rt) => gitops.gitPull(rt)); }
  async gitPush(workspaceId: string, input: GitPushInput): Promise<Result<GitOpResult>> {
    return this.gitMutate(workspaceId, async (rt) => gitops.gitPush(rt, !!input.setUpstream, (await gitops.gitInfo(rt)).branch));
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
        for (const e of es) {
          visited++;
          if (e.isSymbolicLink()) continue;
          const r = rel ? `${rel}/${e.name}` : e.name;
          if (e.isDirectory() && SKIP.has(e.name)) continue;
          if (e.name.toLowerCase().includes(needle)) out.push({ path: r });
          if (e.isDirectory()) walk(join(dir, e.name), r, depth + 1);
          if (out.length >= 200) return;
        }
      };
      walk(root.value, "", 0);
      return succeed(out);
    }
    // grep async com timeout: um repositório grande não trava o event loop nem as outras rotas.
    const r = await runCmd("grep", ["-rnI", "--exclude-dir=.git", "--exclude-dir=node_modules", "--exclude-dir=dist", "--exclude-dir=build", "-m", "20", "--", q, "."], { cwd: root.value, timeoutMs: 8000 });
    const hits: SearchHit[] = [];
    for (const line of r.stdout.split("\n")) {
      const m = /^\.\/(.+?):(\d+):(.*)$/.exec(line);
      if (m) {
        const check = this.resolveIn(root.value, m[1]!);
        if (!check.ok) continue;
        try {
          if (!isWithinCanonicalRoot(check.value.realRoot, realpathSync(check.value.abs))) continue;
        } catch { continue; }
        hits.push({ path: m[1]!, line: Number(m[2]), text: m[3]!.slice(0, 200) });
      }
      if (hits.length >= 200) break;
    }
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
  // ---- #81 cópia isolada (CoW/independente), detecção de reflink, exclusão de pastas e cancelamento ----
  private activeFloorCopy = new Map<string, { cancelled: boolean; targetDir: string }>();
  private probeCow(dir: string): boolean {
    if (process.env["MESS_FORCE_COW"] === "1") return true;
    if (process.env["MESS_FORCE_COW"] === "0") return false;
    try {
      mkdirSync(dir, { recursive: true });
      const a = join(dir, `.cow-a-${process.pid}`); const b = join(dir, `.cow-b-${process.pid}`);
      writeFileSync(a, "cow");
      let ok = false;
      try { copyFileSync(a, b, fsConstants.COPYFILE_FICLONE_FORCE); ok = true; } catch { ok = false; }
      try { unlinkSync(a); } catch { /* */ }
      try { unlinkSync(b); } catch { /* */ }
      return ok;
    } catch { return false; }
  }
  getFloorCopyInfo(workspaceId: string): Result<FloorCopyInfo> {
    const w = this.store.getWorkspace(workspaceId);
    if (!w) return fail("NOT_FOUND", "espaço não encontrado");
    const ground = w.parentId ? (this.store.getWorkspace(w.parentId) ?? w) : w;
    const cowSupported = this.probeCow(join(this.cfg.dataDir, "floors", ground.workspaceId));
    const saved = this.store.getMeta(`excludes.${ground.workspaceId}`);
    let excludeDirs: string[] = [...DEFAULT_FLOOR_EXCLUDES];
    if (saved) { try { excludeDirs = normalizeFloorExcludes(JSON.parse(saved) as string[]); } catch { /* */ } }
    let presentDirs: string[] = [];
    try { presentDirs = readdirSync(ground.cwd, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name !== ".git").map((e) => e.name).sort(); } catch { /* */ }
    return succeed({ cowSupported, defaultExcludes: [...DEFAULT_FLOOR_EXCLUDES], excludeDirs, presentDirs });
  }
  putFloorExcludes(workspaceId: string, input: PutFloorExcludes): Result<FloorCopyInfo> {
    const w = this.store.getWorkspace(workspaceId);
    if (!w) return fail("NOT_FOUND", "espaço não encontrado");
    const groundId = w.parentId ?? w.workspaceId;
    const clean = normalizeFloorExcludes(input.excludeDirs);
    this.store.setMeta(`excludes.${groundId}`, JSON.stringify(clean));
    return this.getFloorCopyInfo(groundId);
  }
  cancelFloorCopy(groundId: string): Result<{ cancelled: boolean }> {
    if (!this.store.getWorkspace(groundId)) return fail("NOT_FOUND", "espaço não encontrado");
    const cur = this.activeFloorCopy.get(groundId);
    if (!cur) return succeed({ cancelled: false });
    cur.cancelled = true;
    return succeed({ cancelled: true });
  }
  /** Cria um andar: workspace-filho com branch própria; worktree git (padrão), cópia isolada (CoW/independente) ou sem isolamento. */
  async createFloor(groundId: string, input: CreateFloor): Promise<Result<Workspace>> {
    const ground = this.store.getWorkspace(groundId);
    if (!ground) return fail("NOT_FOUND", "espaço não encontrado");
    if (ground.parentId) return fail("INVALID", "andares nascem do térreo, não de outro andar");
    const type = input.floorType ?? "worktree";
    const slug = slugify(input.name);
    const branch = input.branch?.trim() || slug;
    let cwd = ground.cwd;
    let copyMode: "cow" | "independent" | undefined;
    let excludeDirs: string[] | undefined;
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
    } else if (type === "copy") {
      cwd = input.path ?? join(this.cfg.dataDir, "floors", groundId, slug);
      if (existsSync(cwd)) return fail("CONFLICT", `já existe um diretório em ${cwd}`);
      const info = this.getFloorCopyInfo(groundId);
      if (!info.ok) return info;
      const wantMode = input.copyMode ?? "auto";
      if (wantMode === "cow" && !info.value.cowSupported) return fail("UNSUPPORTED", "o sistema de arquivos não suporta clone copy-on-write (reflink)");
      copyMode = wantMode === "cow" || (wantMode === "auto" && info.value.cowSupported) ? "cow" : "independent";
      excludeDirs = normalizeFloorExcludes(input.excludeDirs ?? info.value.excludeDirs);
      const excludeSet = new Set(excludeDirs);
      const copyState = { cancelled: false, targetDir: cwd };
      this.activeFloorCopy.set(groundId, copyState);
      const useFiclone = copyMode === "cow" && process.env["MESS_FORCE_COW"] !== "1";
      const copyTree = async (srcDir: string, dstDir: string, relBase: string): Promise<void> => {
        if (copyState.cancelled) throw new Error("__CANCELLED__");
        mkdirSync(dstDir, { recursive: true });
        for (const e of readdirSync(srcDir, { withFileTypes: true })) {
          if (copyState.cancelled) throw new Error("__CANCELLED__");
          const rel = relBase ? `${relBase}/${e.name}` : e.name;
          const srcPath = join(srcDir, e.name);
          const dstPath = join(dstDir, e.name);
          if (e.isDirectory()) {
            if (shouldExcludeFloorDir(rel, e.name, excludeSet)) continue;
            await copyTree(srcPath, dstPath, rel);
          } else if (e.isSymbolicLink()) {
            try { symlinkSync(readlinkSync(srcPath), dstPath); } catch { /* */ }
          } else if (e.isFile()) {
            if (input.copyDelayMs && input.copyDelayMs > 0) {
              await new Promise((r) => setTimeout(r, input.copyDelayMs));
              if (copyState.cancelled) throw new Error("__CANCELLED__");
            }
            copyFileSync(srcPath, dstPath, useFiclone ? fsConstants.COPYFILE_FICLONE : 0);
            try { chmodSync(dstPath, lstatSync(srcPath).mode); } catch { /* */ }
          }
        }
      };
      try {
        await copyTree(ground.cwd, cwd, "");
        if (copyState.cancelled) throw new Error("__CANCELLED__");
      } catch (e) {
        try { rmSync(cwd, { recursive: true, force: true }); } catch { /* */ }
        this.activeFloorCopy.delete(groundId);
        if ((e as Error).message === "__CANCELLED__") return fail("CONFLICT", "criação do andar cancelada");
        return fail("INTERNAL", `cópia falhou: ${String((e as Error).message ?? e)}`);
      }
      this.activeFloorCopy.delete(groundId);
      if (this.isGitRepo(cwd)) {
        const exists = this.git(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]).ok;
        const newBranch = input.newBranch ?? !exists;
        if (newBranch) this.git(cwd, ["checkout", "-B", branch, ...(input.base ? [input.base] : [])]);
        else this.git(cwd, ["checkout", branch]);
      }
    }
    const w: Workspace = {
      workspaceId: newId(), machineId: this.cfg.machineId, name: input.name, cwd, icon: "layers", color: ground.color,
      sortOrder: this.store.nextWorkspaceOrder(), revision: 0, createdAt: nowIso(), parentId: groundId, branch, floorType: type, status: "working",
      ...(copyMode ? { copyMode } : {}),
      ...(excludeDirs ? { excludeDirs } : {}),
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
      for (const rel of [".messai/hooks.json"]) {
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
      ...this.effectiveEnvForWorkspace(w),
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
      [AGENT_ENV.token]: this.issueHookToken(w, section), // #87 nunca o token mestre
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
        this.revokeHookToken(`${w.workspaceId}:${section}`); // #87
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
    this.revokeHookToken(`${workspaceId}:${section}`); // #87
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

  // ---- #31 Pull request nos andares (+ hosts Git configuráveis) ----
  getGitHosts(): GitHostEntry[] {
    const raw = this.store.getMeta("git.hosts");
    if (!raw) return [];
    try { return JSON.parse(raw) as GitHostEntry[]; } catch { return []; }
  }
  putGitHosts(input: PutGitHostsInput): Result<GitHostEntry[]> {
    const clean: GitHostEntry[] = [];
    for (const h of input.hosts) {
      const host = h.host.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
      if (!host || clean.some((x) => x.host === host)) continue;
      clean.push({ host, kind: h.kind, ...(h.prUrlTemplate?.trim() ? { prUrlTemplate: h.prUrlTemplate.trim() } : {}) });
    }
    this.store.setMeta("git.hosts", JSON.stringify(clean));
    return succeed(clean);
  }
  private prMetaKey(workspaceId: string): string { return `pr.${workspaceId}`; }
  private readPrMeta(workspaceId: string): Partial<FloorPrState> {
    const raw = this.store.getMeta(this.prMetaKey(workspaceId));
    if (!raw) return {};
    try { return JSON.parse(raw) as Partial<FloorPrState>; } catch { return {}; }
  }
  getFloorPr(workspaceId: string): Result<FloorPrState> {
    const w = this.store.getWorkspace(workspaceId);
    if (!w) return fail("NOT_FOUND", "espaço não encontrado");
    const ground = w.parentId ? (this.store.getWorkspace(w.parentId) ?? w) : w;
    const saved = this.readPrMeta(workspaceId);
    const branch = w.branch || (this.isGitRepo(w.cwd) ? this.git(w.cwd, ["rev-parse", "--abbrev-ref", "HEAD"]).out : "") || "main";
    const groundBranch = (this.isGitRepo(ground.cwd) ? this.git(ground.cwd, ["rev-parse", "--abbrev-ref", "HEAD"]).out : "") || "main";
    const baseBranch = saved.baseBranch || groundBranch || "main";
    const remoteRes = this.git(w.cwd, ["remote", "get-url", "origin"]);
    const groundRemoteRes = this.git(ground.cwd, ["remote", "get-url", "origin"]);
    const remoteUrl = (remoteRes.ok && remoteRes.out) ? remoteRes.out : (groundRemoteRes.ok && groundRemoteRes.out) ? groundRemoteRes.out : "";
    const parsed = parseGitRemote(remoteUrl, this.getGitHosts()) ?? {
      host: "github.com",
      repoSlug: `local/${slugify(ground.name)}`,
      kind: "github" as const,
    };
    let ahead = 0; let behind = 0;
    if (this.isGitRepo(w.cwd)) {
      const cnt = this.git(w.cwd, ["rev-list", "--left-right", "--count", `${baseBranch}...${branch}`]);
      if (cnt.ok) {
        const parts = cnt.out.split(/\s+/);
        behind = Number(parts[0] ?? 0) || 0;
        ahead = Number(parts[1] ?? 0) || 0;
      }
    }
    const compareUrl = buildPrCompareUrl({
      host: parsed.host,
      repoSlug: parsed.repoSlug,
      kind: parsed.kind,
      baseBranch,
      headBranch: branch,
      title: saved.title ?? w.name,
      body: saved.body,
      customTemplate: parsed.prUrlTemplate,
    });
    return succeed({
      workspaceId,
      branch,
      baseBranch,
      remoteUrl,
      host: parsed.host,
      hostKind: parsed.kind,
      repoSlug: parsed.repoSlug,
      compareUrl,
      state: saved.state ?? "none",
      ...(saved.number !== undefined ? { number: saved.number } : {}),
      ...(saved.title !== undefined ? { title: saved.title } : {}),
      ...(saved.body !== undefined ? { body: saved.body } : {}),
      ...(saved.url !== undefined ? { url: saved.url } : {}),
      ...(saved.draft !== undefined ? { draft: saved.draft } : {}),
      reviewStatus: saved.reviewStatus ?? "none",
      checksStatus: saved.checksStatus ?? "none",
      ahead,
      behind,
      ...(saved.updatedAt ? { updatedAt: saved.updatedAt } : {}),
    });
  }
  createFloorPr(workspaceId: string, input: CreateFloorPrInput): Result<FloorPrState> {
    const w = this.store.getWorkspace(workspaceId);
    if (!w) return fail("NOT_FOUND", "espaço não encontrado");
    const cur = this.getFloorPr(workspaceId);
    if (!cur.ok) return cur;
    if (input.push && cur.value.remoteUrl) {
      this.git(w.cwd, ["push", "-u", "origin", cur.value.branch]);
    }
    const prev = this.readPrMeta(workspaceId);
    const nextNum = prev.number ?? (Number(this.store.getMeta("git.prSeq") ?? 0) + 1);
    this.store.setMeta("git.prSeq", String(nextNum));
    const baseBranch = input.baseBranch?.trim() || cur.value.baseBranch;
    const prPath = cur.value.hostKind === "gitlab" ? `-/merge_requests/${nextNum}` : `pull/${nextNum}`;
    const url = `https://${cur.value.host}/${cur.value.repoSlug}/${prPath}`;
    const saved: Partial<FloorPrState> = {
      state: "open",
      number: nextNum,
      title: input.title.trim(),
      body: (input.body ?? "").trim(),
      baseBranch,
      url,
      draft: !!input.draft,
      reviewStatus: input.draft ? "none" : "review_required",
      checksStatus: "passing",
      updatedAt: nowIso(),
    };
    this.store.setMeta(this.prMetaKey(workspaceId), JSON.stringify(saved));
    if (w.parentId && (!w.status || w.status === "working")) {
      this.store.updateWorkspace(workspaceId, { status: "review", statusText: `PR #${nextNum}` }, w.revision + 1);
      this.publishSidebar();
    }
    return this.getFloorPr(workspaceId);
  }
  patchFloorPr(workspaceId: string, input: PatchFloorPrInput): Result<FloorPrState> {
    const w = this.store.getWorkspace(workspaceId);
    if (!w) return fail("NOT_FOUND", "espaço não encontrado");
    const cur = this.getFloorPr(workspaceId);
    if (!cur.ok) return cur;
    const saved: Partial<FloorPrState> = { ...this.readPrMeta(workspaceId) };
    if (input.state !== undefined) saved.state = input.state;
    if (input.number !== undefined) saved.number = input.number;
    if (input.title !== undefined) saved.title = input.title;
    if (input.body !== undefined) saved.body = input.body;
    if (input.url !== undefined) saved.url = input.url;
    if (input.draft !== undefined) saved.draft = input.draft;
    if (input.reviewStatus !== undefined) saved.reviewStatus = input.reviewStatus;
    if (input.checksStatus !== undefined) saved.checksStatus = input.checksStatus;
    if (input.action === "push" && cur.value.remoteUrl) {
      this.git(w.cwd, ["push", "-u", "origin", cur.value.branch]);
    } else if (input.action === "merge") {
      saved.state = "merged";
      saved.reviewStatus = "approved" as FloorPrReviewStatus;
      saved.checksStatus = "passing" as FloorPrChecksStatus;
      if (w.parentId) {
        this.store.updateWorkspace(workspaceId, { status: "done", statusText: saved.number ? `PR #${saved.number} merged` : "PR merged" }, w.revision + 1);
        this.publishSidebar();
      }
    } else if (input.action === "close") {
      saved.state = "closed";
    } else if (input.action === "reopen") {
      saved.state = "open";
    }
    saved.updatedAt = nowIso();
    this.store.setMeta(this.prMetaKey(workspaceId), JSON.stringify(saved));
    return this.getFloorPr(workspaceId);
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
    for (const n of this.store.listNodes(id)) { if (n.kind === "portal") void this.portals.close(n.nodeId); if (n.kind === "device") void this.devices.close(n.nodeId); } // #26 #73
    if (w.parentId) {
      const hk = this.readHooksConfig(id);
      if (hk.teardown.trim() && existsSync(w.cwd)) {
        spawnSync(this.cfg.defaultShell || "/bin/sh", ["-c", hk.teardown], { cwd: w.cwd, env: this.hookEnv(w, "teardown"), stdio: "ignore", timeout: GIT_SYNC_TIMEOUT_MS });
        this.revokeHookToken(`${id}:teardown`); // #87
      }
    }
    this.store.deleteMeta(this.hooksMetaKey(id));
    this.store.deleteMeta(this.wsEnvMetaKey(id));
    this.hookRuns.delete(id);
    if (w.parentId && (w.floorType === "worktree" || w.floorType === "copy")) {
      const ground = this.store.getWorkspace(w.parentId);
      if (ground && w.floorType === "worktree") {
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
    if (input.color) { const c = parseNodeColor(input.color); if (c === null) return fail("INVALID", `cor inválida: ${input.color} (use um nome da paleta ou #rrggbb)`); input = { ...input, color: c }; }
    const valid = validateNewNode({ kind: input.kind, command: input.command });
    if (!valid.ok) return valid;

    let portalContent = "";
    if (input.kind === "portal") { // #26 só http/https; a URL do conteúdo é normalizada aqui (nunca file:, javascript: etc.)
      const raw = parsePortal(input.content).url;
      if (raw) { const u = normalizePortalUrl(raw); if (!u.ok) return fail("INVALID", u.reason); portalContent = serializePortal({ url: u.url }); } else portalContent = serializePortal({ url: "" });
    }
    let deviceContent = "";
    if (input.kind === "device") { // #73 só serial/AVD bem formados entram no conteúdo
      const raw = (() => { try { return JSON.parse(input.content ?? "{}") as { serial?: unknown; avd?: unknown }; } catch { return null; } })();
      if (input.content && !raw) return fail("INVALID", "conteúdo do dispositivo inválido");
      if (raw && ((raw.serial !== undefined && !(typeof raw.serial === "string" && isAdbSerial(raw.serial))) || (raw.avd !== undefined && !(typeof raw.avd === "string" && isAvdName(raw.avd))))) return fail("INVALID", "serial/AVD inválido");
      deviceContent = JSON.stringify(parseDeviceContent(input.content));
    }
    const node: Node = {
      nodeId: newId(), workspaceId, kind: input.kind,
      title: input.title ?? (input.kind === "terminal" ? "Terminal" : input.kind === "text" ? "Texto" : input.kind === "tree" ? "Arquivos" : input.kind === "binder" ? "Fichário" : input.kind === "portal" ? "Portal" : input.kind === "device" ? "Dispositivo" : input.kind === "stack" ? "Grupo" : "Nota"),
      geometry: input.autoPlace ? this.placeFree(this.store.listNodes(workspaceId), input.geometry.w, input.geometry.h) : normalizeGeometry(input.geometry), createdAt: nowIso(),
      ...(input.kind === "note" || input.kind === "text" ? { content: input.content ?? "" } : {}),
      ...(input.kind === "tree" ? { content: input.content ?? JSON.stringify({ root: "", mode: "list" }) } : {}),
      ...(input.kind === "portal" ? { content: portalContent } : {}),
      ...(input.kind === "device" ? { content: deviceContent } : {}),
      ...(input.kind === "binder" ? { content: input.content ?? JSON.stringify({ pages: [{ id: "p1", title: "Página 1", content: "" }], active: "p1", color: "" }) } : {}),
      ...(input.kind === "stack" ? { content: input.content ?? JSON.stringify({ childIds: [], active: "" }) } : {}),
      ...(input.kind === "terminal" && input.roleId ? { roleId: input.roleId } : {}),
      // #56 aparência do terminal (vinda do preset)
      ...(input.color ? { color: input.color } : {}), // qualquer nó (nota, terminal, portal, dispositivo…)
      ...(input.kind === "terminal" && input.icon ? { icon: input.icon } : {}),
      ...(input.kind === "terminal" && input.termTheme && input.termTheme !== "system" ? { termTheme: input.termTheme } : {}),
      ...(input.kind === "terminal" && input.skillIds?.length ? { skillIds: input.skillIds } : {}),
      ...(input.kind === "terminal" && input.maestro ? { maestro: true } : {}), // #29
    };
    if (input.kind === "terminal" && input.isolation) { // #93
      if (!probeIsolation().available) return fail("UNSUPPORTED", probeIsolation().reason ?? "modo isolado indisponível nesta máquina");
      const v = validateIsolation(input.isolation, homedir()); if (!v.ok) return v;
      node.isolation = v.value as NodeIsolation;
    }
    for (const id of node.skillIds ?? []) if (!this.store.getSkill(id)) return fail("NOT_FOUND", `habilidade não encontrada: ${id}`);
    if (node.roleId && !this.store.getRole(node.roleId)) return fail("NOT_FOUND", "papel não encontrado");
    let titleAuto = true;
    if (input.kind === "note") {
      if (input.secret) {
        node.secret = true;
        if (input.secretEnv) node.secretEnv = input.secretEnv.trim();
        // nota secreta: fica SÓ na base, nunca num .md no disco (evita vazar em disco/export). O valor veio em content.
      } else if (input.filePath) {
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
      if (node.isolation) input.isolation = node.isolation; // #93 a cópia nasce no mesmo modo
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

  /** Notas secretas ligadas a este nó → { NOME: valor } pra injetar no ambiente. Ignora nomes reservados (PATH/SHELL/MESS_*). */
  private secretEnvsFor(node: Node): Record<string, string> {
    const out: Record<string, string> = {};
    for (const c of this.store.listNodeConnections(node.nodeId)) {
      const otherId = c.sourceNodeId === node.nodeId ? c.targetNodeId : c.sourceNodeId;
      const o = this.store.getNode(otherId);
      if (o?.kind === "note" && o.secret && o.secretEnv && o.content && !/^(PATH|SHELL)$/.test(o.secretEnv) && !o.secretEnv.startsWith("MESS_")) out[o.secretEnv] = o.content;
    }
    return out;
  }
  /** Valor real de uma nota secreta (só o app/humano chama; nunca vai no snapshot). */
  revealSecret(nodeId: string): Result<{ value: string; envName?: string }> {
    const n = this.store.getNode(nodeId);
    if (!n || n.kind !== "note" || !n.secret) return fail("NOT_FOUND", "nota secreta não encontrada");
    return succeed({ value: n.content ?? "", ...(n.secretEnv ? { envName: n.secretEnv } : {}) });
  }
  private plan(w: Workspace, node: Node, s: Session, opts: { reattach?: boolean } = {}) {
    const baseEnv: Record<string, string> = {};
    // Não herdar marcadores de sessão de agentes que possam ter lançado o runtime.
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !/^(CLAUDECODE|CLAUDE_CODE_|CODEX_)/.test(k)) baseEnv[k] = v;
    baseEnv["PATH"] = `${CLI_DIR}${delimiter}${baseEnv["PATH"] ?? ""}`;
    const role = node.roleId ? this.store.getRole(node.roleId) : undefined;
    const skills = (node.skillIds ?? []).map((id) => this.store.getSkill(id)).filter((k): k is Skill => !!k); // #57
    const ground = w.parentId ? this.store.getWorkspace(w.parentId) : undefined;
    const userEnv = this.effectiveEnvForWorkspace(w);
    // #87 cada terminal recebe credencial própria (escopo: nó/sessão/capacidades), nunca o token mestre
    const agentToken = opts.reattach ? this.reattachToken(node, s) : this.agentTokenForSpawn(node, s);
    const inject = {
      ...userEnv,
      ...this.secretEnvsFor(node), // notas secretas ligadas → injeta o valor como env (o agente usa $NOME, nunca vê o valor)
      ...(role ? { [AGENT_ENV.roleName]: role.name, [AGENT_ENV.roleInstructions]: roleText(role) } : {}),
      ...(skills.length ? { [AGENT_ENV.skills]: skills.map((k) => k.name).join(", "), [AGENT_ENV.skillsText]: skillsText(skills) } : {}),
      ...(ground ? { [AGENT_ENV.floorId]: w.workspaceId, [AGENT_ENV.floorName]: w.name, [AGENT_ENV.floorBranch]: w.branch ?? "", [AGENT_ENV.branchName]: w.branch ?? "", [AGENT_ENV.floorPath]: w.cwd, [AGENT_ENV.rootPath]: ground.cwd, [AGENT_ENV.projectName]: ground.name } : { [AGENT_ENV.rootPath]: w.cwd, [AGENT_ENV.projectName]: w.name }),
      [AGENT_ENV.socket]: this.cfg.socketPath, [AGENT_ENV.token]: agentToken,
      [AGENT_ENV.workspaceId]: w.workspaceId, [AGENT_ENV.workspaceName]: w.name, [AGENT_ENV.workspaceDir]: w.cwd,
      [AGENT_ENV.nodeId]: node.nodeId, [AGENT_ENV.sessionId]: s.sessionId, [AGENT_ENV.cli]: join(CLI_DIR, "mess"),
      ...(node.maestro ? { [AGENT_ENV.maestro]: "1" } : {}), // #29
      SHELL: this.cfg.defaultShell,
      // Empacotado: o launcher `mess` roda o CLI com o Node do Electron (sem Node do sistema).
      ...(process.env["MESS_RESOURCES"] ? { MESS_ELECTRON: process.execPath } : {}),
    };
    if (agentKind(s.command, s.args).agentType === "claudeCode") this.ensureClaudeTrust(s.cwd); // #6 pré-confia a pasta: evita o diálogo de trust (cujo default "No, exit" o briefing fechava)
    // Claude autônomo SÓ quando isolado (#93): no sandbox do MessAI o agente roda sem as perguntas de permissão do Claude Code; fora dele, mantém.
    const termArgs = withAgentAutonomy(s.command, applySkills(s.command, applyRole(s.command, s.args, role), skills));
    let plan = planLocalTerminal({ command: s.command, args: termArgs, cwd: s.cwd, defaultShell: this.cfg.defaultShell, baseEnv, inject });
    // #93 modo isolado: bubblewrap por fora (e tmux, se persistente, por fora dele). Falha FECHADA se o isolamento não for possível.
    if (node.kind === "terminal" && node.isolation) {
      const st = this.settings();
      plan = buildIsolatedPlan({ plan, iso: node.isolation, home: homedir(), baseEnv, inject, workspaceCwd: w.cwd, groundCwd: ground?.cwd, socketPath: this.cfg.socketPath,
        cliRoot: process.env["MESS_RESOURCES"] ?? join(CLI_DIR, "../../.."), globalRo: st.isolationRo ?? [], globalRw: st.isolationRw ?? [] });
    }
    return s.persistent ? wrapInTmux(plan, tmuxSessionName(s.sessionId), { ...inject, PATH: baseEnv["PATH"]! }, this.cfg.tmuxSocket) : plan;
  }

  // ---- #72 Ambientes: variáveis de ambiente por espaço e global ----
  private wsEnvMetaKey(workspaceId: string): string { return `env.ws.${workspaceId}`; }
  private parseStoredEnv(raw: string | undefined): EnvVarEntry[] {
    if (!raw) return [];
    try {
      const j = JSON.parse(raw) as EnvVarEntry[];
      if (!Array.isArray(j)) return [];
      const r = normalizeEnvVars(j);
      return r.ok ? r.value : [];
    } catch { return []; }
  }
  getGlobalEnv(): EnvVarEntry[] {
    return this.parseStoredEnv(this.store.getMeta("env.global"));
  }
  putGlobalEnv(input: PutEnvVarsInput): Result<EnvVarEntry[]> {
    const r = normalizeEnvVars(input.vars);
    if (!r.ok) return r;
    this.store.setMeta("env.global", JSON.stringify(r.value));
    return succeed(r.value);
  }
  getWorkspaceEnv(workspaceId: string): Result<EnvVarEntry[]> {
    if (!this.store.getWorkspace(workspaceId)) return fail("NOT_FOUND", "espaço não encontrado");
    return succeed(this.parseStoredEnv(this.store.getMeta(this.wsEnvMetaKey(workspaceId))));
  }
  putWorkspaceEnv(workspaceId: string, input: PutEnvVarsInput): Result<EnvVarEntry[]> {
    if (!this.store.getWorkspace(workspaceId)) return fail("NOT_FOUND", "espaço não encontrado");
    const r = normalizeEnvVars(input.vars);
    if (!r.ok) return r;
    this.store.setMeta(this.wsEnvMetaKey(workspaceId), JSON.stringify(r.value));
    return succeed(r.value);
  }
  getEnvironments(): EnvironmentsState {
    const workspaces: Record<string, EnvVarEntry[]> = {};
    for (const w of this.store.listWorkspaces()) {
      const list = this.parseStoredEnv(this.store.getMeta(this.wsEnvMetaKey(w.workspaceId)));
      if (list.length > 0) workspaces[w.workspaceId] = list;
    }
    return { global: this.getGlobalEnv(), workspaces };
  }
  effectiveEnvForWorkspace(w: Workspace): Record<string, string> {
    const globalVars = this.getGlobalEnv();
    const groundVars = w.parentId ? this.parseStoredEnv(this.store.getMeta(this.wsEnvMetaKey(w.parentId))) : undefined;
    const wsVars = this.parseStoredEnv(this.store.getMeta(this.wsEnvMetaKey(w.workspaceId)));
    return mergeEnvLayers(globalVars, groundVars, wsVars);
  }

  // ---- #83 Exportar/importar espaço (.messai) e duplicar ----
  exportWorkspace(workspaceId: string): Result<WorkspaceBundle> {
    const w = this.store.getWorkspace(workspaceId);
    if (!w) return fail("NOT_FOUND", "espaço não encontrado");
    const allNodes = this.store.listNodes(workspaceId);
    const nodeIds = new Set(allNodes.map((n) => n.nodeId));
    const keyOfNode = new Map(allNodes.map((n, i) => [n.nodeId, `n${i + 1}`]));
    const allGroups = this.store.listGroups(workspaceId);
    const keyOfGroup = new Map(allGroups.map((g, i) => [g.groupId, `g${i + 1}`]));
    const rolesMap = new Map<string, CreateRole>();
    const skillsMap = new Map<string, CreateSkill>();

    const nodes: BundleNode[] = allNodes.map((n) => {
      const ses = n.kind === "terminal" && n.sessionId ? this.store.getSession(n.sessionId) : undefined;
      const role = n.roleId ? this.store.getRole(n.roleId) : undefined;
      if (role && !rolesMap.has(role.name)) {
        rolesMap.set(role.name, { name: role.name, badge: role.badge, instructions: role.instructions });
      }
      const skillNames: string[] = [];
      for (const sid of n.skillIds ?? []) {
        const sk = this.store.getSkill(sid);
        if (sk) {
          skillNames.push(sk.name);
          if (!skillsMap.has(sk.name)) {
            skillsMap.set(sk.name, { name: sk.name, description: sk.description, instructions: sk.instructions });
          }
        }
      }
      const groupKey = n.groupId ? keyOfGroup.get(n.groupId) : undefined;
      return {
        key: keyOfNode.get(n.nodeId)!,
        kind: n.kind,
        title: n.title,
        geometry: { ...n.geometry },
        ...(n.kind !== "terminal" && n.content !== undefined && !n.secret ? { content: n.content } : {}),
        ...(n.color ? { color: n.color } : {}),
        ...(n.locked ? { locked: true } : {}),
        ...(n.icon ? { icon: n.icon } : {}),
        ...(n.termTheme ? { termTheme: n.termTheme } : {}),
        ...(n.maestro ? { maestro: true } : {}),
        ...(n.memLimitMb ? { memLimitMb: n.memLimitMb } : {}),
        ...(n.isolation ? { isolation: n.isolation } : {}),
        ...(role ? { roleName: role.name } : {}),
        ...(skillNames.length ? { skillNames } : {}),
        ...(groupKey ? { groupKey } : {}),
        ...(ses ? { command: ses.command, args: ses.args, cwd: ses.cwd, ...(ses.persistent ? { persistent: true } : {}) } : {}),
      };
    });

    const connections: BundleConnection[] = connectionsWithin(this.store.listConnections(workspaceId), nodeIds).map((c) => ({
      from: keyOfNode.get(c.sourceNodeId)!,
      to: keyOfNode.get(c.targetNodeId)!,
      ...(c.label ? { label: c.label } : {}),
      ...(c.style ? { style: c.style } : {}),
    }));

    const groups: BundleGroup[] = allGroups.map((g) => ({
      key: keyOfGroup.get(g.groupId)!,
      label: g.label,
      color: g.color,
    }));

    const bands: BundleBand[] = this.store.listBands(workspaceId).map((b) => ({
      name: b.name,
      color: b.color,
      memberKeys: b.nodeIds.map((id) => keyOfNode.get(id)).filter((k): k is string => !!k),
    }));

    const drawings: BundleDrawing[] = this.store.listDrawings(workspaceId).map((d) => ({
      kind: d.kind,
      points: d.points,
      color: d.color,
      width: d.width,
      ...(d.groupId ? { groupId: d.groupId } : {}),
    }));

    const envVars = this.parseStoredEnv(this.store.getMeta(this.wsEnvMetaKey(workspaceId)));
    const hooks = this.readHooksConfig(workspaceId);
    const hasHooks = Boolean(hooks.setup || hooks.run || hooks.teardown);
    const savedExcludes = this.store.getMeta(`excludes.${workspaceId}`);
    let excludeDirs: string[] | undefined;
    if (savedExcludes) {
      try { excludeDirs = normalizeFloorExcludes(JSON.parse(savedExcludes) as string[]); } catch { /* */ }
    }

    return succeed({
      format: WORKSPACE_BUNDLE_FORMAT,
      exportedAt: nowIso(),
      workspace: { name: w.name, cwd: w.cwd, icon: w.icon, color: w.color },
      nodes,
      connections,
      groups,
      bands,
      drawings,
      roles: [...rolesMap.values()],
      skills: [...skillsMap.values()],
      envVars,
      ...(hasHooks ? { hooks } : {}),
      ...(excludeDirs ? { excludeDirs } : {}),
    });
  }

  previewWorkspaceImport(bundle: WorkspaceBundle): Result<WorkspaceBundlePreview> {
    if (bundle.format !== WORKSPACE_BUNDLE_FORMAT) {
      return fail("INVALID", `formato de pacote incompatível: ${String(bundle.format)}`);
    }
    const warnings: string[] = [];
    if (!existsSync(bundle.workspace.cwd)) {
      warnings.push(`O diretório original "${bundle.workspace.cwd}" não existe nesta máquina; será usado "${homedir()}" se não for alterado.`);
    }
    const secrets = bundle.envVars.filter((v) => v.secret).length;
    if (secrets > 0) {
      warnings.push(`O pacote inclui ${secrets} variável(is) de ambiente marcada(s) como sensível(is).`);
    }
    for (const r of bundle.roles) {
      if (this.store.findRoleByName(r.name)) {
        warnings.push(`O papel "${r.name}" já existe localmente e será reutilizado.`);
      }
    }
    for (const s of bundle.skills) {
      if (this.store.findSkillByName(s.name)) {
        warnings.push(`A habilidade "${s.name}" já existe localmente e será reutilizada.`);
      }
    }
    return succeed({
      valid: true,
      name: bundle.workspace.name,
      cwd: bundle.workspace.cwd,
      exportedAt: bundle.exportedAt,
      counts: {
        nodes: bundle.nodes.length,
        terminals: bundle.nodes.filter((n) => n.kind === "terminal").length,
        notes: bundle.nodes.filter((n) => n.kind === "note" || n.kind === "text").length,
        binders: bundle.nodes.filter((n) => n.kind === "binder").length,
        connections: bundle.connections.length,
        groups: bundle.groups.length,
        bands: bundle.bands.length,
        drawings: bundle.drawings.length,
        roles: bundle.roles.length,
        skills: bundle.skills.length,
        envVars: bundle.envVars.length,
        secrets,
      },
      nodeTitles: bundle.nodes.map((n) => `${n.title} (${n.kind})`),
      roleNames: bundle.roles.map((r) => r.name),
      skillNames: bundle.skills.map((s) => s.name),
      envKeys: bundle.envVars.map((v) => v.key),
      warnings,
    });
  }

  importWorkspace(input: ImportWorkspaceInput): Result<Workspace> {
    const { bundle } = input;
    if (bundle.format !== WORKSPACE_BUNDLE_FORMAT) {
      return fail("INVALID", `formato de pacote incompatível: ${String(bundle.format)}`);
    }
    const targetCwd = input.cwd?.trim() || (existsSync(bundle.workspace.cwd) ? bundle.workspace.cwd : homedir());
    const targetName = input.name?.trim() || bundle.workspace.name;
    const wsRes = this.createWorkspace({
      name: targetName,
      cwd: targetCwd,
      icon: bundle.workspace.icon,
      color: bundle.workspace.color,
      ...(input.folderId ? { folderId: input.folderId } : {}),
    });
    if (!wsRes.ok) return wsRes;
    const wsId = wsRes.value.workspaceId;

    // Configura variáveis de ambiente, hooks e pastas excluídas antes de subir os terminais
    if (input.includeEnv !== false && bundle.envVars.length > 0) {
      this.putWorkspaceEnv(wsId, { vars: bundle.envVars });
    }
    if (bundle.hooks && (bundle.hooks.setup || bundle.hooks.run || bundle.hooks.teardown)) {
      this.store.setMeta(this.hooksMetaKey(wsId), JSON.stringify(bundle.hooks));
    }
    if (bundle.excludeDirs?.length) {
      this.putFloorExcludes(wsId, { excludeDirs: bundle.excludeDirs });
    }

    // Garante papéis e habilidades referenciados
    for (const r of bundle.roles) {
      if (!this.store.findRoleByName(r.name)) {
        this.createRole(r);
      }
    }
    for (const s of bundle.skills) {
      if (!this.store.findSkillByName(s.name)) {
        this.createSkill(s);
      }
    }

    const curRev = () => this.store.getWorkspace(wsId)!.revision;
    const nodeMap = new Map<string, string>();
    const groupMembers = new Map<string, string[]>();

    for (const n of bundle.nodes) {
      const role = n.roleName ? this.store.findRoleByName(n.roleName) : undefined;
      const skillIds = (n.skillNames ?? [])
        .map((nm) => this.store.findSkillByName(nm)?.skillId)
        .filter((x): x is string => !!x);
      const nodeCwd = n.cwd && existsSync(n.cwd) ? n.cwd : targetCwd;
      const created = this.createNode(wsId, {
        expectedRevision: curRev(),
        kind: n.kind,
        title: n.title,
        geometry: n.geometry,
        ...(n.content !== undefined ? { content: n.content } : {}),
        ...(n.color ? { color: n.color } : {}),
        ...(n.icon ? { icon: n.icon } : {}),
        ...(n.termTheme ? { termTheme: n.termTheme as never } : {}),
        ...(role ? { roleId: role.roleId } : {}),
        ...(skillIds.length ? { skillIds } : {}),
        ...(n.maestro ? { maestro: true } : {}),
        // #93 bundle de terceiros: mantém o modo isolado (rede/limites) mas NÃO herda caminhos ro/rw do arquivo
        ...(n.kind === "terminal" && n.isolation ? { isolation: { network: n.isolation.network, ...(n.isolation.memoryMaxMb ? { memoryMaxMb: n.isolation.memoryMaxMb } : {}), ...(n.isolation.tasksMax ? { tasksMax: n.isolation.tasksMax } : {}) } } : {}),
        ...(n.kind === "terminal" && n.command ? { command: n.command, args: n.args ?? [] } : {}),
        ...(n.kind === "terminal" ? { cwd: nodeCwd } : {}),
        ...(n.persistent ? { persistent: true } : {}),
      });
      if (!created.ok) continue;
      const newNodeId = created.value.node.nodeId;
      nodeMap.set(n.key, newNodeId);
      if (n.locked || n.memLimitMb) {
        this.patchNode(newNodeId, {
          expectedRevision: curRev(),
          ...(n.locked ? { locked: true } : {}),
          ...(n.memLimitMb ? { memLimitMb: n.memLimitMb } : {}),
        });
      }
      if (n.groupKey) {
        groupMembers.set(n.groupKey, [...(groupMembers.get(n.groupKey) ?? []), newNodeId]);
      }
    }

    for (const g of bundle.groups) {
      const members = groupMembers.get(g.key) ?? [];
      if (members.length > 0) {
        this.createNodeGroup(wsId, {
          expectedRevision: curRev(),
          nodeIds: members,
          label: g.label,
          color: g.color,
        });
      }
    }

    for (const c of bundle.connections) {
      const fromId = nodeMap.get(c.from);
      const toId = nodeMap.get(c.to);
      if (!fromId || !toId) continue;
      const conn = this.createConnection(wsId, {
        expectedRevision: curRev(),
        sourceNodeId: fromId,
        targetNodeId: toId,
        ...(c.label ? { label: c.label } : {}),
      });
      if (conn.ok && c.style && c.style !== "rope") {
        this.patchConnection(conn.value.connectionId, { expectedRevision: curRev(), style: c.style });
      }
    }

    for (const b of bundle.bands) {
      const memberIds = b.memberKeys.map((k) => nodeMap.get(k)).filter((x): x is string => !!x);
      this.createBand(wsId, { name: b.name, color: b.color, nodeIds: memberIds });
    }

    for (const d of bundle.drawings) {
      this.createDrawing(wsId, {
        expectedRevision: curRev(),
        kind: d.kind,
        points: d.points,
        color: d.color,
        width: d.width,
      });
    }

    this.publish(wsId);
    this.publishSidebar();
    return succeed(this.store.getWorkspace(wsId)!);
  }

  duplicateWorkspace(workspaceId: string, input: DuplicateWorkspaceInput = {}): Result<Workspace> {
    const w = this.store.getWorkspace(workspaceId);
    if (!w) return fail("NOT_FOUND", "espaço não encontrado");
    const exp = this.exportWorkspace(workspaceId);
    if (!exp.ok) return exp;
    return this.importWorkspace({
      bundle: exp.value,
      name: input.name?.trim() || `${w.name} (cópia)`,
      cwd: input.cwd?.trim() || w.cwd,
      ...(input.folderId !== undefined ? { folderId: input.folderId } : w.folderId ? { folderId: w.folderId } : {}),
      includeEnv: true,
      ...(input.startTerminals !== undefined ? { startTerminals: input.startTerminals } : {}),
    });
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

  private readPathList(key: string): string[] { try { const j = JSON.parse(this.store.getMeta(key) ?? "[]") as unknown; return Array.isArray(j) ? j.filter((x): x is string => typeof x === "string") : []; } catch { return []; } }
  /** #93 o nó existe e roda isolado? / qual o tipo do nó? (guardas do servidor para chamadores isolados) */
  isNodeIsolated(nodeId: string): boolean { return !!this.store.getNode(nodeId)?.isolation; }
  nodeKindOf(nodeId: string): string | undefined { return this.store.getNode(nodeId)?.kind; }
  /** #93 o modo isolado funciona nesta máquina? (bwrap utilizável; cgroup só para os limites duros) */
  isolationSupport(): { available: boolean; reason?: string; cgroup: boolean } { return probeIsolation(); }

  // #55 — configurações do runtime, persistidas na tabela meta (chave `settings.<nome>`).
  settings(): RuntimeSettings {
    const lim = Number(this.store.getMeta("settings.termMemLimitMb") ?? 0) || 0;
    const act = this.store.getMeta("settings.termMemAction");
    const autoUnload = Number(this.store.getMeta("settings.autoUnloadMinutes") ?? 0) || 0;
    const reloadOnSel = this.store.getMeta("settings.reloadOnSelect");
    return {
      restoreSessions: this.store.getMeta("settings.restoreSessions") !== "0",
      ...(lim > 0 ? { termMemLimitMb: lim } : {}),
      ...(act === "kill" || act === "warn" ? { termMemAction: act } : {}),
      ...(autoUnload > 0 ? { autoUnloadMinutes: autoUnload } : {}),
      reloadOnSelect: reloadOnSel !== "0",
      ...(this.readPathList("settings.isolationRo").length ? { isolationRo: this.readPathList("settings.isolationRo") } : {}),
      ...(this.readPathList("settings.isolationRw").length ? { isolationRw: this.readPathList("settings.isolationRw") } : {}),
    };
  }
  patchSettings(p: PatchRuntimeSettings): Result<RuntimeSettings> {
    if (p.restoreSessions !== undefined) this.store.setMeta("settings.restoreSessions", p.restoreSessions ? "1" : "0");
    if (p.termMemLimitMb !== undefined) this.store.setMeta("settings.termMemLimitMb", String(Math.max(0, Math.round(p.termMemLimitMb))));
    if (p.termMemAction !== undefined) this.store.setMeta("settings.termMemAction", p.termMemAction === "kill" ? "kill" : "warn");
    if (p.autoUnloadMinutes !== undefined) this.store.setMeta("settings.autoUnloadMinutes", String(Math.max(0, Math.round(p.autoUnloadMinutes))));
    if (p.reloadOnSelect !== undefined) this.store.setMeta("settings.reloadOnSelect", p.reloadOnSelect ? "1" : "0");
    for (const [k, list] of [["settings.isolationRo", p.isolationRo], ["settings.isolationRw", p.isolationRw]] as const) {
      if (list === undefined) continue;
      const v = validateIsolation({ network: "none", ro: list }, homedir()); if (!v.ok) return v; // mesmas regras: nunca a raiz/home
      this.store.setMeta(k, JSON.stringify(v.value.ro ?? []));
    }
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
      if (this.sessions.tmuxAlive(s.sessionId)) { this.sessions.start({ ...s, state: "starting" }, this.plan(w, node, s, { reattach: true })); reattached++; }
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
    if (s.state === "unloaded") return this.reloadNode(nodeId);
    this.sessions.dispose(s.sessionId);
    this.store.updateSession(s.sessionId, { state: "starting", exitCode: null, pid: null });
    return succeed(this.sessions.start({ ...s, state: "starting" }, this.plan(w, node, s)));
  }

  // ---- #84 Descarregar/recarregar espaços e terminais (poupar recursos) ----
  unloadNode(nodeId: string): Result<Session> {
    const node = this.store.getNode(nodeId);
    if (!node?.sessionId) return fail("NOT_FOUND", "nó terminal não encontrado");
    const s = this.store.getSession(node.sessionId);
    if (!s) return fail("NOT_FOUND", "sessão não encontrada");
    this.sessions.dispose(s.sessionId, false);
    this.revokeAgentTokensForNode(nodeId); // #87
    this.store.updateSession(s.sessionId, { state: "unloaded", pid: null, exitCode: null });
    const updated = this.store.getSession(s.sessionId)!;
    this.sessions.emit("session", updated);
    this.publish(node.workspaceId);
    this.publishSidebar();
    return succeed(updated);
  }

  reloadNode(nodeId: string): Result<Session> {
    const node = this.store.getNode(nodeId);
    if (!node?.sessionId) return fail("NOT_FOUND", "nó terminal não encontrado");
    const w = this.store.getWorkspace(node.workspaceId)!;
    const s = this.store.getSession(node.sessionId);
    if (!s) return fail("NOT_FOUND", "sessão não encontrada");
    if (s.state === "running") return succeed(s);
    this.sessions.dispose(s.sessionId, false);
    const resumed = this.resumeSession(s);
    this.store.updateSession(s.sessionId, { state: "starting", exitCode: null, pid: null });
    const started = this.sessions.start({ ...resumed, state: "starting" }, this.plan(w, node, resumed));
    if (w.unloaded) {
      this.store.updateWorkspace(w.workspaceId, { unloaded: false }, w.revision + 1);
    }
    this.publish(node.workspaceId);
    this.publishSidebar();
    return succeed(started);
  }

  unloadWorkspace(workspaceId: string): Result<{ unloaded: number; unloadedCount: number; workspace: Workspace }> {
    const w = this.store.getWorkspace(workspaceId);
    if (!w) return fail("NOT_FOUND", "espaço não encontrado");
    let count = 0;
    for (const n of this.store.listNodes(workspaceId)) {
      if (n.kind !== "terminal" || !n.sessionId) continue;
      const s = this.store.getSession(n.sessionId);
      if (!s) continue;
      if (s.state === "running" || s.state === "starting") count++;
      this.sessions.dispose(s.sessionId, false);
      this.store.updateSession(s.sessionId, { state: "unloaded", pid: null, exitCode: null });
      const updated = this.store.getSession(s.sessionId)!;
      this.sessions.emit("session", updated);
    }
    this.store.updateWorkspace(workspaceId, { unloaded: true }, w.revision + 1);
    const out = this.publish(workspaceId).workspace;
    this.publishSidebar();
    return succeed({ unloaded: count, unloadedCount: count, workspace: out });
  }

  reloadWorkspace(workspaceId: string): Result<{ reloaded: number; reloadedCount: number; workspace: Workspace }> {
    const w = this.store.getWorkspace(workspaceId);
    if (!w) return fail("NOT_FOUND", "espaço não encontrado");
    this.store.updateWorkspace(workspaceId, { unloaded: false }, w.revision + 1);
    const updatedWs = this.store.getWorkspace(workspaceId)!;
    let count = 0;
    for (const n of this.store.listNodes(workspaceId)) {
      if (n.kind !== "terminal" || !n.sessionId) continue;
      const s = this.store.getSession(n.sessionId);
      if (!s || s.state === "running") continue;
      if (s.state === "unloaded" || s.state === "lost" || s.state === "exited") {
        this.sessions.dispose(s.sessionId, false);
        const resumed = this.resumeSession(s);
        this.store.updateSession(s.sessionId, { state: "starting", exitCode: null, pid: null });
        this.sessions.start({ ...resumed, state: "starting" }, this.plan(updatedWs, n, resumed));
        count++;
      }
    }
    const out = this.publish(workspaceId).workspace;
    this.publishSidebar();
    return succeed({ reloaded: count, reloadedCount: count, workspace: out });
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
        ...(n.kind !== "terminal" && n.content !== undefined && !n.secret ? { content: n.content } : {}), ...(n.color ? { color: n.color } : {}), ...(n.icon ? { icon: n.icon } : {}), ...(n.termTheme ? { termTheme: n.termTheme } : {}),
        ...(role ? { roleName: role.name } : {}), ...(skillNames.length ? { skillNames } : {}),
        ...(n.isolation ? { isolation: n.isolation } : {}),
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
        ...(n.kind === "terminal" && n.command ? { command: n.command, args: n.args ?? [] } : {}), ...(cwd ? { cwd } : {}), ...(n.persistent ? { persistent: true } : {}), ...(n.kind === "terminal" && n.isolation ? { isolation: n.isolation } : {}) });
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

  // ---- #82 conexões locais, entre andares e entre espaços ----
  private resolveCrossTarget(fromWorkspaceId: string, fromNodeId: string | undefined, ref: string): Result<Node> {
    const connIds = new Set(
      fromNodeId
        ? this.store.listNodeConnections(fromNodeId).map((c) => (c.sourceNodeId === fromNodeId ? c.targetNodeId : c.sourceNodeId))
        : [],
    );
    // alvo de ask/check/mensagem é sempre um terminal — ignora notas com o mesmo título
    return resolveCrossNodeRef(this.store.listAllNodes().filter((n) => n.kind === "terminal"), this.store.listWorkspaces(), fromWorkspaceId, connIds, ref);
  }
  private publishConnectionEndpoints(c: Pick<Connection, "workspaceId" | "sourceNodeId" | "targetNodeId">): void {
    const wsIds = new Set<string>([c.workspaceId]);
    const a = this.store.getNode(c.sourceNodeId); if (a) wsIds.add(a.workspaceId);
    const b = this.store.getNode(c.targetNodeId); if (b) wsIds.add(b.workspaceId);
    for (const id of wsIds) if (this.store.getWorkspace(id)) this.publish(id);
  }
  patchConnection(id: string, input: PatchConnection): Result<Connection> {
    const c = this.store.getConnection(id);
    if (!c) return fail("NOT_FOUND", "conexão não encontrada");
    let revWs = this.store.getWorkspace(c.workspaceId)!;
    let rev = checkRevision(revWs, input.expectedRevision);
    if (!rev.ok) {
      for (const nid of [c.sourceNodeId, c.targetNodeId]) {
        const nw = this.store.getNode(nid)?.workspaceId;
        if (!nw || nw === revWs.workspaceId) continue;
        const tw = this.store.getWorkspace(nw);
        if (tw) { const r2 = checkRevision(tw, input.expectedRevision); if (r2.ok) { revWs = tw; rev = r2; break; } }
      }
    }
    if (!rev.ok) return rev;
    this.store.transaction(() => { this.store.updateConnection(id, { style: input.style, label: input.label }); this.store.bumpRevision(revWs.workspaceId, rev.value); });
    this.publishConnectionEndpoints(c);
    return succeed(this.store.getConnection(id)!);
  }
  createConnection(workspaceId: string, input: CreateConnection, byAgent = false): Result<Connection> {
    const w = this.store.getWorkspace(workspaceId);
    if (!w) return fail("NOT_FOUND", "espaço não encontrado");
    const rev = checkRevision(w, input.expectedRevision);
    if (!rev.ok) return rev;
    const a = this.store.getNode(input.sourceNodeId);
    if (!a) return fail("INVALID", "nós inválidos para este espaço");
    let b: Node | undefined;
    if (input.targetNodeId) {
      b = this.store.getNode(input.targetNodeId);
      if (!b) return fail("INVALID", "nós inválidos para este espaço");
    } else if (input.targetRef) {
      const r = this.resolveCrossTarget(workspaceId, a.nodeId, input.targetRef);
      if (!r.ok) return r;
      b = r.value;
    } else {
      return fail("INVALID", "informe targetNodeId ou targetRef");
    }
    if (a.workspaceId !== workspaceId && b.workspaceId !== workspaceId) return fail("INVALID", "nós inválidos para este espaço");
    if (a.nodeId === b.nodeId) return fail("INVALID", "um nó não se conecta a si mesmo");
    const existing = this.store.listNodeConnections(a.nodeId).find((c) => (c.sourceNodeId === a.nodeId && c.targetNodeId === b!.nodeId) || (c.sourceNodeId === b!.nodeId && c.targetNodeId === a.nodeId && a.workspaceId !== b!.workspaceId));
    if (existing) return succeed(existing); // idempotente: ligar o que já está ligado não é erro (agentes repetem o connect por hábito)
    const c: Connection = { connectionId: newId(), workspaceId, sourceNodeId: a.nodeId, targetNodeId: b.nodeId, createdAt: nowIso(), ...(input.label ? { label: input.label } : {}) };
    this.store.transaction(() => { this.store.insertConnection(c); this.store.bumpRevision(workspaceId, rev.value); });
    this.publishConnectionEndpoints(c);
    // NÃO re-arranjar a árvore aqui: respeita o layout que o usuário fez na mão. A árvore automática fica só sob comando ("Organizar em árvore").
    // Nota secreta ligada a um terminal JÁ rodando: a env só entra no SPAWN → reinicia o terminal pra injetar agora.
    const secretNote = [a, b].find((x) => x.kind === "note" && x.secret && x.secretEnv);
    const term = [a, b].find((x) => x.kind === "terminal");
    if (secretNote && term?.sessionId && this.store.getSession(term.sessionId)?.state === "running") this.respawnTerminal(term.nodeId);
    return succeed(c);
  }

  deleteConnection(connectionId: string, expectedRevision: number): Result<void> {
    const c = this.store.getConnection(connectionId);
    if (!c) return fail("NOT_FOUND", "conexão não encontrada");
    let revWs = this.store.getWorkspace(c.workspaceId)!;
    let rev = checkRevision(revWs, expectedRevision);
    if (!rev.ok) {
      for (const nid of [c.sourceNodeId, c.targetNodeId]) {
        const nw = this.store.getNode(nid)?.workspaceId;
        if (!nw || nw === revWs.workspaceId) continue;
        const tw = this.store.getWorkspace(nw);
        if (tw) { const r2 = checkRevision(tw, expectedRevision); if (r2.ok) { revWs = tw; rev = r2; break; } }
      }
    }
    if (!rev.ok) return rev;
    this.store.transaction(() => { this.store.deleteConnection(connectionId); this.store.bumpRevision(revWs.workspaceId, rev.value); });
    this.publishConnectionEndpoints(c);
    return succeed(undefined);
  }

  /** Nós ligados a um nó, nos dois sentidos (inclusive entre andares e entre espaços). Base para agentes lerem contexto. */
  connectedNodes(nodeId: string): Result<ConnectedPeer[]> {
    const me = this.store.getNode(nodeId);
    if (!me) return fail("NOT_FOUND", "nó não encontrado");
    const out: ConnectedPeer[] = [];
    for (const c of this.store.listNodeConnections(nodeId)) {
      const otherId = c.sourceNodeId === nodeId ? c.targetNodeId : c.targetNodeId === nodeId ? c.sourceNodeId : null;
      if (!otherId) continue;
      const node = this.store.getNode(otherId);
      if (!node) continue;
      const ws = this.store.getWorkspace(node.workspaceId);
      const row: ConnectedPeer = {
        node: this.redactSecret(this.syncNoteFromDisk(node)), // nunca expor o valor de nota secreta (nem no mess context)
        direction: c.sourceNodeId === nodeId ? "out" : "in",
        connectionId: c.connectionId,
        workspaceId: node.workspaceId,
        workspaceName: ws?.name ?? "",
        crossWorkspace: node.workspaceId !== me.workspaceId,
      };
      if (node.kind === "terminal" && node.sessionId) { const s = this.store.getSession(node.sessionId); if (s) row.agentType = agentKind(s.command, s.args).agentType; }
      out.push(row);
    }
    return succeed(out);
  }

  /** #82 Lista terminais e notas de outros andares/espaços disponíveis para conexão cross-floor/cross-workspace. */
  listCrossCandidates(nodeId: string): Result<CrossNodeCandidate[]> {
    const me = this.store.getNode(nodeId);
    if (!me) return fail("NOT_FOUND", "nó não encontrado");
    const wsMap = new Map(this.store.listWorkspaces().map((w) => [w.workspaceId, w]));
    const out: CrossNodeCandidate[] = [];
    for (const n of this.store.listAllNodes()) {
      if (n.workspaceId === me.workspaceId) continue;
      if (n.kind !== "terminal" && n.kind !== "note") continue;
      const w = wsMap.get(n.workspaceId);
      if (!w) continue;
      out.push({
        nodeId: n.nodeId,
        title: n.title,
        kind: n.kind,
        workspaceId: w.workspaceId,
        workspaceName: w.name,
        ...(w.parentId ? { parentId: w.parentId } : {}),
        ...(w.branch ? { branch: w.branch } : {}),
        refLabel: `${n.title} @ ${w.name}`,
      });
    }
    return succeed(out);
  }

  /** Identidade (agente de IA × shell) de um nó terminal. */
  private kindOfNode(node: Node): { isAgent: boolean; agentType: string } {
    if (node.kind === "terminal" && node.sessionId) { const s = this.store.getSession(node.sessionId); if (s) return agentKind(s.command, s.args); }
    return { isAgent: false, agentType: "genericShell" };
  }

  private senderLabel(from: Node, targetWorkspaceId: string): string {
    if (from.workspaceId === targetWorkspaceId) return from.title;
    const w = this.store.getWorkspace(from.workspaceId);
    return w ? `${from.title} @ ${w.name}` : from.title;
  }

  /** Envia mensagem de um nó terminal a outro nó conectado; entrega como prompt se o destino estiver rodando. */
  sendMessage(fromNodeId: string, input: SendMessage): Result<Message> {
    const from = this.store.getNode(fromNodeId);
    if (!from) return fail("NOT_FOUND", "nó de origem não encontrado");
    const to = this.resolveCrossTarget(from.workspaceId, fromNodeId, input.to);
    if (!to.ok) return to;
    if (to.value.kind !== "terminal") return fail("INVALID", "o destino precisa ser um terminal");
    const allowed = canMessage(this.store.listNodeConnections(fromNodeId), fromNodeId, to.value.nodeId);
    if (!allowed.ok) return allowed;
    const m: Message = { messageId: newId(), workspaceId: to.value.workspaceId, fromNodeId, toNodeId: to.value.nodeId, text: input.text, createdAt: nowIso(), delivered: false, ...(input.replyTo ? { replyTo: input.replyTo } : {}) };
    this.store.insertMessage(m);
    if (to.value.sessionId) {
      const d = this.sessions.deliver(to.value.sessionId, formatDelivery({ messageId: m.messageId, fromTitle: this.senderLabel(from, to.value.workspaceId), text: m.text, replyTo: m.replyTo }));
      if (d.ok) { this.store.markDelivered(m.messageId); m.delivered = true; }
    }
    this.emit("message", m);
    return succeed(m);
  }

  /**
   * `ask` bloqueante: entrega o prompt no destino e espera ele assentar,
   * devolvendo a "última tela" como resposta. Para shell cru isso traz a saída do comando; para
   * agente de IA, a resposta dele. Timeout/quiescência dependem do tipo (agente anima enquanto pensa).
   */
  async ask(fromNodeId: string, input: { to: string; text: string; timeoutMs?: number; noWait?: boolean; replyTo?: string }, opts: { bypassConnection?: boolean } = {}): Promise<Result<{ messageId: string; delivered: boolean; response: string; timedOut: boolean; agentType: string }>> {
    const from = this.store.getNode(fromNodeId);
    if (!from) return fail("NOT_FOUND", "nó de origem não encontrado");
    const to = this.resolveCrossTarget(from.workspaceId, fromNodeId, input.to);
    if (!to.ok) return to;
    if (to.value.kind !== "terminal") return fail("INVALID", "o destino precisa ser um terminal");
    const allowed = opts.bypassConnection && fromNodeId !== to.value.nodeId ? succeed(undefined) : canMessage(this.store.listNodeConnections(fromNodeId), fromNodeId, to.value.nodeId); // #70 mesma banda dispensa a ligação
    if (!allowed.ok) return allowed;
    const kind = this.kindOfNode(to.value);
    const m: Message = { messageId: newId(), workspaceId: to.value.workspaceId, fromNodeId, toNodeId: to.value.nodeId, text: input.text, createdAt: nowIso(), delivered: false, ...(input.replyTo ? { replyTo: input.replyTo } : {}) };
    this.store.insertMessage(m);
    const payload = formatDelivery({ messageId: m.messageId, fromTitle: this.senderLabel(from, to.value.workspaceId), text: m.text, replyTo: input.replyTo });
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

  /** Lê a tela atual de um terminal conectado, sem enviar nada. */
  checkPeer(fromNodeId: string, ref: string): Result<{ agentType: string; screen: string }> {
    const from = this.store.getNode(fromNodeId);
    if (!from) return fail("NOT_FOUND", "nó de origem não encontrado");
    const to = this.resolveCrossTarget(from.workspaceId, fromNodeId, ref);
    if (!to.ok) return to;
    if (to.value.kind !== "terminal") return fail("INVALID", "o destino precisa ser um terminal");
    const allowed = canMessage(this.store.listNodeConnections(fromNodeId), fromNodeId, to.value.nodeId);
    if (!allowed.ok) return allowed;
    const screen = to.value.sessionId ? this.sessions.screen(to.value.sessionId) : undefined;
    return succeed({ agentType: this.kindOfNode(to.value).agentType, screen: screen ?? "" });
  }

  inbox(nodeId: string, unreadOnly: boolean, markRead: boolean): Result<{ messages: (Message & { fromTitle: string })[] }> {
    const me = this.store.getNode(nodeId);
    if (!me) return fail("NOT_FOUND", "nó não encontrado");
    const list = this.store.listInbox(nodeId, unreadOnly).map((m) => {
      const fn = this.store.getNode(m.fromNodeId);
      const fromTitle = fn ? this.senderLabel(fn, me.workspaceId) : m.fromNodeId.slice(0, 8);
      return { ...m, fromTitle };
    });
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
    if (typeof input.color === "string") { const c = parseNodeColor(input.color); if (c === null) return fail("INVALID", `cor inválida: ${input.color} (use um nome da paleta ou #rrggbb)`); input = { ...input, color: c || null }; }
    if (node.kind === "note" && byAgent && node.locked && (input.content !== undefined || input.title !== undefined || input.filePath !== undefined)) return fail("FORBIDDEN", "nota bloqueada: agentes só podem ler");
    if (typeof input.groupId === "string") { const g = this.store.getGroup(input.groupId); if (!g || g.workspaceId !== node.workspaceId) return fail("NOT_FOUND", "grupo não encontrado neste espaço"); } // #78
    // #93 um agente NUNCA mexe no próprio isolamento, no Maestro (ganharia capacidades) nem no limite de memória: só o app.
    if (byAgent && (input.isolation !== undefined || input.maestro !== undefined || input.memLimitMb !== undefined)) return fail("FORBIDDEN", "isolamento, Maestro e limite de memória só podem ser alterados pelo app");
    if (byAgent && (input.secret !== undefined || input.secretEnv !== undefined)) return fail("FORBIDDEN", "nota secreta só pode ser configurada pelo usuário"); // agente não desmascara nem reaponta a env
    let newIso: NodeIsolation | null | undefined;
    if (input.isolation !== undefined && node.kind === "terminal") {
      if (input.isolation === null) newIso = null;
      else {
        if (!probeIsolation().available) return fail("UNSUPPORTED", probeIsolation().reason ?? "modo isolado indisponível nesta máquina");
        const v = validateIsolation(input.isolation, homedir()); if (!v.ok) return v; newIso = v.value as NodeIsolation;
      }
    }
    if (node.kind === "portal" && input.content !== undefined) { // #26 só uma URL http/https válida (ou vazia) entra no conteúdo
      const raw = parsePortal(input.content).url;
      if (raw) { const u = normalizePortalUrl(raw); if (!u.ok) return fail("INVALID", u.reason); input = { ...input, content: serializePortal({ url: u.url }) }; } else input = { ...input, content: serializePortal({ url: "" }) };
    }
    if (node.kind === "device" && input.content !== undefined) { // #73
      const raw = (() => { try { return JSON.parse(input.content) as { serial?: unknown; avd?: unknown }; } catch { return null; } })();
      if (!raw || (raw.serial !== undefined && !(typeof raw.serial === "string" && isAdbSerial(raw.serial))) || (raw.avd !== undefined && !(typeof raw.avd === "string" && isAvdName(raw.avd)))) return fail("INVALID", "serial/AVD inválido");
      input = { ...input, content: JSON.stringify(parseDeviceContent(input.content)) };
    }
    let title = input.title; let titleAuto: boolean | undefined;
    let filePath: string | undefined;
    if (node.kind === "note") {
      if (input.secret === true && node.filePath) { // virou secreta: tira o valor do disco (remove o .md gerenciado) e para de vigiar
        try { if (node.filePath.startsWith(this.notesDir(node.workspaceId))) unlinkSync(node.filePath); } catch { /* já removido */ }
        this.unwatchNote(node.filePath); this.noteMtime.delete(nodeId); filePath = "";
      }
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
      this.store.updateNode(nodeId, { title, geometry: input.geometry ? normalizeGeometry(input.geometry) : undefined, content: input.content, locked: input.locked, color: input.color, filePath, titleAuto, icon: input.icon, termTheme: input.termTheme === "system" ? null : input.termTheme, groupId: input.groupId, maestro: node.kind === "terminal" ? input.maestro : undefined, memLimitMb: node.kind === "terminal" && input.memLimitMb !== undefined ? (input.memLimitMb || null) : undefined, isolation: newIso, secret: node.kind === "note" ? input.secret : undefined, secretEnv: node.kind === "note" ? input.secretEnv : undefined });
      if (input.groupId !== undefined) this.store.pruneEmptyGroups(node.workspaceId); // #78 sair de um grupo pode esvaziá-lo
      this.store.bumpRevision(node.workspaceId, rev.value);
    });
    if (node.kind === "note" && input.content !== undefined && !this.store.getNode(nodeId)!.secret) this.writeNoteFile(this.store.getNode(nodeId)!, input.content); // nota secreta nunca vai pro disco
    else if (filePath) { try { this.noteMtime.set(nodeId, statSync(filePath).mtimeMs); } catch { /* ignorar */ } }
    if (newIso !== undefined) { this.writeNodeCaps(nodeId, null); this.respawnTerminal(nodeId); } // #93 trocar o modo zera concessões e reinicia SÓ o processo
    if (input.maestro !== undefined && input.maestro !== node.maestro) { // #29 ligar/desligar Maestro reflete JÁ no token do agente (ganha/perde maestro:conduct), sem reiniciar
      const caps = this.agentCapsFor(this.store.getNode(nodeId)!);
      for (const v of this.agentTokens.values()) if (v.nodeId === nodeId) v.capabilities = caps;
      this.saveAgentTokens();
    }
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
    console.log(`[node] delete ${node.kind} "${node.title}" [${nodeId.slice(0, 8)}] ws=${w.name}`); // rastro de exclusão (nós não somem sozinhos)
    if (node.sessionId) this.sessions.dispose(node.sessionId);
    if (node.kind === "portal") void this.portals.close(nodeId); // #26 mata o navegador do portal
    if (node.kind === "device") void this.devices.close(nodeId); // #73 solta o aparelho (e encerra o emulador que nós iniciamos)
    this.revokeAgentTokensForNode(nodeId); this.writeNodeCaps(nodeId, null); // #87
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
    const color = input.color ? parseNodeColor(input.color) : ""; if (color === null) return fail("INVALID", `cor inválida: ${input.color}`);
    const b: Band = { bandId: newId(), workspaceId, name, color, nodeIds: this.validBandNodes(workspaceId, input.nodeIds), asking: [], createdAt: nowIso() };
    this.store.insertBand(b);
    this.publish(workspaceId);
    return succeed(this.bandView(b));
  }
  patchBand(id: string, input: PatchBand): Result<Band> {
    const b = this.store.getBand(id);
    if (!b) return fail("NOT_FOUND", "banda não encontrada");
    const name = input.name?.trim();
    if (name && this.store.listBands(b.workspaceId).some((o) => o.bandId !== id && o.name.toLowerCase() === name.toLowerCase())) return fail("CONFLICT", `já existe uma banda "${name}" neste espaço`);
    const color = input.color !== undefined ? parseNodeColor(input.color) : undefined; if (color === null) return fail("INVALID", `cor inválida: ${input.color}`);
    const remove = new Set(input.removeNodeIds ?? []);
    const ids = [...new Set([...this.bandView(b).nodeIds, ...this.validBandNodes(b.workspaceId, input.addNodeIds)])].filter((n) => !remove.has(n));
    this.store.updateBand(id, { name: name || undefined, color, nodeIds: ids });
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
  /**
   * #6 — Pré-confia a pasta no Claude Code (~/.claude.json projects[cwd].hasTrustDialogAccepted=true), para o Claude recrutado
   * não abrir o diálogo "trust this folder" cujo padrão é "No, exit" — o Enter do briefing do Maestro o selecionava e a sessão SAÍA.
   * É exatamente o que o usuário faria clicando "Yes, I trust". Idempotente e não-fatal.
   */
  private ensureClaudeTrust(cwd: string): void {
    try {
      const p = join(homedir(), ".claude.json");
      const j = existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) as { projects?: Record<string, Record<string, unknown>> } : {};
      j.projects ??= {};
      const cur = j.projects[cwd] ?? {};
      if (cur["hasTrustDialogAccepted"] === true) return; // já confiável
      j.projects[cwd] = { ...cur, hasTrustDialogAccepted: true };
      writeFileSync(p, JSON.stringify(j, null, 2));
    } catch { /* não bloqueia o spawn se o json estiver indisponível/em uso */ }
  }
  /** Uma posição que NÃO sobrepõe nenhum nó existente: à direita de tudo, no topo. Simples e nunca colide (usado por agentes/CLI via autoPlace). */
  private placeFree(nodes: Node[], w: number, h: number): Node["geometry"] {
    const norm = normalizeGeometry({ x: 0, y: 0, w, h });
    if (!nodes.length) return { x: 40, y: 40, w: norm.w, h: norm.h };
    const left = Math.min(...nodes.map((n) => n.geometry.x));
    const bottom = Math.max(...nodes.map((n) => n.geometry.y + n.geometry.h));
    return { x: left, y: bottom + 40, w: norm.w, h: norm.h }; // empilha de cima para baixo (mesma coluna à esquerda)
  }
  // (O arranjo em árvore automático foi removido: atropelava o layout manual do usuário. A árvore fica sob comando no app — "Organizar em árvore".)
  private freeSpotNear(anchor: Node, nodes: Node[], w: number, h: number): Node["geometry"] {
    const x = anchor.geometry.x; // mesma coluna do condutor
    for (let k = 1; k < 80; k++) {
      const y = anchor.geometry.y + k * (anchor.geometry.h + 30); // empilha para baixo
      if (!nodes.some((n) => x < n.geometry.x + n.geometry.w && x + w > n.geometry.x && y < n.geometry.y + n.geometry.h && y + h > n.geometry.y)) return { x, y, w, h };
    }
    return { x, y: anchor.geometry.y + 80 * (anchor.geometry.h + 30), w, h };
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
    // `--persist` → recrutado PERSISTENTE (tmux): sobrevive a fechar/reabrir o app, como o condutor. Sem tmux, ignora (não falha o recruit).
    const persist = !!input.persistent && SessionManager.tmuxAvailable();
    const made = this.createNode(w.workspaceId, { expectedRevision: w.revision, kind: "terminal", title: input.name ?? preset?.label ?? "Agente", geometry, command, args, ...(input.cwd ? { cwd: input.cwd } : {}), ...(roleId ? { roleId } : {}), ...((input.color ?? (preset?.color && parseNodeColor(preset.color))) ? { color: input.color ?? preset!.color } : {}), ...(preset?.icon ? { icon: preset.icon } : {}), ...(preset && preset.theme !== "system" ? { termTheme: preset.theme } : {}), ...(persist ? { persistent: true } : {}) });
    if (!made.ok) return made;
    const node = made.value.node;
    const link = this.createConnection(w.workspaceId, { expectedRevision: this.store.getWorkspace(w.workspaceId)!.revision, sourceNodeId: maestro.nodeId, targetNodeId: node.nodeId });
    if (!link.ok) return link;
    // o recrutado já nasceu posicionado por freeSpotNear (abaixo do Maestro, sem sobrepor). NÃO re-arranjamos a árvore
    // automaticamente: isso atropelava o layout manual do usuário. A árvore fica sob comando ("Organizar em árvore").
    let bandId: string | undefined;
    if (input.band) {
      let b = this.findBand(w.workspaceId, input.band);
      if (!b.ok && b.error.code === "NOT_FOUND") b = this.createBand(w.workspaceId, { name: input.band });
      if (!b.ok) return b;
      const pb = this.patchBand(b.value.bandId, { addNodeIds: [node.nodeId] }); // só o recrutado entra na banda — o Maestro conduz, não é membro (senão agrupar a banda esconderia o condutor)
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
  private interruptNode(node: Node): boolean {
    if (node.kind !== "terminal" || !node.sessionId) return false;
    return this.sessions.interrupt(node.sessionId, this.kindOfNode(node).isAgent).ok;
  }
  /** Interrompe (Esc nos agentes / Ctrl-C em shell, SEM matar) um recrutado — ou TODOS os ligados ao condutor (parada de emergência). */
  /** #74 — uma operação no fichário (agente/CLI/UI). Lê-modifica-grava no runtime (síncrono, sem corrida) e devolve o fichário. */
  binderOp(nodeId: string, input: BinderOp, byAgent = false): Result<BinderView> {
    const node = this.store.getNode(nodeId);
    if (!node || node.kind !== "binder") return fail("NOT_FOUND", "fichário não encontrado");
    let b = parseBinder(node.content);
    const page = input.page !== undefined ? binderFindPage(b, input.page) : undefined;
    if (input.page !== undefined && !page) return fail("NOT_FOUND", `página não encontrada: ${input.page}`);
    const need = () => (page ? null : fail("INVALID", "informe a página (id, posição ou título)"));
    const color = (): Result<string> => { const c = parseNodeColor(input.color ?? ""); return c === null ? fail("INVALID", `cor inválida: ${input.color} (use um nome da paleta ou #rrggbb)`) : succeed(c); };
    switch (input.op) {
      case "get": break;
      case "add": { const c = color(); if (!c.ok) return c; b = binderAddPage(b, { ...(input.title ? { title: input.title } : {}), content: input.content ?? "", ...(c.value ? { color: c.value } : {}) }); break; }
      case "write": { const e = need(); if (e) return e; b = binderPatchPage(b, page!.id, { content: input.content ?? "" }); break; }
      case "append": { const e = need(); if (e) return e; b = binderPatchPage(b, page!.id, { content: page!.content ? `${page!.content.replace(/\n*$/, "")}\n${input.content ?? ""}` : (input.content ?? "") }); break; }
      case "rename": { const e = need(); if (e) return e; if (!input.title?.trim()) return fail("INVALID", "informe o novo título"); b = binderPatchPage(b, page!.id, { title: input.title.trim() }); break; }
      case "color": { const c = color(); if (!c.ok) return c; b = page ? binderPatchPage(b, page.id, { color: c.value }) : { ...b, color: c.value }; break; }
      case "delete": { const e = need(); if (e) return e; const nb = binderDeletePage(b, page!.id); if (!nb) return fail("INVALID", "o fichário precisa de pelo menos uma página"); b = nb; break; }
      case "open": { const e = need(); if (e) return e; b = binderSetActive(b, page!.id); break; }
      case "front": { const e = need(); if (e) return e; b = binderBringToFront(b, page!.id); break; }
      case "move": { const e = need(); if (e) return e; if (!input.to) return fail("INVALID", "informe a posição (to, 1-based)"); b = binderMovePage(b, page!.id, input.to - 1); break; }
    }
    if (input.op !== "get") {
      const w = this.store.getWorkspace(node.workspaceId)!;
      const r = this.patchNode(nodeId, { expectedRevision: w.revision, content: serializeBinder(b) }, byAgent);
      if (!r.ok) return r;
    }
    return succeed({ nodeId, title: node.title, color: b.color, active: b.active, pages: b.pages.map((p) => ({ id: p.id, title: p.title, ...(p.color ? { color: p.color } : {}), content: p.content })) });
  }
  maestroInterrupt(maestroId: string, input: { ref?: string; all?: boolean; notify?: boolean }): Result<{ interrupted: number; titles: string[] }> {
    const m = this.requireMaestro(maestroId); if (!m.ok) return m;
    let targets: Node[];
    if (input.all) {
      const ids = this.store.listNodeConnections(m.value.nodeId).map((c) => (c.sourceNodeId === m.value.nodeId ? c.targetNodeId : c.sourceNodeId));
      targets = [...new Set(ids)].map((id) => this.store.getNode(id)).filter((n): n is Node => !!n && n.kind === "terminal" && n.workspaceId === m.value.workspaceId);
    } else {
      if (!input.ref) return fail("INVALID", "informe um nó ou use all");
      const t = this.maestroTarget(m.value, input.ref); if (!t.ok) return t; targets = [t.value];
    }
    const titles: string[] = [];
    for (const n of targets) if (this.interruptNode(n)) titles.push(n.title);
    if (input.notify && titles.length && m.value.sessionId) // avisa o condutor pra realinhar
      this.sessions.deliver(m.value.sessionId, `# [MessAI] Parada de emergência: o usuário interrompeu ${titles.length} recrutado(s) — ${titles.join(", ")}. Reavalie o que estavam fazendo antes de continuar.\r`);
    return succeed({ interrupted: titles.length, titles });
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