import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import websocket from "@fastify/websocket";
import { Value } from "@sinclair/typebox/value";
import type { WebSocket } from "ws";
import {
  BUILD_VERSION, PROTOCOL_VERSION, DeviceAct, PortalAct, GitCommitInput, GitBranchInput, GitCheckoutInput, GitMergeInput, GitPushInput, SendMessage, Ask, CreateConnection, CreateDrawing, CreateNode, CreateWorkspace, DeleteNode, PatchNode, PatchWorkspace, ApplyLayout, WsClientMessage,
  type Capabilities, type WsServerMessage, type ApiError,
 CreateFolder, PatchFolder, CreateAttachment, SendChat, CreateRole, PatchRole, PatchConnection, PatchDrawing, GroupDrawings, CreateFloor, LandFloor, PutFloorHooks, RunFloorHookInput, StopFloorHookInput, PutFloorExcludes, CreateFloorPrInput, PatchFloorPrInput, PutGitHostsInput, PutEnvVarsInput, PreviewWorkspaceImportInput, ImportWorkspaceInput, DuplicateWorkspaceInput, SendNotifyInput, CreateRoutineInput, PatchRoutineInput, FsOp, PatchRuntimeSettings, PutPresets, CreateSkill, PatchSkill, CreateApproval, DecideApproval, BackupInput, RestoreInput, MoveDataInput, ResetInput, CreateNodeGroup, PatchNodeGroup, SaveScore, PatchScore, PlaceScore, CreateBand, PatchBand, AskBand, MaestroRecruit, MaestroTarget, MaestroAssign, MaestroInterrupt, ExportAttachment, PutInstructions, SyncInstructions, KillProcInput, IssueAgentTokenInput, type PresetInput, type Preset } from "@messai/contracts";
import type { Result } from "@messai/domain";
import { newId, type Config } from "./config.js";
import type { WorkspaceService } from "./service.js";
import { SessionManager } from "./sessions.js";
import { DEFAULT_PRESET_IDS } from "./presets.js";
import { whichOnPath } from "./providers.js";
import { createReadStream } from "node:fs";
import { routeAccess } from "./authz.js";

type Caller = NonNullable<ReturnType<WorkspaceService["authenticateToken"]>>;
const isAgent = (req: unknown): boolean => (req as { auth?: Caller | null }).auth?.kind === "agent";

const STATUS: Record<ApiError["code"], number> = {
  UNAUTHORIZED: 401, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409, INVALID: 400,
  UNSUPPORTED: 501, LEASE_HELD: 423, SESSION_NOT_RUNNING: 409, INTERNAL: 500,
};

function send<T>(reply: FastifyReply, r: Result<T>, okStatus = 200) {
  if (r.ok) return reply.status(okStatus).send(r.value);
  return reply.status(STATUS[r.error.code]).send({ error: r.error });
}

