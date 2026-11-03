import { Type, type Static } from "@sinclair/typebox";

export const PROTOCOL_VERSION = 1 as const;
/** Incrementar a cada mudança de snapshot/rotas; o cliente avisa quando o runtime está atrás. */
export const BUILD_VERSION = 26 as const;

// ---------- Identidades ----------
export const Id = Type.String({ minLength: 8, maxLength: 64 });
export type Id = Static<typeof Id>;

// ---------- Erros ----------
export const ErrorCode = Type.Union([
  Type.Literal("UNAUTHORIZED"),
  Type.Literal("FORBIDDEN"),
  Type.Literal("NOT_FOUND"),
  Type.Literal("CONFLICT"),
  Type.Literal("INVALID"),
  Type.Literal("UNSUPPORTED"),
  Type.Literal("LEASE_HELD"),
  Type.Literal("SESSION_NOT_RUNNING"),
  Type.Literal("INTERNAL"),
]);
export type ErrorCode = Static<typeof ErrorCode>;

export const ApiError = Type.Object({
  code: ErrorCode,
  message: Type.String(),
  revision: Type.Optional(Type.Integer()),
});
export type ApiError = Static<typeof ApiError>;

// ---------- Máquina ----------
export const Machine = Type.Object({
  machineId: Id,
  name: Type.String(),
  platform: Type.String(),
  protocolVersion: Type.Integer(),
});
export type Machine = Static<typeof Machine>;

export const Capabilities = Type.Object({
  protocolVersion: Type.Integer(),
  machineId: Id,
  features: Type.Array(Type.String()),
});
export type Capabilities = Static<typeof Capabilities>;

// ---------- Espaço e nós ----------
export const Geometry = Type.Object({
  x: Type.Number(),
  y: Type.Number(),
  w: Type.Number({ minimum: 40 }),
  h: Type.Number({ minimum: 40 }),
});
export type Geometry = Static<typeof Geometry>;

export const NodeKind = Type.Union([Type.Literal("terminal"), Type.Literal("note"), Type.Literal("text"), Type.Literal("tree"), Type.Literal("binder")]); // binder = fichário (#74)
export type NodeKind = Static<typeof NodeKind>;

export const Node = Type.Object({
  nodeId: Id,
  workspaceId: Id,
  kind: NodeKind,
  title: Type.String(),
  geometry: Geometry,
  // terminal: sessionId e papel (responsabilidade); note: conteúdo markdown
  sessionId: Type.Optional(Id),
  roleId: Type.Optional(Id),
  content: Type.Optional(Type.String()),
  // nota: arquivo .md real no disco, bloqueio (agentes só leem), cor
  filePath: Type.Optional(Type.String()),
  locked: Type.Optional(Type.Boolean()),
  color: Type.Optional(Type.String()),
  // terminal (#56): ícone e tema do xterm escolhidos no preset ou editados no nó; `color` também vale para terminal
  icon: Type.Optional(Type.String()),
  termTheme: Type.Optional(Type.String()),
  skillIds: Type.Optional(Type.Array(Id)), // #57 habilidades anexadas (terminal)
  groupId: Type.Optional(Id), // #78 grupo de nós
  maestro: Type.Optional(Type.Boolean()), // #29 terminal condutor (recruta/dispensa/reatribui agentes)
  memLimitMb: Type.Optional(Type.Integer({ minimum: 0 })), // #80 limite de memória do terminal (0/ausente = sem limite)
  createdAt: Type.String(),
});
export type Node = Static<typeof Node>;
// #78 — grupo de nós: contêiner com rótulo e cor; os membros movem juntos. Some sozinho quando fica vazio.
export const NodeGroup = Type.Object({ groupId: Id, workspaceId: Id, label: Type.String(), color: Type.String(), createdAt: Type.String() });
export type NodeGroup = Static<typeof NodeGroup>;
export const CreateNodeGroup = Type.Object({ expectedRevision: Type.Integer(), nodeIds: Type.Array(Id, { minItems: 1, maxItems: 200 }), label: Type.Optional(Type.String({ maxLength: 60 })), color: Type.Optional(Type.String({ maxLength: 12 })) });
export type CreateNodeGroup = Static<typeof CreateNodeGroup>;
export const PatchNodeGroup = Type.Object({ expectedRevision: Type.Integer(), label: Type.Optional(Type.String({ maxLength: 60 })), color: Type.Optional(Type.String({ maxLength: 12 })), addNodeIds: Type.Optional(Type.Array(Id, { maxItems: 200 })), removeNodeIds: Type.Optional(Type.Array(Id, { maxItems: 200 })) });
export type PatchNodeGroup = Static<typeof PatchNodeGroup>;
// #56 — tema do xterm de um terminal (system = segue o tema do app) e alvo do preset (terminal ou chat aberto)
export const TermTheme = Type.Union([Type.Literal("system"), Type.Literal("dark"), Type.Literal("light"), Type.Literal("custom")]);
export type TermTheme = Static<typeof TermTheme>;
export const PresetTarget = Type.Union([Type.Literal("terminal"), Type.Literal("chat")]);
export type PresetTarget = Static<typeof PresetTarget>;

export const Workspace = Type.Object({
  workspaceId: Id,
  machineId: Id,
  name: Type.String(),
  cwd: Type.String(),
  icon: Type.String(),
  color: Type.String(),
  folderId: Type.Optional(Id),
  sortOrder: Type.Number(),
  revision: Type.Integer({ minimum: 0 }),
  createdAt: Type.String(),
  // andar (floor): canvas-filho do térreo com branch/worktree próprios
  parentId: Type.Optional(Id),
  branch: Type.Optional(Type.String()),
  floorType: Type.Optional(Type.Union([Type.Literal("worktree"), Type.Literal("copy"), Type.Literal("none")])),
  copyMode: Type.Optional(Type.Union([Type.Literal("cow"), Type.Literal("independent")])),
  excludeDirs: Type.Optional(Type.Array(Type.String())),
  status: Type.Optional(Type.Union([Type.Literal("working"), Type.Literal("blocked"), Type.Literal("review"), Type.Literal("done")])),
  statusText: Type.Optional(Type.String()),
  unloaded: Type.Optional(Type.Boolean()), // #84 espaço descarregado (hibernado) para poupar CPU/RAM
});
export type Workspace = Static<typeof Workspace>;
export const FloorStatus = Type.Union([Type.Literal("working"), Type.Literal("blocked"), Type.Literal("review"), Type.Literal("done")]);
export type FloorStatus = Static<typeof FloorStatus>;
// #75 — Hooks de andar: comandos executados no ciclo de vida (setup ao criar, run sob demanda, teardown antes de remover/pousar).
export const FloorHookSection = Type.Union([Type.Literal("setup"), Type.Literal("run"), Type.Literal("teardown")]);
export type FloorHookSection = Static<typeof FloorHookSection>;
export const FloorHooksConfig = Type.Object({
  setup: Type.String({ maxLength: 20000 }),
  run: Type.String({ maxLength: 20000 }),
  teardown: Type.String({ maxLength: 20000 }),
});
export type FloorHooksConfig = Static<typeof FloorHooksConfig>;
export const PutFloorHooks = Type.Partial(FloorHooksConfig);
export type PutFloorHooks = Static<typeof PutFloorHooks>;
export const FloorHookRunState = Type.Union([Type.Literal("idle"), Type.Literal("running"), Type.Literal("succeeded"), Type.Literal("failed"), Type.Literal("stopped")]);
export type FloorHookRunState = Static<typeof FloorHookRunState>;
export const FloorHookStatus = Type.Object({
  section: FloorHookSection,
  state: FloorHookRunState,
  pid: Type.Optional(Type.Integer()),
  exitCode: Type.Optional(Type.Integer()),
  startedAt: Type.Optional(Type.String()),
  finishedAt: Type.Optional(Type.String()),
  log: Type.String(),
});
export type FloorHookStatus = Static<typeof FloorHookStatus>;
export const FloorHooksState = Type.Object({
  workspaceId: Id,
  hooks: FloorHooksConfig,
  status: Type.Object({
    setup: FloorHookStatus,
    run: FloorHookStatus,
    teardown: FloorHookStatus,
  }),
});
export type FloorHooksState = Static<typeof FloorHooksState>;
export const RunFloorHookInput = Type.Object({
  section: Type.Optional(Type.Union([FloorHookSection, Type.Literal("all")])),
  wait: Type.Optional(Type.Boolean()),
});
export type RunFloorHookInput = Static<typeof RunFloorHookInput>;
export const StopFloorHookInput = Type.Object({
  section: Type.Optional(Type.Union([FloorHookSection, Type.Literal("all")])),
});
export type StopFloorHookInput = Static<typeof StopFloorHookInput>;
// #81 — Andares: cópia isolada (CoW/independente) e pastas excluídas.
export const FloorCopyMode = Type.Union([Type.Literal("auto"), Type.Literal("cow"), Type.Literal("independent")]);
export type FloorCopyMode = Static<typeof FloorCopyMode>;
export const FloorCopyInfo = Type.Object({
  cowSupported: Type.Boolean(),
  defaultExcludes: Type.Array(Type.String()),
  excludeDirs: Type.Array(Type.String()),
  presentDirs: Type.Array(Type.String()),
});
export type FloorCopyInfo = Static<typeof FloorCopyInfo>;
export const PutFloorExcludes = Type.Object({
  excludeDirs: Type.Array(Type.String({ minLength: 1, maxLength: 120 }), { maxItems: 100 }),
});
export type PutFloorExcludes = Static<typeof PutFloorExcludes>;
/** Criar andar a partir do térreo: branch nova ou existente, worktree git (padrão), cópia isolada (CoW/independente) ou sem isolamento. */
export const CreateFloor = Type.Object({
  name: Type.String({ minLength: 1 }),
  branch: Type.Optional(Type.String({ minLength: 1 })),
  newBranch: Type.Optional(Type.Boolean()),
  base: Type.Optional(Type.String()),
  floorType: Type.Optional(Type.Union([Type.Literal("worktree"), Type.Literal("copy"), Type.Literal("none")])),
  copyMode: Type.Optional(FloorCopyMode),
  excludeDirs: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 120 }), { maxItems: 100 })),
  copyDelayMs: Type.Optional(Type.Integer({ minimum: 0, maximum: 5000 })),
  path: Type.Optional(Type.String({ minLength: 1 })),
  cloneLayout: Type.Optional(Type.Boolean()),
  hooks: Type.Optional(PutFloorHooks),
});
export type CreateFloor = Static<typeof CreateFloor>;
export const LandFloor = Type.Object({ mode: Type.Optional(Type.Union([Type.Literal("merge"), Type.Literal("squash")])), keepFloor: Type.Optional(Type.Boolean()), deleteBranch: Type.Optional(Type.Boolean()) });
export type LandFloor = Static<typeof LandFloor>;
export const LandResult = Type.Object({ ok: Type.Boolean(), merged: Type.Boolean(), conflicts: Type.Array(Type.String()), output: Type.String(), removed: Type.Boolean() });
export type LandResult = Static<typeof LandResult>;
// #31 — Pull request nos andares (+ hosts Git configuráveis)
export const GitHostKind = Type.Union([
  Type.Literal("github"),
  Type.Literal("gitlab"),
  Type.Literal("gitea"),
  Type.Literal("custom"),
]);
export type GitHostKind = Static<typeof GitHostKind>;
export const GitHostEntry = Type.Object({
  host: Type.String({ minLength: 1, maxLength: 120 }),
  kind: GitHostKind,
  prUrlTemplate: Type.Optional(Type.String({ maxLength: 500 })),
});
export type GitHostEntry = Static<typeof GitHostEntry>;
export const PutGitHostsInput = Type.Object({
  hosts: Type.Array(GitHostEntry, { maxItems: 50 }),
});
export type PutGitHostsInput = Static<typeof PutGitHostsInput>;
export const FloorPrReviewStatus = Type.Union([
  Type.Literal("none"),
  Type.Literal("review_required"),
  Type.Literal("approved"),
  Type.Literal("changes_requested"),
]);
export type FloorPrReviewStatus = Static<typeof FloorPrReviewStatus>;
export const FloorPrChecksStatus = Type.Union([
  Type.Literal("none"),
  Type.Literal("pending"),
  Type.Literal("passing"),
  Type.Literal("failing"),
]);
export type FloorPrChecksStatus = Static<typeof FloorPrChecksStatus>;
export const FloorPrState = Type.Object({
  workspaceId: Id,
  branch: Type.String(),
  baseBranch: Type.String(),
  remoteUrl: Type.String(),
  host: Type.String(),
  hostKind: GitHostKind,
  repoSlug: Type.String(),
  compareUrl: Type.String(),
  state: Type.Union([Type.Literal("none"), Type.Literal("open"), Type.Literal("merged"), Type.Literal("closed")]),
  number: Type.Optional(Type.Integer()),
  title: Type.Optional(Type.String()),
  body: Type.Optional(Type.String()),
  url: Type.Optional(Type.String()),
  draft: Type.Optional(Type.Boolean()),
  reviewStatus: FloorPrReviewStatus,
  checksStatus: FloorPrChecksStatus,
  ahead: Type.Integer(),
  behind: Type.Integer(),
  updatedAt: Type.Optional(Type.String()),
});
export type FloorPrState = Static<typeof FloorPrState>;
export const CreateFloorPrInput = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 200 }),
  body: Type.Optional(Type.String({ maxLength: 20000 })),
  baseBranch: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
  draft: Type.Optional(Type.Boolean()),
  push: Type.Optional(Type.Boolean()),
});
export type CreateFloorPrInput = Static<typeof CreateFloorPrInput>;
export const PatchFloorPrInput = Type.Object({
  state: Type.Optional(Type.Union([Type.Literal("none"), Type.Literal("open"), Type.Literal("merged"), Type.Literal("closed")])),
  number: Type.Optional(Type.Integer({ minimum: 1 })),
  title: Type.Optional(Type.String({ maxLength: 200 })),
  body: Type.Optional(Type.String({ maxLength: 20000 })),
  url: Type.Optional(Type.String({ maxLength: 500 })),
  draft: Type.Optional(Type.Boolean()),
  reviewStatus: Type.Optional(FloorPrReviewStatus),
  checksStatus: Type.Optional(FloorPrChecksStatus),
  action: Type.Optional(Type.Union([Type.Literal("push"), Type.Literal("refresh"), Type.Literal("merge"), Type.Literal("close"), Type.Literal("reopen")])),
});
export type PatchFloorPrInput = Static<typeof PatchFloorPrInput>;