export type DataOp = { kind: "restore"; path: string } | { kind: "reset" } | { kind: "move"; dir: string };
export function buildServer(cfg: Config, svc: WorkspaceService, opts: { unix: boolean; onShutdown?: (killAgents: boolean) => void; onDataOp?: (op: DataOp) => void }): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 40 * 1024 * 1024 });

  // Autenticação: token Bearer (ou ?token= para o WS do navegador). Origem só loopback/file.
  // #87 [MESS-02]: o token mestre é do desktop; cada terminal tem credencial própria com capacidades e escopo.
  app.decorateRequest("auth", null);
  app.addHook("onRequest", async (req, reply) => {
    const origin = req.headers.origin;
    if (origin && !/^(https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?|file:\/\/|null)$/.test(origin) && !origin.startsWith("app://")) {
      return reply.status(403).send({ error: { code: "FORBIDDEN", message: "origem não permitida" } });
    }
    const auth = req.headers.authorization;
    const q = (req.query as Record<string, string | undefined>)["token"];
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : q;
    const who = svc.authenticateToken(token);
    if (!who) return reply.status(401).send({ error: { code: "UNAUTHORIZED", message: "token inválido" } });
    (req as unknown as { auth: Caller }).auth = who;
    if (who.kind === "desktop") return;
    const forbid = (message: string) => reply.status(403).send({ error: { code: "FORBIDDEN", message } });
    const access = routeAccess(req.method, req.routeOptions.url);
    if (access.desktopOnly) return forbid("rota reservada ao app (credencial de agente não autorizada)");
    if (!who.capabilities.has(access.cap)) return forbid(`credencial de agente sem a capacidade "${access.cap}"`);
    if (!access.scope) return;
    const id = (req.params as Record<string, string | undefined>)["id"] ?? "";
    const myGround = svc.groundOf(who.workspaceId);
    const inFamily = (wsId: string | undefined) => !!wsId && !!myGround && svc.groundOf(wsId) === myGround;
    switch (access.scope) {
      case "self": if (id !== who.nodeId) return forbid("um agente só age em nome do próprio nó"); return;
      case "ws": if (!inFamily(id)) return forbid("espaço fora do escopo da credencial"); return;
      case "floor": if (!inFamily(id) || !svc.isFloor(id)) return forbid("só andares do seu térreo; o térreo é gerido pelo app"); return;
      case "node": if (!inFamily(svc.nodeWorkspaceId(id))) return forbid("nó fora do escopo da credencial"); return;
      case "session": if (!inFamily(svc.sessionWorkspaceId(id))) return forbid("sessão fora do escopo da credencial"); return;
    }
  });
  // #87 bandas: agente pergunta/transmite só em nome de si mesmo (o corpo não existe no onRequest)
  app.addHook("preHandler", async (req, reply) => {
    const who = (req as unknown as { auth: Caller | null }).auth;
    if (!who || who.kind !== "agent") return;
    const url = req.routeOptions.url;
    if (req.method === "POST" && (url === "/v1/bands/:id/ask" || url === "/v1/bands/:id/broadcast")) {
      const from = (req.body as { fromNodeId?: string } | undefined)?.fromNodeId;
      if (from !== who.nodeId) return reply.status(403).send({ error: { code: "FORBIDDEN", message: "um agente só pergunta à banda em nome do próprio nó" } });
    }
    // #73 abrir o scrcpy é ação do humano (abre uma janela nativa no host) — agente não pode.
    if (req.method === "POST" && url === "/v1/devices/:id/act" && (req.body as { action?: string } | undefined)?.action === "scrcpy") {
      return reply.status(403).send({ error: { code: "FORBIDDEN", message: "só o usuário abre o scrcpy" } });
    }
    // #93 agente ISOLADO não cria processos fora do sandbox: nada de terminal novo (nem por cópia ou partitura).
    if (svc.isNodeIsolated(who.nodeId)) {
      const nope = (m: string) => reply.status(403).send({ error: { code: "FORBIDDEN", message: `${m} — um agente isolado não cria terminais (escaparia do sandbox). Peça ao usuário.` } });
      const id = (req.params as Record<string, string | undefined>)["id"] ?? "";
      if (req.method === "POST" && url === "/v1/workspaces/:id/nodes" && (req.body as { kind?: string } | undefined)?.kind === "terminal") return nope("criar terminal");
      if (req.method === "POST" && url === "/v1/nodes/:id/duplicate" && svc.nodeKindOf(id) === "terminal") return nope("duplicar terminal");
      if (req.method === "POST" && url === "/v1/workspaces/:id/scores/:scoreId/place") return nope("colocar partitura");
    }
  });

  // #93 — modo isolado: suporte nesta máquina e pedidos de aprovação (o agente pede; só o app lista e decide)
  app.get("/v1/isolation", async () => svc.isolationSupport());
  app.post("/v1/approvals", async (req, reply) => {
    const who = (req as unknown as { auth: Caller | null }).auth;
    if (!who || who.kind !== "agent") return reply.status(403).send({ error: { code: "FORBIDDEN", message: "só um terminal (credencial de agente) pede aprovação" } });
    const b = body<CreateApproval>(CreateApproval, req.body); if ("code" in b) return invalid(reply, b);
    return send(reply, svc.requestApproval(who.nodeId, b), 201);
  });
  app.get("/v1/approvals", async (req) => svc.listApprovals((req.query as { status?: string }).status));
  app.get<{ Params: { id: string } }>("/v1/approvals/:id", async (req, reply) => {
    const r = svc.getApproval(req.params.id); if (!r.ok) return send(reply, r);
    const who = (req as unknown as { auth: Caller | null }).auth;
    if (who?.kind === "agent" && r.value.nodeId !== who.nodeId) return reply.status(403).send({ error: { code: "FORBIDDEN", message: "pedido de outro terminal" } });
    return send(reply, r);
  });
  app.post<{ Params: { id: string } }>("/v1/approvals/:id/decide", async (req, reply) => { const b = body<DecideApproval>(DecideApproval, req.body); if ("code" in b) return invalid(reply, b); return send(reply, svc.decideApproval(req.params.id, b.approve)); });
  app.get("/v1/health", async () => ({ ok: true, protocolVersion: PROTOCOL_VERSION, buildVersion: BUILD_VERSION, machineId: cfg.machineId }));
  // Tela de encerramento do app: o que está rodando agora (terminais/agentes).
  app.get("/v1/running", async () => ({ sessions: svc.sessions.runningList() }));
  // Companheiro (#66): status do modelo local e resumo sob demanda de um nó.
  app.get("/v1/companion", async () => svc.companion.probe());
  app.post<{ Body?: { nodeId?: string } }>("/v1/companion/summarize", async (req, reply) => {
    const nodeId = req.body?.nodeId; if (!nodeId) return reply.status(400).send({ error: { code: "INVALID", message: "nodeId obrigatório" } });
    return send(reply, await svc.summarizeNode(nodeId));
  });
  // Encerrar o runtime. killAgents=true mata também as sessões tmux (agentes); false mantém (reanexa no próximo boot).
  app.post<{ Body?: { killAgents?: boolean } }>("/v1/shutdown", async (req, reply) => {
    if (!opts.onShutdown) return reply.status(400).send({ error: { code: "INVALID", message: "shutdown indisponível neste servidor" } });
    const killAgents = !!(req.body && req.body.killAgents);
    reply.status(202).send({ ok: true, killAgents });
    setTimeout(() => opts.onShutdown!(killAgents), 50); // responde antes de sair
  });
  app.get("/v1/capabilities", async (): Promise<Capabilities> => ({
    protocolVersion: PROTOCOL_VERSION, machineId: cfg.machineId,
    features: ["workspaces", "folders", "sidebar", "files", "attachments", "chat", "roles", "notes.file", "notes.lock", "connections.style", "floors", "nodes.tree", "search.fts5", ...(SessionManager.tmuxAvailable() ? ["terminal.tmux"] : []), "nodes.terminal", "nodes.note", "connections", "messages", "drawings", "nodes.text", "terminal.lease", "terminal.snapshot", opts.unix ? "agent.socket" : "client.http"],
  }));
  const onPath = (cmd: string): boolean => whichOnPath(cmd) !== null;
  app.get("/v1/agent-usage", async () => svc.agentUsage());
  // #56 — presets editáveis/persistidos; `available` = comando no PATH; `builtin` = veio dos padrões (pode ser editado, e "Restaurar padrões" volta).
  const decorate = (list: PresetInput[]): Preset[] => list.map((p) => ({ ...p, available: onPath(p.command), builtin: DEFAULT_PRESET_IDS.has(p.id) }));
  app.get("/v1/presets", async () => decorate(svc.presetDefs()));
  app.put("/v1/presets", async (req, reply) => { const b = body<PutPresets>(PutPresets, req.body); if ("code" in b) return invalid(reply, b); const r = svc.putPresets(b.presets); return r.ok ? decorate(r.value) : send(reply, r); });
  app.post("/v1/presets/reset", async () => decorate(svc.resetPresets()));
  app.get("/v1/machine", async () => ({ machineId: cfg.machineId, name: cfg.machineName, platform: cfg.platform, protocolVersion: PROTOCOL_VERSION }));

  const body = <T>(schema: Parameters<typeof Value.Check>[0], v: unknown): T | ApiError =>
    Value.Check(schema, v) ? (v as T) : { code: "INVALID", message: [...Value.Errors(schema, v)].map((e) => `${e.path} ${e.message}`).join("; ") };
  const invalid = (reply: FastifyReply, e: ApiError) => reply.status(400).send({ error: e });

  app.get("/v1/workspaces", async () => svc.listWorkspaces());
  app.post("/v1/workspaces", async (req, reply) => {
    const b = body<CreateWorkspace>(CreateWorkspace, req.body); if ("code" in b) return invalid(reply, b);
    return send(reply, svc.createWorkspace(b), 201);
  });
  app.get<{ Params: { id: string } }>("/v1/workspaces/:id", async (req, reply) => {
    const s = svc.snapshot(req.params.id);
    return s ? s : reply.status(404).send({ error: { code: "NOT_FOUND", message: "espaço não encontrado" } });
  });
  app.patch<{ Params: { id: string } }>("/v1/workspaces/:id", async (req, reply) => {
    const b = body<PatchWorkspace>(PatchWorkspace, req.body); if ("code" in b) return invalid(reply, b);
    return send(reply, svc.patchWorkspace(req.params.id, b));
  });
  app.delete<{ Params: { id: string }; Querystring: { deleteBranch?: string } }>("/v1/workspaces/:id", async (req, reply) => send(reply, svc.deleteWorkspace(req.params.id, { deleteBranch: req.query.deleteBranch === "1" }), 204));
  // #83 — Exportar/importar espaço (.messai) e duplicar
  app.get<{ Params: { id: string } }>("/v1/workspaces/:id/export", async (req, reply) => send(reply, svc.exportWorkspace(req.params.id)));
  app.post("/v1/workspaces/import/preview", async (req, reply) => {
    const b = body<PreviewWorkspaceImportInput>(PreviewWorkspaceImportInput, req.body); if ("code" in b) return invalid(reply, b);
    return send(reply, svc.previewWorkspaceImport(b.bundle));
  });
  app.post("/v1/workspaces/import", async (req, reply) => {
    const b = body<ImportWorkspaceInput>(ImportWorkspaceInput, req.body); if ("code" in b) return invalid(reply, b);
    return send(reply, svc.importWorkspace(b), 201);
  });
  app.post<{ Params: { id: string } }>("/v1/workspaces/:id/duplicate", async (req, reply) => {
    const b = body<DuplicateWorkspaceInput>(DuplicateWorkspaceInput, req.body ?? {}); if ("code" in b) return invalid(reply, b);
    return send(reply, svc.duplicateWorkspace(req.params.id, b), 201);
  });
  // #84 — Descarregar/recarregar espaços e terminais (poupar CPU/RAM)
  app.post<{ Params: { id: string } }>("/v1/workspaces/:id/unload", async (req, reply) => send(reply, svc.unloadWorkspace(req.params.id)));
  app.post<{ Params: { id: string } }>("/v1/workspaces/:id/reload", async (req, reply) => send(reply, svc.reloadWorkspace(req.params.id)));

  // #76 — arquivos de instrução do projeto (CLAUDE.md / AGENTS.md)
  app.get<{ Params: { id: string } }>("/v1/workspaces/:id/instructions", async (req, reply) => send(reply, svc.getInstructions(req.params.id)));
  app.put<{ Params: { id: string } }>("/v1/workspaces/:id/instructions", async (req, reply) => { const b = body<PutInstructions>(PutInstructions, req.body); if ("code" in b) return invalid(reply, b); return send(reply, svc.putInstructions(req.params.id, b)); });
  app.post<{ Params: { id: string } }>("/v1/workspaces/:id/instructions/sync", async (req, reply) => { const b = body<SyncInstructions>(SyncInstructions, req.body); if ("code" in b) return invalid(reply, b); return send(reply, svc.syncInstructions(req.params.id, b)); });
  // árvore de arquivos
  app.get<{ Params: { id: string }; Querystring: { path?: string } }>("/v1/workspaces/:id/tree", async (req, reply) => send(reply, await svc.listTree(req.params.id, req.query.path ?? "")));
  app.get<{ Params: { id: string }; Querystring: { path?: string } }>("/v1/workspaces/:id/file", async (req, reply) => send(reply, svc.readFile(req.params.id, req.query.path ?? "")));
  app.post<{ Params: { id: string } }>("/v1/workspaces/:id/fs", async (req, reply) => { const b = body<FsOp>(FsOp, req.body); if ("code" in b) return invalid(reply, b); return send(reply, svc.fsOp(req.params.id, b)); });
  // #73 dispositivos Android (adb): lista, estado, ações estruturadas, árvore de UI, captura e apps
  app.get("/v1/devices", async (_req, reply) => send(reply, await svc.deviceList()));
  app.get<{ Params: { id: string } }>("/v1/devices/:id", async (req, reply) => send(reply, svc.deviceState(req.params.id)));
  app.post<{ Params: { id: string } }>("/v1/devices/:id/act", async (req, reply) => { const b = body<DeviceAct>(DeviceAct, req.body); if ("code" in b) return invalid(reply, b); return send(reply, await svc.deviceAct(req.params.id, b)); });
  app.get<{ Params: { id: string } }>("/v1/devices/:id/ui", async (req, reply) => send(reply, await svc.deviceUi(req.params.id)));
  app.get<{ Params: { id: string } }>("/v1/devices/:id/screenshot", async (req, reply) => send(reply, await svc.deviceScreenshot(req.params.id)));
  app.get<{ Params: { id: string } }>("/v1/devices/:id/apps", async (req, reply) => send(reply, await svc.deviceApps(req.params.id)));
  // #26 portais (navegador embutido): estado, ações, snapshot e captura
  app.get<{ Params: { id: string } }>("/v1/portals/:id", async (req, reply) => send(reply, svc.portalState(req.params.id)));
  app.post<{ Params: { id: string } }>("/v1/portals/:id/act", async (req, reply) => { const b = body<PortalAct>(PortalAct, req.body); if ("code" in b) return invalid(reply, b); return send(reply, await svc.portalAct(req.params.id, b)); });
  app.get<{ Params: { id: string } }>("/v1/portals/:id/snapshot", async (req, reply) => send(reply, await svc.portalSnapshot(req.params.id)));
  app.get<{ Params: { id: string } }>("/v1/portals/:id/screenshot", async (req, reply) => send(reply, await svc.portalScreenshot(req.params.id)));
  // #30 git do espaço
  app.get<{ Params: { id: string } }>("/v1/workspaces/:id/git", async (req, reply) => send(reply, await svc.gitInfo(req.params.id)));
  app.get<{ Params: { id: string }; Querystring: { limit?: string; path?: string } }>("/v1/workspaces/:id/git/log", async (req, reply) => send(reply, await svc.gitLog(req.params.id, Number(req.query.limit ?? 50) || 50, req.query.path)));
  app.get<{ Params: { id: string }; Querystring: { path?: string } }>("/v1/workspaces/:id/git/diff", async (req, reply) => send(reply, await svc.gitDiff(req.params.id, req.query.path)));
  app.post<{ Params: { id: string } }>("/v1/workspaces/:id/git/commit", async (req, reply) => { const b = body<GitCommitInput>(GitCommitInput, req.body); if ("code" in b) return invalid(reply, b); return send(reply, await svc.gitCommit(req.params.id, b)); });
  app.post<{ Params: { id: string } }>("/v1/workspaces/:id/git/branch", async (req, reply) => { const b = body<GitBranchInput>(GitBranchInput, req.body); if ("code" in b) return invalid(reply, b); return send(reply, await svc.gitBranch(req.params.id, b)); });
  app.post<{ Params: { id: string } }>("/v1/workspaces/:id/git/checkout", async (req, reply) => { const b = body<GitCheckoutInput>(GitCheckoutInput, req.body); if ("code" in b) return invalid(reply, b); return send(reply, await svc.gitCheckout(req.params.id, b)); });
  app.post<{ Params: { id: string } }>("/v1/workspaces/:id/git/merge", async (req, reply) => { const b = body<GitMergeInput>(GitMergeInput, req.body ?? {}); if ("code" in b) return invalid(reply, b); return send(reply, await svc.gitMerge(req.params.id, b)); });
  app.post<{ Params: { id: string } }>("/v1/workspaces/:id/git/pull", async (req, reply) => send(reply, await svc.gitPull(req.params.id)));
  app.post<{ Params: { id: string } }>("/v1/workspaces/:id/git/push", async (req, reply) => { const b = body<GitPushInput>(GitPushInput, req.body ?? {}); if ("code" in b) return invalid(reply, b); return send(reply, await svc.gitPush(req.params.id, b)); });
  app.get<{ Params: { id: string }; Querystring: { q?: string; content?: string } }>("/v1/workspaces/:id/search", async (req, reply) => send(reply, await svc.searchFiles(req.params.id, req.query.q ?? "", req.query.content === "1")));

  // andares (floors)
  app.get<{ Params: { id: string } }>("/v1/workspaces/:id/floors", async (req, reply) => send(reply, svc.listFloors(req.params.id)));
  app.post<{ Params: { id: string } }>("/v1/workspaces/:id/floors", async (req, reply) => {
    const b = body<CreateFloor>(CreateFloor, req.body); if ("code" in b) return invalid(reply, b);
    return send(reply, await svc.createFloor(req.params.id, b), 201);
  });
  app.post<{ Params: { id: string } }>("/v1/workspaces/:id/floors/cancel", async (req, reply) => send(reply, svc.cancelFloorCopy(req.params.id)));
  app.get<{ Params: { id: string } }>("/v1/workspaces/:id/floor-copy-info", async (req, reply) => send(reply, svc.getFloorCopyInfo(req.params.id)));
  app.put<{ Params: { id: string } }>("/v1/workspaces/:id/floor-copy-info", async (req, reply) => {
    const b = body<PutFloorExcludes>(PutFloorExcludes, req.body); if ("code" in b) return invalid(reply, b);
    return send(reply, svc.putFloorExcludes(req.params.id, b));
  });
  app.post<{ Params: { id: string } }>("/v1/workspaces/:id/land", async (req, reply) => {
    const b = body<LandFloor>(LandFloor, req.body ?? {}); if ("code" in b) return invalid(reply, b);
    return send(reply, svc.landFloor(req.params.id, b));
  });
  // #75 — hooks de andar (setup / run / teardown, rodar/parar, logs ao vivo)
  app.get<{ Params: { id: string } }>("/v1/workspaces/:id/hooks", async (req, reply) => send(reply, svc.getFloorHooks(req.params.id)));
  app.put<{ Params: { id: string } }>("/v1/workspaces/:id/hooks", async (req, reply) => {
    const b = body<PutFloorHooks>(PutFloorHooks, req.body); if ("code" in b) return invalid(reply, b);
    return send(reply, svc.putFloorHooks(req.params.id, b));
  });
  app.post<{ Params: { id: string } }>("/v1/workspaces/:id/hooks/run", async (req, reply) => {
    const b = body<RunFloorHookInput>(RunFloorHookInput, req.body ?? {}); if ("code" in b) return invalid(reply, b);
    return send(reply, await svc.runFloorHooks(req.params.id, b));
  });
  app.post<{ Params: { id: string } }>("/v1/workspaces/:id/hooks/stop", async (req, reply) => {
    const b = body<StopFloorHookInput>(StopFloorHookInput, req.body ?? {}); if ("code" in b) return invalid(reply, b);
    return send(reply, svc.stopFloorHooks(req.params.id, b));
  });
  // #31 — Pull request nos andares (+ hosts Git configuráveis)
  app.get("/v1/git-hosts", async () => svc.getGitHosts());
  app.put("/v1/git-hosts", async (req, reply) => {
    const b = body<PutGitHostsInput>(PutGitHostsInput, req.body); if ("code" in b) return invalid(reply, b);
    return send(reply, svc.putGitHosts(b));
  });
  app.get<{ Params: { id: string } }>("/v1/workspaces/:id/pr", async (req, reply) => send(reply, svc.getFloorPr(req.params.id)));
  app.post<{ Params: { id: string } }>("/v1/workspaces/:id/pr", async (req, reply) => {
    const b = body<CreateFloorPrInput>(CreateFloorPrInput, req.body); if ("code" in b) return invalid(reply, b);
    return send(reply, svc.createFloorPr(req.params.id, b), 201);
  });
  app.patch<{ Params: { id: string } }>("/v1/workspaces/:id/pr", async (req, reply) => {
    const b = body<PatchFloorPrInput>(PatchFloorPrInput, req.body); if ("code" in b) return invalid(reply, b);
    return send(reply, svc.patchFloorPr(req.params.id, b));
  });

  // papéis (responsabilidades)
  // #41 — busca de texto FTS5 (notas/textos e chats); kinds=note,chat; limit ≤ 200
  app.get<{ Querystring: { q?: string; workspaceId?: string; kinds?: string; limit?: string } }>("/v1/find", async (req) => {
    const kinds = (req.query.kinds ?? "").split(",").filter((k): k is "note" | "chat" | "node" => k === "note" || k === "chat" || k === "node");
    return svc.findText(req.query.q ?? "", { workspaceId: req.query.workspaceId || undefined, kinds: kinds.length ? kinds : undefined, limit: req.query.limit ? Number(req.query.limit) : undefined });
  });
  // #69 — atenção global (quem espera você) e "já vi"
  app.get("/v1/attention", async () => svc.attention());
  app.post<{ Params: { id: string } }>("/v1/nodes/:id/seen", async (req, reply) => send(reply, svc.markSeen(req.params.id)));
  // nota secreta: só o humano (app) revela o valor; agente nunca.
  app.get<{ Params: { id: string } }>("/v1/nodes/:id/reveal", async (req, reply) => { if (opts.unix || isAgent(req)) return reply.status(403).send({ error: { code: "FORBIDDEN", message: "o valor de uma nota secreta não é exposto a agentes" } }); return send(reply, svc.revealSecret(req.params.id)); });
  // #85 — notificações do SO + mess notify
  app.get("/v1/notifications", async () => svc.listNotifications());
  app.post("/v1/notify", async (req, reply) => {
    const b = body<SendNotifyInput>(SendNotifyInput, req.body); if ("code" in b) return invalid(reply, b);
    return send(reply, svc.sendNotify(b), 201);
  });
  // #27 — rotinas agendadas e recorrentes
  app.get<{ Querystring: { workspaceId?: string } }>("/v1/routines", async (req) => svc.listRoutines(req.query.workspaceId));
  app.get<{ Params: { id: string } }>("/v1/workspaces/:id/routines", async (req) => svc.listRoutines(req.params.id));
  app.post<{ Params: { id: string } }>("/v1/workspaces/:id/routines", async (req, reply) => {
    const b = body<CreateRoutineInput>(CreateRoutineInput, req.body); if ("code" in b) return invalid(reply, b);
    return send(reply, svc.createRoutine(req.params.id, b), 201);
  });
  app.patch<{ Params: { id: string } }>("/v1/routines/:id", async (req, reply) => {
    const b = body<PatchRoutineInput>(PatchRoutineInput, req.body); if ("code" in b) return invalid(reply, b);
    return send(reply, svc.patchRoutine(req.params.id, b));
  });
  app.delete<{ Params: { id: string } }>("/v1/routines/:id", async (req, reply) => send(reply, svc.deleteRoutine(req.params.id), 204));
  app.post<{ Params: { id: string } }>("/v1/routines/:id/run", async (req, reply) => send(reply, await svc.runRoutine(req.params.id)));
  // #62 — dados: estatísticas, backups, restauração/reset/mover (estas três respondem 202 e o runtime sai; o app sobe outro)
  app.get("/v1/data", async () => svc.dataInfo());
  app.post("/v1/data/backup", async (req, reply) => { const b = body<BackupInput>(BackupInput, req.body ?? {}); if ("code" in b) return invalid(reply, b); return send(reply, svc.createBackup(b.dir), 201); });
  app.delete<{ Params: { name: string } }>("/v1/data/backups/:name", async (req, reply) => send(reply, svc.deleteBackup(req.params.name), 204));
  const dataOp = (op: DataOp, reply: FastifyReply) => {
    if (!opts.onDataOp) return reply.status(400).send({ error: { code: "INVALID", message: "operação indisponível neste servidor" } });
    reply.status(202).send({ ok: true, op: op.kind });
    setTimeout(() => opts.onDataOp!(op), 50); // responde antes de parar tudo
  };
  app.post("/v1/data/restore", async (req, reply) => { const b = body<RestoreInput>(RestoreInput, req.body); if ("code" in b) return invalid(reply, b); const v = svc.validateRestore(b.path); if (!v.ok) return send(reply, v); return dataOp({ kind: "restore", path: b.path }, reply); });
  app.post("/v1/data/move", async (req, reply) => { const b = body<MoveDataInput>(MoveDataInput, req.body); if ("code" in b) return invalid(reply, b); const v = svc.validateMove(b.dir); if (!v.ok) return send(reply, v); return dataOp({ kind: "move", dir: b.dir }, reply); });
  app.post("/v1/data/reset", async (req, reply) => { const b = body<ResetInput>(ResetInput, req.body); if ("code" in b) return invalid(reply, b); return dataOp({ kind: "reset" }, reply); });
  // #55 — configurações do runtime (persistidas; valem para todos os clientes desta máquina)
  app.get("/v1/settings", async () => svc.settings());
  app.patch("/v1/settings", async (req, reply) => { const b = body<PatchRuntimeSettings>(PatchRuntimeSettings, req.body); if ("code" in b) return invalid(reply, b); return send(reply, svc.patchSettings(b)); });
  // #72 — Ambientes: variáveis de ambiente por espaço e global
  app.get("/v1/environments", async () => svc.getEnvironments());
  app.get("/v1/environments/global", async () => svc.getGlobalEnv());
  app.put("/v1/environments/global", async (req, reply) => { const b = body<PutEnvVarsInput>(PutEnvVarsInput, req.body); if ("code" in b) return invalid(reply, b); return send(reply, svc.putGlobalEnv(b)); });
  app.get<{ Params: { id: string } }>("/v1/workspaces/:id/env", async (req, reply) => send(reply, svc.getWorkspaceEnv(req.params.id)));
  app.put<{ Params: { id: string } }>("/v1/workspaces/:id/env", async (req, reply) => { const b = body<PutEnvVarsInput>(PutEnvVarsInput, req.body); if ("code" in b) return invalid(reply, b); return send(reply, svc.putWorkspaceEnv(req.params.id, b)); });
  // #57 skills · #38 provedores · #57 contas
  app.get("/v1/skills", async () => svc.listSkills());
  app.post("/v1/skills", async (req, reply) => { const b = body<CreateSkill>(CreateSkill, req.body); if ("code" in b) return invalid(reply, b); return send(reply, svc.createSkill(b), 201); });
  app.patch<{ Params: { id: string } }>("/v1/skills/:id", async (req, reply) => { const b = body<PatchSkill>(PatchSkill, req.body); if ("code" in b) return invalid(reply, b); return send(reply, svc.patchSkill(req.params.id, b)); });
  app.delete<{ Params: { id: string } }>("/v1/skills/:id", async (req, reply) => send(reply, svc.deleteSkill(req.params.id), 204));
  app.get("/v1/providers", async () => svc.providers());
  app.get("/v1/accounts", async () => svc.accounts());
  app.get("/v1/roles", async () => svc.listRoles());
  app.post("/v1/roles", async (req, reply) => { const b = body<CreateRole>(CreateRole, req.body); if ("code" in b) return invalid(reply, b); return send(reply, svc.createRole(b), 201); });
  app.patch<{ Params: { id: string } }>("/v1/roles/:id", async (req, reply) => { const b = body<PatchRole>(PatchRole, req.body); if ("code" in b) return invalid(reply, b); return send(reply, svc.patchRole(req.params.id, b)); });
  app.delete<{ Params: { id: string } }>("/v1/roles/:id", async (req, reply) => send(reply, svc.deleteRole(req.params.id), 204));
  app.post<{ Body: { dir?: string } }>("/v1/roles/discover", async (req, reply) => {
    const dir = typeof req.body?.dir === "string" ? req.body.dir : ""; if (!dir) return invalid(reply, { code: "INVALID", message: "dir obrigatório" });
    return send(reply, svc.discoverRoles(dir));
  });
  app.post<{ Params: { id: string }; Body: { dir?: string } }>("/v1/roles/:id/export", async (req, reply) => {
    const dir = typeof req.body?.dir === "string" ? req.body.dir : ""; if (!dir) return invalid(reply, { code: "INVALID", message: "dir obrigatório" });
    return send(reply, svc.exportRole(req.params.id, dir));
  });

  // chat por terminal: humano posta pelo cliente (role user), agente pelo socket (role agent)
  app.get<{ Params: { id: string }; Querystring: { thread?: string; limit?: string; since?: string } }>("/v1/nodes/:id/chat", async (req, reply) =>
    send(reply, svc.listChat(req.params.id, req.query.thread ? Number(req.query.thread) : undefined, Math.min(500, Number(req.query.limit ?? 100) || 100), req.query.since)));
  app.post<{ Params: { id: string } }>("/v1/nodes/:id/chat", async (req, reply) => {
    const b = body<SendChat>(SendChat, req.body); if ("code" in b) return invalid(reply, b);
    return send(reply, svc.postChat(req.params.id, b, opts.unix || isAgent(req) ? "agent" : "user"), 201);
  });
  app.delete<{ Params: { id: string }; Querystring: { thread?: string } }>("/v1/nodes/:id/chat", async (req, reply) =>
    send(reply, svc.clearChat(req.params.id, req.query.thread ? Number(req.query.thread) : undefined)));

  // #79 anexos do chat: bytes (com o tipo certo), excluir e copiar para uma pasta do espaço
  app.get<{ Params: { id: string } }>("/v1/chat-attachments/:id/raw", async (req, reply) => {
    const r = svc.chatAttachment(req.params.id); if (!r.ok) return send(reply, r);
    return reply.header("content-type", r.value.att.mime).header("content-disposition", `inline; filename*=UTF-8''${encodeURIComponent(r.value.att.name)}`).header("x-content-type-options", "nosniff").send(createReadStream(r.value.att.path));
  });
  app.delete<{ Params: { id: string } }>("/v1/chat-attachments/:id", async (req, reply) => send(reply, svc.deleteChatAttachment(req.params.id), 204));
  app.post<{ Params: { id: string } }>("/v1/chat-attachments/:id/export", async (req, reply) => { const b = body<ExportAttachment>(ExportAttachment, req.body); if ("code" in b) return invalid(reply, b); return send(reply, svc.exportChatAttachment(req.params.id, b), 201); });
  // compositor: arquivos do diretório do nó (#) e anexos (clipe/colar)
  app.get<{ Params: { id: string }; Querystring: { q?: string; limit?: string } }>("/v1/nodes/:id/files", async (req, reply) =>
    send(reply, svc.listFiles(req.params.id, req.query.q ?? "", Math.min(200, Number(req.query.limit ?? 50) || 50))));
  app.post<{ Params: { id: string } }>("/v1/workspaces/:id/attachments", async (req, reply) => {
    const b = body<CreateAttachment>(CreateAttachment, req.body); if ("code" in b) return invalid(reply, b);
    return send(reply, svc.saveAttachment(req.params.id, b), 201);
  });

  // barra lateral: pastas/grupos + espaços + terminais vivos
  app.get("/v1/sidebar", async () => svc.sidebar());
  app.post("/v1/folders", async (req, reply) => {
    const b = body<CreateFolder>(CreateFolder, req.body); if ("code" in b) return invalid(reply, b);
    return send(reply, svc.createFolder(b), 201);
  });
  app.patch<{ Params: { id: string } }>("/v1/folders/:id", async (req, reply) => {
    const b = body<PatchFolder>(PatchFolder, req.body); if ("code" in b) return invalid(reply, b);
    return send(reply, svc.patchFolder(req.params.id, b));
  });
  app.delete<{ Params: { id: string } }>("/v1/folders/:id", async (req, reply) => send(reply, svc.deleteFolder(req.params.id), 204));

  app.post<{ Params: { id: string } }>("/v1/workspaces/:id/nodes", async (req, reply) => {
    const b = body<CreateNode>(CreateNode, req.body); if ("code" in b) return invalid(reply, b);
    return send(reply, svc.createNode(req.params.id, b), 201);
  });
  app.patch<{ Params: { id: string } }>("/v1/nodes/:id", async (req, reply) => {
    const b = body<PatchNode>(PatchNode, req.body); if ("code" in b) return invalid(reply, b);
    return send(reply, svc.patchNode(req.params.id, b, !!opts.unix || isAgent(req)));
  });
  app.delete<{ Params: { id: string } }>("/v1/nodes/:id", async (req, reply) => {
    const b = body<DeleteNode>(DeleteNode, req.body ?? {}); if ("code" in b) return invalid(reply, b);
    return send(reply, svc.deleteNode(req.params.id, b.expectedRevision), 204);
  });
  app.post<{ Params: { id: string } }>("/v1/nodes/:id/duplicate", async (req, reply) => {
    const b = body<DeleteNode>(DeleteNode, req.body ?? {}); if ("code" in b) return invalid(reply, b);
    return send(reply, svc.duplicateNode(req.params.id, b.expectedRevision), 201);
  });
  app.post<{ Params: { id: string } }>("/v1/workspaces/:id/layout", async (req, reply) => {
    const b = body<ApplyLayout>(ApplyLayout, req.body); if ("code" in b) return invalid(reply, b);
    return send(reply, svc.applyLayout(req.params.id, b.expectedRevision, b.moves));
  });
  app.post<{ Params: { id: string } }>("/v1/workspaces/:id/drawings", async (req, reply) => {
    const b = body<CreateDrawing>(CreateDrawing, req.body); if ("code" in b) return invalid(reply, b);
    return send(reply, svc.createDrawing(req.params.id, b), 201);
  });
  app.patch<{ Params: { id: string } }>("/v1/drawings/:id", async (req, reply) => {
    const b = body<PatchDrawing>(PatchDrawing, req.body); if ("code" in b) return invalid(reply, b);
    return send(reply, svc.patchDrawing(req.params.id, b));
  });
  // #71 — partituras
  app.get("/v1/scores", async () => svc.listScores());
  app.post<{ Params: { id: string } }>("/v1/workspaces/:id/scores", async (req, reply) => { const b = body<SaveScore>(SaveScore, req.body); if ("code" in b) return invalid(reply, b); return send(reply, svc.saveScore(req.params.id, b), 201); });
  app.patch<{ Params: { id: string } }>("/v1/scores/:id", async (req, reply) => { const b = body<PatchScore>(PatchScore, req.body); if ("code" in b) return invalid(reply, b); return send(reply, svc.patchScore(req.params.id, b)); });
  app.delete<{ Params: { id: string } }>("/v1/scores/:id", async (req, reply) => send(reply, svc.deleteScore(req.params.id), 204));
  app.post<{ Params: { id: string; scoreId: string } }>("/v1/workspaces/:id/scores/:scoreId/place", async (req, reply) => { const b = body<PlaceScore>(PlaceScore, req.body); if ("code" in b) return invalid(reply, b); return send(reply, svc.placeScore(req.params.id, req.params.scoreId, b), 201); });
  // #70 — bandas
  app.get<{ Params: { id: string } }>("/v1/workspaces/:id/bands", async (req) => svc.listBands(req.params.id));
  app.post<{ Params: { id: string } }>("/v1/workspaces/:id/bands", async (req, reply) => { const b = body<CreateBand>(CreateBand, req.body); if ("code" in b) return invalid(reply, b); return send(reply, svc.createBand(req.params.id, b), 201); });
  app.patch<{ Params: { id: string } }>("/v1/bands/:id", async (req, reply) => { const b = body<PatchBand>(PatchBand, req.body); if ("code" in b) return invalid(reply, b); return send(reply, svc.patchBand(req.params.id, b)); });
  app.delete<{ Params: { id: string } }>("/v1/bands/:id", async (req, reply) => send(reply, svc.deleteBand(req.params.id), 204));
  app.post<{ Params: { id: string } }>("/v1/bands/:id/ask", async (req, reply) => { const b = body<AskBand>(AskBand, req.body); if ("code" in b) return invalid(reply, b); return send(reply, await svc.askBand(req.params.id, b)); });
  app.post<{ Params: { id: string } }>("/v1/bands/:id/broadcast", async (req, reply) => { const b = body<AskBand>(AskBand, req.body); if ("code" in b) return invalid(reply, b); return send(reply, await svc.broadcastBand(req.params.id, { text: b.text, ...(b.fromNodeId ? { fromNodeId: b.fromNodeId } : {}) })); });
  // #29 — Modo Maestro (o terminal da URL precisa ser condutor)
  app.post<{ Params: { id: string } }>("/v1/nodes/:id/maestro/recruit", async (req, reply) => { const b = body<MaestroRecruit>(MaestroRecruit, req.body); if ("code" in b) return invalid(reply, b); return send(reply, svc.recruit(req.params.id, b), 201); });
  app.post<{ Params: { id: string } }>("/v1/nodes/:id/maestro/dismiss", async (req, reply) => { const b = body<MaestroTarget>(MaestroTarget, req.body); if ("code" in b) return invalid(reply, b); return send(reply, svc.dismiss(req.params.id, b.ref)); });
  app.post<{ Params: { id: string } }>("/v1/nodes/:id/maestro/assign", async (req, reply) => { const b = body<MaestroAssign>(MaestroAssign, req.body); if ("code" in b) return invalid(reply, b); return send(reply, svc.assignRole(req.params.id, b.ref, b.roleName)); });
  app.post<{ Params: { id: string } }>("/v1/nodes/:id/maestro/interrupt", async (req, reply) => { const b = body<MaestroInterrupt>(MaestroInterrupt, req.body); if ("code" in b) return invalid(reply, b); return send(reply, svc.maestroInterrupt(req.params.id, b)); });
  // #78 — grupos de nós
  app.post<{ Params: { id: string } }>("/v1/workspaces/:id/groups", async (req, reply) => { const b = body<CreateNodeGroup>(CreateNodeGroup, req.body); if ("code" in b) return invalid(reply, b); return send(reply, svc.createNodeGroup(req.params.id, b), 201); });
  app.patch<{ Params: { id: string } }>("/v1/groups/:id", async (req, reply) => { const b = body<PatchNodeGroup>(PatchNodeGroup, req.body); if ("code" in b) return invalid(reply, b); return send(reply, svc.patchNodeGroup(req.params.id, b)); });
  app.delete<{ Params: { id: string } }>("/v1/groups/:id", async (req, reply) => { const b = body<DeleteNode>(DeleteNode, req.body); if ("code" in b) return invalid(reply, b); return send(reply, svc.deleteNodeGroup(req.params.id, b.expectedRevision), 204); });
  app.post<{ Params: { id: string } }>("/v1/workspaces/:id/drawings/group", async (req, reply) => {
    const b = body<GroupDrawings>(GroupDrawings, req.body); if ("code" in b) return invalid(reply, b);
    return send(reply, svc.groupDrawings(req.params.id, b));
  });
  app.delete<{ Params: { id: string } }>("/v1/drawings/:id", async (req, reply) => {
    const b = body<DeleteNode>(DeleteNode, req.body ?? {}); if ("code" in b) return invalid(reply, b);
    return send(reply, svc.deleteDrawing(req.params.id, b.expectedRevision), 204);
  });
  app.post<{ Params: { id: string } }>("/v1/workspaces/:id/connections", async (req, reply) => {
    const b = body<CreateConnection>(CreateConnection, req.body); if ("code" in b) return invalid(reply, b);
    return send(reply, svc.createConnection(req.params.id, b, !!opts.unix || isAgent(req)), 201);
  });
  app.patch<{ Params: { id: string } }>("/v1/connections/:id", async (req, reply) => {
    const b = body<PatchConnection>(PatchConnection, req.body); if ("code" in b) return invalid(reply, b);
    return send(reply, svc.patchConnection(req.params.id, b));
  });
  app.delete<{ Params: { id: string } }>("/v1/connections/:id", async (req, reply) => {
    const b = body<DeleteNode>(DeleteNode, req.body ?? {}); if ("code" in b) return invalid(reply, b);
    return send(reply, svc.deleteConnection(req.params.id, b.expectedRevision), 204);
  });
  app.post<{ Params: { id: string } }>("/v1/nodes/:id/messages", async (req, reply) => {
    const b = body<SendMessage>(SendMessage, req.body); if ("code" in b) return invalid(reply, b);
    return send(reply, svc.sendMessage(req.params.id, b), 201);
  });
  app.post<{ Params: { id: string } }>("/v1/nodes/:id/ask", async (req, reply) => {
    const b = body<Ask>(Ask, req.body); if ("code" in b) return invalid(reply, b);
    return send(reply, await svc.ask(req.params.id, b), 200);
  });
  app.get<{ Params: { id: string }; Querystring: { ref?: string } }>("/v1/nodes/:id/check", async (req, reply) =>
    send(reply, svc.checkPeer(req.params.id, req.query.ref ?? "")));
  app.get<{ Params: { id: string }; Querystring: { unread?: string; mark?: string } }>("/v1/nodes/:id/inbox", async (req, reply) =>
    send(reply, svc.inbox(req.params.id, req.query.unread === "1", req.query.mark === "1")));
  app.get<{ Params: { id: string } }>("/v1/messages/:id", async (req, reply) => {
    const m = svc.getMessage(req.params.id);
    return m ? m : reply.status(404).send({ error: { code: "NOT_FOUND", message: "mensagem não encontrada" } });
  });
  app.get<{ Params: { id: string } }>("/v1/workspaces/:id/unread", async (req) => svc.unreadCounts(req.params.id));
  app.get<{ Params: { id: string } }>("/v1/nodes/:id/connected", async (req, reply) => send(reply, svc.connectedNodes(req.params.id)));
  app.get<{ Params: { id: string } }>("/v1/nodes/:id/cross-candidates", async (req, reply) => send(reply, svc.listCrossCandidates(req.params.id)));
  // #87 — credencial do agente de um terminal: emitir/rotacionar (com capacidades) e revogar. Só o app.
  app.post<{ Params: { id: string } }>("/v1/nodes/:id/token", async (req, reply) => { const b = body<IssueAgentTokenInput>(IssueAgentTokenInput, req.body ?? {}); if ("code" in b) return invalid(reply, b); return send(reply, svc.issueAgentToken(req.params.id, b), 201); });
  app.delete<{ Params: { id: string } }>("/v1/nodes/:id/token", async (req, reply) => send(reply, svc.revokeAgentTokensForNode(req.params.id)));
  app.post<{ Params: { id: string } }>("/v1/nodes/:id/restart", async (req, reply) => send(reply, svc.restartTerminal(req.params.id)));
  app.post<{ Params: { id: string } }>("/v1/nodes/:id/unload", async (req, reply) => send(reply, svc.unloadNode(req.params.id)));
  app.post<{ Params: { id: string } }>("/v1/nodes/:id/reload", async (req, reply) => send(reply, svc.reloadNode(req.params.id)));
  app.get<{ Params: { id: string } }>("/v1/sessions/:id", async (req, reply) => {
    const s = svc.sessions.get(req.params.id);
    return s ? s : reply.status(404).send({ error: { code: "NOT_FOUND", message: "sessão não encontrada" } });
  });
  app.post<{ Params: { id: string } }>("/v1/sessions/:id/stop", async (req, reply) => send(reply, svc.sessions.stop(req.params.id)));
  // #80 — monitor de processos do terminal + parar processo da árvore
  app.get<{ Params: { id: string } }>("/v1/sessions/:id/procs", async (req, reply) => send(reply, svc.sessionProcs(req.params.id)));
  app.post<{ Params: { id: string } }>("/v1/sessions/:id/procs/kill", async (req, reply) => { const b = body<KillProcInput>(KillProcInput, req.body); if ("code" in b) return invalid(reply, b); return send(reply, svc.killSessionProc(req.params.id, b)); });

  // WebSocket: eventos de espaço e stream de terminal
  if (!opts.unix) {
    void app.register(websocket);
    void app.register(async (f) => {
      f.get("/v1/ws", { websocket: true }, (socket: WebSocket) => {
        const clientId = newId();
        const workspaces = new Set<string>();
        const attached = new Set<string>();
        const push = (m: WsServerMessage) => { if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(m)); };

        const onOutput = (sessionId: string, sequence: number, data: string) => { if (attached.has(sessionId)) push({ type: "output", sessionId, sequence, data }); };
        const onSession = (session: Parameters<typeof push>[0] extends never ? never : import("@messai/contracts").Session) => {
          if (workspaces.has(session.workspaceId) || attached.has(session.sessionId)) push({ type: "session", session });
          push({ type: "sidebar", sidebar: svc.sidebar() }); // contagem de terminais por espaço
        };
        const onWorkspace = (snapshot: import("@messai/contracts").WorkspaceSnapshot) => { if (workspaces.has(snapshot.workspace.workspaceId)) push({ type: "workspace", snapshot }); };
        const onMessage = (message: import("@messai/contracts").Message) => { if (workspaces.has(message.workspaceId)) push({ type: "message", message }); };
        const onSidebar = (sidebar: import("@messai/contracts").Sidebar) => push({ type: "sidebar", sidebar });
        svc.on("sidebar", onSidebar);
        const onChat = (message: import("@messai/contracts").ChatMessage) => { if (workspaces.has(message.workspaceId)) push({ type: "chat", message }); };
        svc.on("chat", onChat);
        svc.on("message", onMessage);
        const onTaskFinished = (event: import("@messai/contracts").TaskFinished) => { if (workspaces.has(event.workspaceId)) push({ type: "taskFinished", event }); };
        svc.sessions.on("taskFinished", onTaskFinished);
        const onTaskSummary = (summary: import("@messai/contracts").TaskSummary) => { if (workspaces.has(summary.workspaceId)) push({ type: "taskSummary", summary }); };
        svc.on("taskSummary", onTaskSummary);
        const onFloorHook = (workspaceId: string, status: import("@messai/contracts").FloorHookStatus) => push({ type: "floorHook", workspaceId, status });
        svc.on("floorHook", onFloorHook);
        const onNotification = (notification: import("@messai/contracts").NotificationItem) => push({ type: "notification", notification });
        svc.on("notification", onNotification);
        const onApproval = (approval: import("@messai/contracts").Approval) => { if (workspaces.has(approval.workspaceId)) push({ type: "approval", approval }); };
        svc.on("approval", onApproval); // #93
        const watchedPortals = new Set<string>(); // #26 só o app assiste (quadros do screencast)
        const onPortalFrame = (nodeId: string, f: { data: string; width: number; height: number }) => { if (watchedPortals.has(nodeId)) push({ type: "portalFrame", nodeId, data: f.data, width: f.width, height: f.height }); };
        const onPortalState = (state: import("@messai/contracts").PortalState) => { if (watchedPortals.has(state.nodeId)) push({ type: "portalState", state }); };
        svc.on("portalFrame", onPortalFrame); svc.on("portalState", onPortalState);
        const watchedDevices = new Set<string>(); // #73 só o app assiste (quadros do dispositivo)
        const onDeviceFrame = (nodeId: string, f: { mime: "image/png"; data: string; width: number; height: number }) => { if (watchedDevices.has(nodeId)) push({ type: "deviceFrame", nodeId, data: f.data, width: f.width, height: f.height }); };
        const onDeviceState = (state: import("@messai/contracts").DeviceState) => { if (watchedDevices.has(state.nodeId)) push({ type: "deviceState", state }); };
        svc.on("deviceFrame", onDeviceFrame); svc.on("deviceState", onDeviceState);
        svc.sessions.on("output", onOutput);
        svc.sessions.on("session", onSession);
        svc.on("workspace", onWorkspace);

        push({ type: "hello", clientId, protocolVersion: PROTOCOL_VERSION });

        socket.on("message", (raw) => {
          let msg: unknown;
          try { msg = JSON.parse(String(raw)); } catch { return push({ type: "error", error: { code: "INVALID", message: "JSON inválido" } }); }
          if (!Value.Check(WsClientMessage, msg)) return push({ type: "error", error: { code: "INVALID", message: "mensagem fora do contrato" } });
          const m = msg;
          switch (m.type) {
            case "subscribe": {
              const s = svc.snapshot(m.workspaceId);
              if (!s) return push({ type: "error", error: { code: "NOT_FOUND", message: "espaço não encontrado" } });
              workspaces.add(m.workspaceId); push({ type: "workspace", snapshot: s }); return;
            }
            case "attach": {
              const session = svc.sessions.get(m.sessionId);
              if (!session) return push({ type: "error", error: { code: "NOT_FOUND", message: "sessão não encontrada" }, sessionId: m.sessionId });
              attached.add(m.sessionId);
              const snap = svc.sessions.snapshot(m.sessionId) ?? { sequence: 0, data: "" };
              push({ type: "snapshot", sessionId: m.sessionId, sequence: snap.sequence, data: snap.data, session }); return;
            }
            case "detach": attached.delete(m.sessionId); svc.sessions.releaseLease(m.sessionId, clientId); return;
            case "acquireLease": {
              const r = svc.sessions.acquireLease(m.sessionId, clientId);
              if (!r.ok) push({ type: "error", error: r.error, sessionId: m.sessionId }); return;
            }
            case "releaseLease": svc.sessions.releaseLease(m.sessionId, clientId); return;
            case "portalWatch": {
              watchedPortals.add(m.nodeId);
              { const r = svc.portalWatch(m.nodeId, clientId); if (!r.ok) { watchedPortals.delete(m.nodeId); push({ type: "error", error: r.error }); } else push({ type: "portalState", state: r.value }); }
              return;
            }
            case "portalUnwatch": watchedPortals.delete(m.nodeId); svc.portalUnwatch(m.nodeId, clientId); return;
            case "deviceWatch": {
              watchedDevices.add(m.nodeId);
              void svc.deviceWatch(m.nodeId, clientId).then((r) => { if (!r.ok) { watchedDevices.delete(m.nodeId); push({ type: "error", error: r.error }); } else push({ type: "deviceState", state: r.value }); });
              return;
            }
            case "deviceUnwatch": watchedDevices.delete(m.nodeId); svc.deviceUnwatch(m.nodeId, clientId); return;
            case "input": {
              const r = svc.sessions.write(m.sessionId, clientId, m.data);
              if (!r.ok) push({ type: "error", error: r.error, sessionId: m.sessionId }); return;
            }
            case "resize": {
              const r = svc.sessions.resize(m.sessionId, clientId, m.cols, m.rows);
              if (!r.ok) push({ type: "error", error: r.error, sessionId: m.sessionId }); return;
            }
          }
        });
        socket.on("close", () => {
          for (const id of attached) svc.sessions.releaseLease(id, clientId);
          for (const id of watchedPortals) svc.portalUnwatch(id, clientId); svc.off("portalFrame", onPortalFrame); svc.off("portalState", onPortalState);
          for (const id of watchedDevices) svc.deviceUnwatch(id, clientId); svc.off("deviceFrame", onDeviceFrame); svc.off("deviceState", onDeviceState);
          svc.sessions.off("output", onOutput); svc.sessions.off("session", onSession); svc.off("workspace", onWorkspace); svc.off("message", onMessage); svc.sessions.off("taskFinished", onTaskFinished); svc.off("taskSummary", onTaskSummary); svc.off("floorHook", onFloorHook); svc.off("notification", onNotification); svc.off("approval", onApproval); svc.off("sidebar", onSidebar); svc.off("chat", onChat);
        });
      });
    });
  }
  return app;
}