/** Pasta (agrupa espaços, pode ter subpastas) ou grupo (divisor com rótulo) da barra lateral. */
export const FolderKind = Type.Union([Type.Literal("folder"), Type.Literal("group")]);
export const Folder = Type.Object({
  folderId: Id,
  name: Type.String(),
  kind: FolderKind,
  parentId: Type.Optional(Id),
  sortOrder: Type.Number(),
  collapsed: Type.Boolean(),
  createdAt: Type.String(),
});
export type Folder = Static<typeof Folder>;
export const CreateFolder = Type.Object({ name: Type.String({ minLength: 1 }), kind: Type.Optional(FolderKind), parentId: Type.Optional(Id) });
export type CreateFolder = Static<typeof CreateFolder>;
export const PatchFolder = Type.Object({ name: Type.Optional(Type.String({ minLength: 1 })), parentId: Type.Optional(Type.Union([Id, Type.Null()])), sortOrder: Type.Optional(Type.Number()), collapsed: Type.Optional(Type.Boolean()) });
export type PatchFolder = Static<typeof PatchFolder>;
/** Barra lateral completa: pastas, espaços e terminais vivos por espaço. */
export const Sidebar = Type.Object({ folders: Type.Array(Folder), workspaces: Type.Array(Workspace), terminals: Type.Record(Type.String(), Type.Integer()) });
export type Sidebar = Static<typeof Sidebar>;

export const Connection = Type.Object({
  connectionId: Id,
  workspaceId: Id,
  sourceNodeId: Id,
  targetNodeId: Id,
  label: Type.Optional(Type.String()),
  /** Corda (física, pendurada) ou Circuito (ortogonal). */
  style: Type.Optional(Type.Union([Type.Literal("rope"), Type.Literal("circuit")])),
  createdAt: Type.String(),
});
export type Connection = Static<typeof Connection>;
export const PatchConnection = Type.Object({ expectedRevision: Type.Integer(), style: Type.Optional(Type.Union([Type.Literal("rope"), Type.Literal("circuit")])), label: Type.Optional(Type.Union([Type.String(), Type.Null()])) });
export type PatchConnection = Static<typeof PatchConnection>;
// #82 — Conexões entre andares e entre espaços
export const ConnectedPeer = Type.Object({
  node: Node,
  direction: Type.Union([Type.Literal("in"), Type.Literal("out")]),
  connectionId: Id,
  agentType: Type.Optional(Type.String()),
  workspaceId: Id,
  workspaceName: Type.String(),
  crossWorkspace: Type.Boolean(),
});
export type ConnectedPeer = Static<typeof ConnectedPeer>;
export const CrossNodeCandidate = Type.Object({
  nodeId: Id,
  title: Type.String(),
  kind: NodeKind,
  workspaceId: Id,
  workspaceName: Type.String(),
  parentId: Type.Optional(Id),
  branch: Type.Optional(Type.String()),
  refLabel: Type.String(),
});
export type CrossNodeCandidate = Static<typeof CrossNodeCandidate>;

// ---------- Desenhos à mão ----------
export const Point = Type.Tuple([Type.Number(), Type.Number()]);
export const Drawing = Type.Object({
  drawingId: Id,
  workspaceId: Id,
  kind: Type.Union([Type.Literal("pen"), Type.Literal("line"), Type.Literal("arrow"), Type.Literal("rect")]),
  points: Type.Array(Point, { minItems: 2 }),
  color: Type.String(),
  width: Type.Number({ minimum: 1, maximum: 40 }),
  createdAt: Type.String(),
  groupId: Type.Optional(Type.String()),
});
export type Drawing = Static<typeof Drawing>;
export const CreateDrawing = Type.Object({
  expectedRevision: Type.Integer(),
  kind: Drawing.properties.kind,
  points: Type.Array(Point, { minItems: 2, maxItems: 5000 }),
  color: Type.String(),
  width: Type.Number({ minimum: 1, maximum: 40 }),
});
export type CreateDrawing = Static<typeof CreateDrawing>;
export const PatchDrawing = Type.Object({
  expectedRevision: Type.Integer(),
  points: Type.Array(Point, { minItems: 2, maxItems: 5000 }), // novos pontos (ex.: mover = transladar todos)
});
export type PatchDrawing = Static<typeof PatchDrawing>;
export const GroupDrawings = Type.Object({
  expectedRevision: Type.Integer(),
  drawingIds: Type.Array(Id, { minItems: 1 }),
  grouped: Type.Boolean(), // true = agrupa (id compartilhado novo); false = desagrupa
});
export type GroupDrawings = Static<typeof GroupDrawings>;

// #70 — banda: grupo nomeado de terminais/agentes para perguntar/transmitir em lote. `asking` = membros com pergunta em andamento (efêmero).
export const Band = Type.Object({ bandId: Id, workspaceId: Id, name: Type.String(), color: Type.String(), nodeIds: Type.Array(Id), asking: Type.Array(Id), createdAt: Type.String() });
export type Band = Static<typeof Band>;
export const CreateBand = Type.Object({ name: Type.String({ minLength: 1, maxLength: 40 }), color: Type.Optional(Type.String({ maxLength: 12 })), nodeIds: Type.Optional(Type.Array(Id, { maxItems: 50 })) });
export type CreateBand = Static<typeof CreateBand>;
export const PatchBand = Type.Object({ name: Type.Optional(Type.String({ minLength: 1, maxLength: 40 })), color: Type.Optional(Type.String({ maxLength: 12 })), addNodeIds: Type.Optional(Type.Array(Id, { maxItems: 50 })), removeNodeIds: Type.Optional(Type.Array(Id, { maxItems: 50 })) });
export type PatchBand = Static<typeof PatchBand>;
/** Pergunta/transmissão em lote. Sem `fromNodeId` é o humano (o texto é digitado nos membros); com ele é um agente (mensagem rastreável, exige conexão ou mesma banda). */
export const AskBand = Type.Object({ text: Type.String({ minLength: 1, maxLength: 20000 }), fromNodeId: Type.Optional(Id), timeoutMs: Type.Optional(Type.Integer({ minimum: 1000, maximum: 600000 })), noWait: Type.Optional(Type.Boolean()) });
export type AskBand = Static<typeof AskBand>;
export type BandAnswer = { nodeId: string; title: string; agentType: string; delivered: boolean; response: string; timedOut: boolean; error?: string };
export type BandAskResult = { bandId: string; name: string; answers: BandAnswer[] };

// #29 — Modo Maestro: o condutor recruta/dispensa/reatribui terminais ligados a ele.
export const MaestroRecruit = Type.Object({
  preset: Type.Optional(Type.String({ maxLength: 60 })), command: Type.Optional(Type.String({ maxLength: 300 })), args: Type.Optional(Type.Array(Type.String({ maxLength: 4000 }), { maxItems: 50 })),
  name: Type.Optional(Type.String({ maxLength: 60 })), roleName: Type.Optional(Type.String({ maxLength: 60 })), band: Type.Optional(Type.String({ maxLength: 40 })),
  cwd: Type.Optional(Type.String({ minLength: 1 })), persistent: Type.Optional(Type.Boolean()),
});
export type MaestroRecruit = Static<typeof MaestroRecruit>;
export const MaestroTarget = Type.Object({ ref: Type.String({ minLength: 1 }) });
export type MaestroTarget = Static<typeof MaestroTarget>;
export const MaestroAssign = Type.Object({ ref: Type.String({ minLength: 1 }), roleName: Type.Union([Type.String({ minLength: 1 }), Type.Null()]) });
export type MaestroAssign = Static<typeof MaestroAssign>;

export const WorkspaceSnapshot = Type.Object({
  workspace: Workspace,
  nodes: Type.Array(Node),
  connections: Type.Array(Connection),
  drawings: Type.Array(Drawing),
  groups: Type.Optional(Type.Array(NodeGroup)), // #78 (opcional para clientes antigos)
  bands: Type.Optional(Type.Array(Band)), // #70
});
export type WorkspaceSnapshot = Static<typeof WorkspaceSnapshot>;

// ---------- Mensagens entre agentes (ADR-0008) ----------
export const Message = Type.Object({
  messageId: Id,
  workspaceId: Id,
  fromNodeId: Id,
  toNodeId: Id,
  text: Type.String({ minLength: 1, maxLength: 20000 }),
  replyTo: Type.Optional(Id),
  createdAt: Type.String(),
  readAt: Type.Optional(Type.String()),
  delivered: Type.Boolean(),
});
export type Message = Static<typeof Message>;

// Companheiro (#65): um agente CONCLUIU um turno (recebeu input, trabalhou e assentou). Só para agentes de IA.
export const TaskFinished = Type.Object({
  sessionId: Id,
  nodeId: Id,
  workspaceId: Id,
  agentType: Type.String(),
  at: Type.String(),
  /** Última tela (viewport) no momento em que assentou — insumo para resumo (#66) e HUD (#67). */
  screen: Type.String(),
});
export type TaskFinished = Static<typeof TaskFinished>;

// Companheiro (#66): resumo + próximo passo gerados por modelo LOCAL (Ollama) a partir de um taskFinished.
export const TaskSummary = Type.Object({
  sessionId: Id, nodeId: Id, workspaceId: Id, at: Type.String(), model: Type.String(),
  summary: Type.String(), nextStep: Type.String(),
});
export type TaskSummary = Static<typeof TaskSummary>;
export const CompanionConfig = Type.Object({
  enabled: Type.Boolean(), available: Type.Boolean(), url: Type.String(),
  model: Type.Union([Type.String(), Type.Null()]), models: Type.Array(Type.String()),
});
export type CompanionConfig = Static<typeof CompanionConfig>;

// Configurações do runtime (#55): valem entre sessões, para todos os clientes desta máquina (persistidas no banco).
export const RuntimeSettings = Type.Object({
  restoreSessions: Type.Boolean(), // re-abrir sessões persistentes após reboot (ADR-0010); tmux vivo sempre reanexa
  // #80 limite de memória por terminal (0 = sem limite global; o limite por nó vence) e ação ao estourar
  termMemLimitMb: Type.Optional(Type.Integer({ minimum: 0, maximum: 1048576 })),
  termMemAction: Type.Optional(Type.Union([Type.Literal("warn"), Type.Literal("kill")])),
  // #84 descarregar espaços ociosos automaticamente (0 = desligado, em minutos) e recarregar ao abrir o espaço
  autoUnloadMinutes: Type.Optional(Type.Integer({ minimum: 0, maximum: 10080 })),
  reloadOnSelect: Type.Optional(Type.Boolean()),
});
export type RuntimeSettings = Static<typeof RuntimeSettings>;
export const PatchRuntimeSettings = Type.Partial(RuntimeSettings);
export type PatchRuntimeSettings = Static<typeof PatchRuntimeSettings>;

// #62 — Dados: backup/restauração/troca de pasta/reset. As operações destrutivas exigem confirmação literal.
export const BackupInput = Type.Object({ dir: Type.Optional(Type.String({ minLength: 1 })) }); // destino; padrão <dataDir>/backups
export type BackupInput = Static<typeof BackupInput>;
export const RestoreInput = Type.Object({ path: Type.String({ minLength: 1 }), confirm: Type.Literal("RESTAURAR") });
export type RestoreInput = Static<typeof RestoreInput>;
export const MoveDataInput = Type.Object({ dir: Type.String({ minLength: 1 }), confirm: Type.Literal("MOVER") });
export type MoveDataInput = Static<typeof MoveDataInput>;
export const ResetInput = Type.Object({ confirm: Type.Literal("APAGAR") });
export type ResetInput = Static<typeof ResetInput>;

export const SendMessage = Type.Object({
  to: Type.String({ minLength: 1 }), // nodeId, prefixo de id ou título
  text: Type.String({ minLength: 1, maxLength: 20000 }),
  replyTo: Type.Optional(Id),
});
export type SendMessage = Static<typeof SendMessage>;

// `ask` bloqueante: entrega e espera a "última tela" do destino assentar (ou noWait para disparar e sair).
export const Ask = Type.Object({
  to: Type.String({ minLength: 1 }),
  text: Type.String({ minLength: 1, maxLength: 20000 }),
  timeoutMs: Type.Optional(Type.Integer({ minimum: 500, maximum: 600000 })),
  noWait: Type.Optional(Type.Boolean()),
  replyTo: Type.Optional(Id),
});
export type Ask = Static<typeof Ask>;
export type AskResult = { messageId: string; delivered: boolean; response: string; timedOut: boolean; agentType: string };

// ---------- Sessões de terminal ----------
export const SessionState = Type.Union([
  Type.Literal("starting"),
  Type.Literal("running"),
  Type.Literal("exited"),
  Type.Literal("lost"), // runtime reiniciou e o PTY não existe mais
  Type.Literal("unloaded"), // #84 descarregado para poupar CPU/RAM (mantido entre sessões até recarregar)
]);
export type SessionState = Static<typeof SessionState>;

export const Session = Type.Object({
  sessionId: Id,
  workspaceId: Id,
  nodeId: Id,
  command: Type.String(),
  args: Type.Array(Type.String()),
  cwd: Type.String(),
  state: SessionState,
  pid: Type.Optional(Type.Integer()),
  exitCode: Type.Optional(Type.Integer()),
  cols: Type.Integer(),
  rows: Type.Integer(),
  /** Sessão dentro do tmux: sobrevive ao runtime (reinício, crash, reboot não). */
  persistent: Type.Optional(Type.Boolean()),
  /** Id da sessão do CLI de IA (claude/codex/…), para retomar a conversa no restore pós-reboot. */
  resumeId: Type.Optional(Type.String()),
  lease: Type.Optional(
    Type.Object({ clientId: Id, expiresAt: Type.String() }),
  ),
  createdAt: Type.String(),
});
export type Session = Static<typeof Session>;

/** Chat por terminal: camada sobre o PTY; o agente responde com `mess say`, sem parsing de saída. 7 tópicos fixos. */
export const ChatRole = Type.Union([Type.Literal("user"), Type.Literal("agent"), Type.Literal("system")]);
export type ChatRole = Static<typeof ChatRole>;
/** #79 — anexo de uma mensagem do chat (o arquivo vive em <dados>/attachments/<espaço>/). */
export const ChatAttachment = Type.Object({ attachmentId: Id, name: Type.String(), path: Type.String(), size: Type.Integer(), mime: Type.String() });
export type ChatAttachment = Static<typeof ChatAttachment>;
export const ChatMessage = Type.Object({ chatId: Id, workspaceId: Id, nodeId: Id, thread: Type.Integer({ minimum: 1, maximum: 7 }), role: ChatRole, text: Type.String(), createdAt: Type.String(), attachments: Type.Optional(Type.Array(ChatAttachment)) });
export type ChatMessage = Static<typeof ChatMessage>;
// O papel NÃO vem do cliente (segurança MESS-03): o servidor deriva do canal autenticado (http=user, socket=agent).
export const SendChat = Type.Object({ text: Type.String({ minLength: 1 }), thread: Type.Optional(Type.Integer({ minimum: 1, maximum: 7 })),
  /** #79 arquivos locais a anexar à mensagem (são COPIADOS para o diretório de anexos; máx. 10 · 25 MB cada). */
  attachments: Type.Optional(Type.Array(Type.Object({ path: Type.String({ minLength: 1 }), name: Type.Optional(Type.String({ maxLength: 200 })) }), { maxItems: 10 })) });
export type SendChat = Static<typeof SendChat>;
/** #79 copiar um anexo do chat para uma pasta do espaço (arrastar para a árvore). `dir` relativo à raiz do espaço ("" = raiz). */
export const ExportAttachment = Type.Object({ workspaceId: Id, dir: Type.String(), name: Type.Optional(Type.String({ maxLength: 200 })) });
export type ExportAttachment = Static<typeof ExportAttachment>;

// ---------- #76 Arquivos de instrução do projeto (CLAUDE.md / AGENTS.md) ----------
export const InstructionFileName = Type.Union([Type.Literal("CLAUDE.md"), Type.Literal("AGENTS.md")]);
export type InstructionFileName = Static<typeof InstructionFileName>;
export const InstructionFileInfo = Type.Object({ name: InstructionFileName, exists: Type.Boolean(), text: Type.String(), mtime: Type.Optional(Type.Number()) });
export type InstructionFileInfo = Static<typeof InstructionFileInfo>;
export const InstructionsStatus = Type.Object({
  status: Type.Union([Type.Literal("missing"), Type.Literal("only-claude"), Type.Literal("only-agents"), Type.Literal("synced"), Type.Literal("diverged")]),
  claude: InstructionFileInfo,
  agents: InstructionFileInfo,
});
export type InstructionsStatus = Static<typeof InstructionsStatus>;
export const PutInstructions = Type.Object({
  target: Type.Union([InstructionFileName, Type.Literal("both")]),
  text: Type.String({ maxLength: 500000 }),
});
export type PutInstructions = Static<typeof PutInstructions>;
export const SyncInstructions = Type.Object({ direction: Type.Union([Type.Literal("claude-to-agents"), Type.Literal("agents-to-claude")]) });
export type SyncInstructions = Static<typeof SyncInstructions>;

// ---------- #80 Monitor de processos do terminal + limite de memória ----------
export const ProcEntry = Type.Object({
  pid: Type.Integer(),
  ppid: Type.Integer(),
  name: Type.String(),
  cmd: Type.String(),
  rssKb: Type.Integer(),
  state: Type.String(),
  depth: Type.Integer(),
});
export type ProcEntry = Static<typeof ProcEntry>;
export const SessionProcs = Type.Object({
  sessionId: Id,
  nodeId: Id,
  rootPid: Type.Union([Type.Integer(), Type.Null()]),
  totalRssKb: Type.Integer(),
  limitMb: Type.Union([Type.Integer(), Type.Null()]),
  overLimit: Type.Boolean(),
  action: Type.Union([Type.Literal("warn"), Type.Literal("kill")]),
  processes: Type.Array(ProcEntry),
});
export type SessionProcs = Static<typeof SessionProcs>;
export const KillProcInput = Type.Object({
  pid: Type.Integer({ minimum: 2 }),
  signal: Type.Optional(Type.Union([Type.Literal("SIGTERM"), Type.Literal("SIGKILL")])),
});
export type KillProcInput = Static<typeof KillProcInput>;

// ---------- Comandos (HTTP) ----------
export const CreateWorkspace = Type.Object({
  name: Type.String({ minLength: 1 }),
  cwd: Type.String({ minLength: 1 }),
  icon: Type.Optional(Type.String()),
  color: Type.Optional(Type.String()),
  folderId: Type.Optional(Id),
});
export type CreateWorkspace = Static<typeof CreateWorkspace>;

export const PatchWorkspace = Type.Object({
  expectedRevision: Type.Integer(),
  name: Type.Optional(Type.String({ minLength: 1 })),
  cwd: Type.Optional(Type.String({ minLength: 1 })),
  icon: Type.Optional(Type.String()),
  color: Type.Optional(Type.String()),
  folderId: Type.Optional(Type.Union([Id, Type.Null()])),
  sortOrder: Type.Optional(Type.Number()),
  status: Type.Optional(FloorStatus),
  statusText: Type.Optional(Type.String()),
});
export type PatchWorkspace = Static<typeof PatchWorkspace>;

export const CreateNode = Type.Object({
  expectedRevision: Type.Integer(),
  kind: NodeKind,
  title: Type.Optional(Type.String()),
  geometry: Geometry,
  content: Type.Optional(Type.String()),
  // só para terminal
  command: Type.Optional(Type.String()),
  args: Type.Optional(Type.Array(Type.String())),
  cwd: Type.Optional(Type.String({ minLength: 1 })),
  roleId: Type.Optional(Id),
  persistent: Type.Optional(Type.Boolean()),
  // só para nota: vincular um .md/.txt existente (fica no lugar) e cor
  filePath: Type.Optional(Type.String({ minLength: 1 })),
  color: Type.Optional(Type.String()), // nota ou terminal
  // terminal (#56): aparência vinda do preset
  icon: Type.Optional(Type.String({ maxLength: 40 })),
  termTheme: Type.Optional(TermTheme),
  skillIds: Type.Optional(Type.Array(Id, { maxItems: 20 })), // #57
  maestro: Type.Optional(Type.Boolean()), // #29 nasce condutor (preset com Maestro)
});
export type CreateNode = Static<typeof CreateNode>;

export const PatchNode = Type.Object({
  expectedRevision: Type.Integer(),
  title: Type.Optional(Type.String()),
  geometry: Type.Optional(Geometry),
  content: Type.Optional(Type.String()),
  /** Reatribuir papel reinicia só o processo do terminal. null remove. */
  roleId: Type.Optional(Type.Union([Id, Type.Null()])),
  // nota
  locked: Type.Optional(Type.Boolean()),
  color: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  /** "Mover para…": novo caminho completo do .md; o arquivo é movido. */
  filePath: Type.Optional(Type.String({ minLength: 1 })),
  // terminal (#56): aparência editável no nó (null limpa)
  icon: Type.Optional(Type.Union([Type.String({ maxLength: 40 }), Type.Null()])),
  termTheme: Type.Optional(Type.Union([TermTheme, Type.Null()])),
  /** #57 Reatribuir habilidades reinicia só o processo do terminal (como o papel). */
  skillIds: Type.Optional(Type.Array(Id, { maxItems: 20 })),
  /** #78 entrar/sair de um grupo (null sai). */
  groupId: Type.Optional(Type.Union([Id, Type.Null()])),
  /** #29 promover/rebaixar condutor · #80 limite de memória em MB (0 remove). */
  maestro: Type.Optional(Type.Boolean()),
  memLimitMb: Type.Optional(Type.Integer({ minimum: 0, maximum: 1048576 })),
});
export type PatchNode = Static<typeof PatchNode>;

/** Mover vários nós de uma vez (alinhar/organizar em grade) numa única revisão. */
export const ApplyLayout = Type.Object({
  expectedRevision: Type.Integer(),
  moves: Type.Array(Type.Object({ nodeId: Id, geometry: Geometry })),
});
export type ApplyLayout = Static<typeof ApplyLayout>;

/** Responsabilidade (papel): nome, badge curto e instruções injetadas na partida do agente. Portátil como role.json. */
export const Role = Type.Object({ roleId: Id, name: Type.String(), badge: Type.String(), instructions: Type.String(), createdAt: Type.String(), updatedAt: Type.String() });
export type Role = Static<typeof Role>;
export const CreateRole = Type.Object({ name: Type.String({ minLength: 1, maxLength: 60 }), badge: Type.Optional(Type.String({ maxLength: 4 })), instructions: Type.String() });
export type CreateRole = Static<typeof CreateRole>;
export const PatchRole = Type.Object({ name: Type.Optional(Type.String({ minLength: 1, maxLength: 60 })), badge: Type.Optional(Type.String({ maxLength: 4 })), instructions: Type.Optional(Type.String()) });
export type PatchRole = Static<typeof PatchRole>;

export const DeleteNode = Type.Object({ expectedRevision: Type.Integer() });
export type DeleteNode = Static<typeof DeleteNode>;

export const CreateConnection = Type.Object({
  expectedRevision: Type.Integer(),
  sourceNodeId: Id,
  targetNodeId: Type.Optional(Id),
  targetRef: Type.Optional(Type.String({ minLength: 1 })),
  label: Type.Optional(Type.String()),
});
export type CreateConnection = Static<typeof CreateConnection>;
// ---------- WebSocket ----------
// cliente -> runtime
export const WsClientMessage = Type.Union([
  Type.Object({ type: Type.Literal("subscribe"), workspaceId: Id }),
  Type.Object({ type: Type.Literal("attach"), sessionId: Id }),
  Type.Object({ type: Type.Literal("detach"), sessionId: Id }),
  Type.Object({ type: Type.Literal("input"), sessionId: Id, data: Type.String() }),
  Type.Object({ type: Type.Literal("resize"), sessionId: Id, cols: Type.Integer(), rows: Type.Integer() }),
  Type.Object({ type: Type.Literal("acquireLease"), sessionId: Id }),
  Type.Object({ type: Type.Literal("releaseLease"), sessionId: Id }),
]);
export type WsClientMessage = Static<typeof WsClientMessage>;

// runtime -> cliente
export const WsServerMessage = Type.Union([
  Type.Object({ type: Type.Literal("hello"), clientId: Id, protocolVersion: Type.Integer() }),
  Type.Object({ type: Type.Literal("snapshot"), sessionId: Id, sequence: Type.Integer(), data: Type.String(), session: Session }),
  Type.Object({ type: Type.Literal("output"), sessionId: Id, sequence: Type.Integer(), data: Type.String() }),
  Type.Object({ type: Type.Literal("session"), session: Session }),
  Type.Object({ type: Type.Literal("workspace"), snapshot: WorkspaceSnapshot }),
  Type.Object({ type: Type.Literal("sidebar"), sidebar: Sidebar }),
  Type.Object({ type: Type.Literal("chat"), message: ChatMessage }),
  Type.Object({ type: Type.Literal("message"), message: Message }),
  Type.Object({ type: Type.Literal("taskFinished"), event: TaskFinished }),
  Type.Object({ type: Type.Literal("taskSummary"), summary: TaskSummary }),
  Type.Object({ type: Type.Literal("floorHook"), workspaceId: Id, status: FloorHookStatus }),
  Type.Object({ type: Type.Literal("error"), error: ApiError, sessionId: Type.Optional(Id) }),
]);
export type WsServerMessage = Static<typeof WsServerMessage>;

// ---------- Presets de terminal ----------
/** Anexo salvo pelo runtime em disco (imagens e arquivos do compositor). */
export const CreateAttachment = Type.Object({ name: Type.String({ minLength: 1, maxLength: 200 }), dataBase64: Type.String() });
export type CreateAttachment = Static<typeof CreateAttachment>;
export const Attachment = Type.Object({ attachmentId: Id, workspaceId: Id, name: Type.String(), path: Type.String(), size: Type.Integer(), createdAt: Type.String() });
export type Attachment = Static<typeof Attachment>;
export const FileEntry = Type.Object({ path: Type.String(), dir: Type.Boolean() });
export type FileEntry = Static<typeof FileEntry>;
/** Entrada da árvore de arquivos (relativa ao diretório do espaço). */
export const TreeEntry = Type.Object({ name: Type.String(), path: Type.String(), dir: Type.Boolean(), size: Type.Integer(), mtime: Type.String(), git: Type.Optional(Type.String()) });
export type TreeEntry = Static<typeof TreeEntry>;
export const FileContent = Type.Object({ path: Type.String(), size: Type.Integer(), binary: Type.Boolean(), text: Type.Optional(Type.String()), truncated: Type.Boolean() });
export type FileContent = Static<typeof FileContent>;
export const FsOp = Type.Object({ op: Type.Union([Type.Literal("mkdir"), Type.Literal("touch"), Type.Literal("rename"), Type.Literal("delete"), Type.Literal("write")]), path: Type.String({ minLength: 1 }), to: Type.Optional(Type.String({ minLength: 1 })), text: Type.Optional(Type.String()) });
export type FsOp = Static<typeof FsOp>;
export const SearchHit = Type.Object({ path: Type.String(), line: Type.Optional(Type.Integer()), text: Type.Optional(Type.String()) });
export type SearchHit = Static<typeof SearchHit>;
// #41 — busca de texto (FTS5) em notas/textos e chats: GET /v1/find?q=&workspaceId=&kinds=note,chat
export const FindKind = Type.Union([Type.Literal("note"), Type.Literal("chat"), Type.Literal("node")]); // node = título de qualquer nó (#69)
export type FindKind = Static<typeof FindKind>;
export const FindHit = Type.Object({ kind: FindKind, refId: Id, workspaceId: Id, nodeId: Id, nodeTitle: Type.String(), title: Type.String(), snippet: Type.String() });
export type FindHit = Static<typeof FindHit>;
// #69 — atenção global: quem espera você, em todos os espaços. GET /v1/attention · POST /v1/nodes/:id/seen
export const AttentionKind = Type.Union([Type.Literal("finished"), Type.Literal("unread"), Type.Literal("exited"), Type.Literal("lost")]);
export type AttentionKind = Static<typeof AttentionKind>;
export const AttentionItem = Type.Object({ kind: AttentionKind, nodeId: Id, workspaceId: Id, workspaceName: Type.String(), title: Type.String(), at: Type.Optional(Type.String()), count: Type.Optional(Type.Integer()) });
export type AttentionItem = Static<typeof AttentionItem>;

// #56 — presets de Início rápido: editáveis e persistidos no runtime. `theme` é o tema do xterm do terminal criado.
export const PresetInput = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 40, pattern: "^[a-z0-9][a-z0-9-]*$" }),
  label: Type.String({ minLength: 1, maxLength: 60 }),
  command: Type.String({ minLength: 1, maxLength: 300 }),
  args: Type.Array(Type.String({ maxLength: 4000 }), { maxItems: 50 }),
  enabled: Type.Boolean(),
  icon: Type.String({ maxLength: 40 }), // "" = ícone do agente deduzido pelo comando
  color: Type.String({ maxLength: 12 }), // "" = sem cor
  maestro: Type.Boolean(), // #29 o terminal criado por este preset já nasce condutor (Modo Maestro)
  target: PresetTarget,
  theme: TermTheme,
});
export type PresetInput = Static<typeof PresetInput>;
export const Preset = Type.Object({ ...PresetInput.properties, available: Type.Boolean(), builtin: Type.Boolean() });
export type Preset = Static<typeof Preset>;
export const PutPresets = Type.Object({ presets: Type.Array(PresetInput, { maxItems: 20 }) });
export type PutPresets = Static<typeof PutPresets>;

// ---------- Variáveis injetadas em terminais (ADR-0008) ----------
export const AGENT_ENV = {
  socket: "MESS_SOCKET",
  token: "MESS_TOKEN",
  workspaceId: "MESS_WORKSPACE_ID",
  workspaceName: "MESS_WORKSPACE_NAME",
  workspaceDir: "MESS_WORKSPACE_DIR",
  nodeId: "MESS_NODE_ID",
  floorId: "MESS_FLOOR_ID",
  floorName: "MESS_FLOOR_NAME",
  floorBranch: "MESS_FLOOR_BRANCH",
  branchName: "MESS_BRANCH_NAME",
  floorPath: "MESS_FLOOR_PATH",
  rootPath: "MESS_ROOT_PATH",
  projectName: "MESS_PROJECT_NAME",
  hookSection: "MESS_HOOK_SECTION",
  roleName: "MESS_ROLE",
  roleInstructions: "MESS_ROLE_INSTRUCTIONS",
  sessionId: "MESS_SESSION_ID",
  skills: "MESS_SKILLS", // #57 nomes das habilidades anexadas, separados por vírgula
  skillsText: "MESS_SKILLS_TEXT", // #57 instruções completas das habilidades
  maestro: "MESS_MAESTRO", // #29 "1" quando o terminal é condutor
} as const;

// #57 — Skills: conjuntos de instruções reutilizáveis anexáveis a um terminal (vários por nó), injetadas como o papel.
export const Skill = Type.Object({ skillId: Id, name: Type.String(), description: Type.String(), instructions: Type.String(), createdAt: Type.String(), updatedAt: Type.String() });
export type Skill = Static<typeof Skill>;
export const CreateSkill = Type.Object({ name: Type.String({ minLength: 1, maxLength: 60 }), description: Type.Optional(Type.String({ maxLength: 200 })), instructions: Type.String({ maxLength: 20000 }) });
export type CreateSkill = Static<typeof CreateSkill>;
export const PatchSkill = Type.Object({ name: Type.Optional(Type.String({ minLength: 1, maxLength: 60 })), description: Type.Optional(Type.String({ maxLength: 200 })), instructions: Type.Optional(Type.String({ maxLength: 20000 })) });
export type PatchSkill = Static<typeof PatchSkill>;

// ---------- #71 Partituras: arranjos do canvas salvos para recolocar em qualquer espaço/andar ----------
export const ScoreNode = Type.Object({
  key: Type.String(), // id local do arquivo da partitura (liga as conexões)
  kind: NodeKind, title: Type.String(), geometry: Geometry, // geometria RELATIVA ao canto superior esquerdo do arranjo
  content: Type.Optional(Type.String()), color: Type.Optional(Type.String()), icon: Type.Optional(Type.String()), termTheme: Type.Optional(Type.String()),
  roleName: Type.Optional(Type.String()), skillNames: Type.Optional(Type.Array(Type.String())), // por NOME: o id é do banco de quem salvou
  command: Type.Optional(Type.String()), args: Type.Optional(Type.Array(Type.String())), cwd: Type.Optional(Type.String()), persistent: Type.Optional(Type.Boolean()),
});
export type ScoreNode = Static<typeof ScoreNode>;
export const ScoreConnection = Type.Object({ from: Type.String(), to: Type.String(), style: Type.Optional(Type.String()) });
export type ScoreConnection = Static<typeof ScoreConnection>;
export const Score = Type.Object({ scoreId: Id, name: Type.String(), description: Type.String(), nodes: Type.Array(ScoreNode), connections: Type.Array(ScoreConnection), createdAt: Type.String() });
export type Score = Static<typeof Score>;
export const SaveScore = Type.Object({ expectedRevision: Type.Integer(), nodeIds: Type.Optional(Type.Array(Id, { maxItems: 200 })), name: Type.String({ minLength: 1, maxLength: 60 }), description: Type.Optional(Type.String({ maxLength: 200 })) }); // sem nodeIds = o espaço todo
export type SaveScore = Static<typeof SaveScore>;
export const PatchScore = Type.Object({ name: Type.Optional(Type.String({ minLength: 1, maxLength: 60 })), description: Type.Optional(Type.String({ maxLength: 200 })) });
export type PatchScore = Static<typeof PatchScore>;
export const PlaceScore = Type.Object({ expectedRevision: Type.Integer(), at: Type.Object({ x: Type.Number(), y: Type.Number() }) });
export type PlaceScore = Static<typeof PlaceScore>;
export type PlaceScoreResult = { nodeIds: string[]; connectionIds: string[]; warnings: string[]; revision: number };

// ---------- #72 Ambientes: variáveis de ambiente por espaço/global ----------
export const EnvVarEntry = Type.Object({
  key: Type.String({ minLength: 1, maxLength: 120 }),
  value: Type.String({ maxLength: 20000 }),
  secret: Type.Optional(Type.Boolean()),
});
export type EnvVarEntry = Static<typeof EnvVarEntry>;
export const PutEnvVarsInput = Type.Object({
  vars: Type.Array(EnvVarEntry, { maxItems: 200 }),
});
export type PutEnvVarsInput = Static<typeof PutEnvVarsInput>;
export const EnvironmentsState = Type.Object({
  global: Type.Array(EnvVarEntry),
  workspaces: Type.Record(Type.String(), Type.Array(EnvVarEntry)),
});
export type EnvironmentsState = Static<typeof EnvironmentsState>;

// ---------- #83 Exportar/importar espaço (.messai) e duplicar ----------
export const WORKSPACE_BUNDLE_FORMAT = "messai.workspace.v1" as const;
export const BundleNode = Type.Object({
  key: Type.String(),
  kind: NodeKind,
  title: Type.String(),
  geometry: Geometry,
  content: Type.Optional(Type.String()),
  color: Type.Optional(Type.String()),
  locked: Type.Optional(Type.Boolean()),
  icon: Type.Optional(Type.String()),
  termTheme: Type.Optional(Type.String()),
  maestro: Type.Optional(Type.Boolean()),
  memLimitMb: Type.Optional(Type.Integer()),
  roleName: Type.Optional(Type.String()),
  skillNames: Type.Optional(Type.Array(Type.String())),
  groupKey: Type.Optional(Type.String()),
  command: Type.Optional(Type.String()),
  args: Type.Optional(Type.Array(Type.String())),
  cwd: Type.Optional(Type.String()),
  persistent: Type.Optional(Type.Boolean()),
});
export type BundleNode = Static<typeof BundleNode>;
export const BundleConnection = Type.Object({
  from: Type.String(),
  to: Type.String(),
  label: Type.Optional(Type.String()),
  style: Type.Optional(Type.Union([Type.Literal("rope"), Type.Literal("circuit")])),
});
export type BundleConnection = Static<typeof BundleConnection>;
export const BundleGroup = Type.Object({
  key: Type.String(),
  label: Type.String(),
  color: Type.String(),
});
export type BundleGroup = Static<typeof BundleGroup>;
export const BundleBand = Type.Object({
  name: Type.String(),
  color: Type.String(),
  memberKeys: Type.Array(Type.String()),
});
export type BundleBand = Static<typeof BundleBand>;
export const BundleDrawing = Type.Object({
  kind: Drawing.properties.kind,
  points: Type.Array(Point, { minItems: 2 }),
  color: Type.String(),
  width: Type.Number(),
  groupId: Type.Optional(Type.String()),
});
export type BundleDrawing = Static<typeof BundleDrawing>;
export const WorkspaceBundle = Type.Object({
  format: Type.Literal(WORKSPACE_BUNDLE_FORMAT),
  exportedAt: Type.String(),
  workspace: Type.Object({
    name: Type.String(),
    cwd: Type.String(),
    icon: Type.String(),
    color: Type.String(),
  }),
  nodes: Type.Array(BundleNode),
  connections: Type.Array(BundleConnection),
  groups: Type.Array(BundleGroup),
  bands: Type.Array(BundleBand),
  drawings: Type.Array(BundleDrawing),
  roles: Type.Array(CreateRole),
  skills: Type.Array(CreateSkill),
  envVars: Type.Array(EnvVarEntry),
  hooks: Type.Optional(FloorHooksConfig),
  excludeDirs: Type.Optional(Type.Array(Type.String())),
});
export type WorkspaceBundle = Static<typeof WorkspaceBundle>;
export const WorkspaceBundlePreview = Type.Object({
  valid: Type.Boolean(),
  name: Type.String(),
  cwd: Type.String(),
  exportedAt: Type.String(),
  counts: Type.Object({
    nodes: Type.Integer(),
    terminals: Type.Integer(),
    notes: Type.Integer(),
    binders: Type.Integer(),
    connections: Type.Integer(),
    groups: Type.Integer(),
    bands: Type.Integer(),
    drawings: Type.Integer(),
    roles: Type.Integer(),
    skills: Type.Integer(),
    envVars: Type.Integer(),
    secrets: Type.Integer(),
  }),
  nodeTitles: Type.Array(Type.String()),
  roleNames: Type.Array(Type.String()),
  skillNames: Type.Array(Type.String()),
  envKeys: Type.Array(Type.String()),
  warnings: Type.Array(Type.String()),
});
export type WorkspaceBundlePreview = Static<typeof WorkspaceBundlePreview>;
export const PreviewWorkspaceImportInput = Type.Object({
  bundle: WorkspaceBundle,
});
export type PreviewWorkspaceImportInput = Static<typeof PreviewWorkspaceImportInput>;
export const ImportWorkspaceInput = Type.Object({
  bundle: WorkspaceBundle,
  name: Type.Optional(Type.String({ minLength: 1 })),
  cwd: Type.Optional(Type.String({ minLength: 1 })),
  folderId: Type.Optional(Id),
  includeEnv: Type.Optional(Type.Boolean()),
  startTerminals: Type.Optional(Type.Boolean()),
});
export type ImportWorkspaceInput = Static<typeof ImportWorkspaceInput>;
export const DuplicateWorkspaceInput = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1 })),
  cwd: Type.Optional(Type.String({ minLength: 1 })),
  folderId: Type.Optional(Id),
  startTerminals: Type.Optional(Type.Boolean()),
});
export type DuplicateWorkspaceInput = Static<typeof DuplicateWorkspaceInput>;



