import { Type, type Static } from "@sinclair/typebox";

export const PROTOCOL_VERSION = 1 as const;
/** Incrementar a cada mudança de snapshot/rotas; o cliente avisa quando o runtime está atrás. */
export const BUILD_VERSION = 17 as const;

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

export const NodeKind = Type.Union([Type.Literal("terminal"), Type.Literal("note"), Type.Literal("text"), Type.Literal("tree")]);
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
  createdAt: Type.String(),
});
export type Node = Static<typeof Node>;
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
  floorType: Type.Optional(Type.Union([Type.Literal("worktree"), Type.Literal("none")])),
  status: Type.Optional(Type.Union([Type.Literal("working"), Type.Literal("blocked"), Type.Literal("review"), Type.Literal("done")])),
  statusText: Type.Optional(Type.String()),
});
export type Workspace = Static<typeof Workspace>;
export const FloorStatus = Type.Union([Type.Literal("working"), Type.Literal("blocked"), Type.Literal("review"), Type.Literal("done")]);
export type FloorStatus = Static<typeof FloorStatus>;
/** Criar andar a partir do térreo: branch nova ou existente, worktree git (padrão) ou sem isolamento (mesmo diretório). */
export const CreateFloor = Type.Object({
  name: Type.String({ minLength: 1 }),
  branch: Type.Optional(Type.String({ minLength: 1 })),
  newBranch: Type.Optional(Type.Boolean()),
  base: Type.Optional(Type.String()),
  floorType: Type.Optional(Type.Union([Type.Literal("worktree"), Type.Literal("none")])),
  path: Type.Optional(Type.String({ minLength: 1 })),
  cloneLayout: Type.Optional(Type.Boolean()),
});
export type CreateFloor = Static<typeof CreateFloor>;
export const LandFloor = Type.Object({ mode: Type.Optional(Type.Union([Type.Literal("merge"), Type.Literal("squash")])), keepFloor: Type.Optional(Type.Boolean()), deleteBranch: Type.Optional(Type.Boolean()) });
export type LandFloor = Static<typeof LandFloor>;
export const LandResult = Type.Object({ ok: Type.Boolean(), merged: Type.Boolean(), conflicts: Type.Array(Type.String()), output: Type.String(), removed: Type.Boolean() });
export type LandResult = Static<typeof LandResult>;

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

export const WorkspaceSnapshot = Type.Object({
  workspace: Workspace,
  nodes: Type.Array(Node),
  connections: Type.Array(Connection),
  drawings: Type.Array(Drawing),
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
export const ChatMessage = Type.Object({ chatId: Id, workspaceId: Id, nodeId: Id, thread: Type.Integer({ minimum: 1, maximum: 7 }), role: ChatRole, text: Type.String(), createdAt: Type.String() });
export type ChatMessage = Static<typeof ChatMessage>;
// O papel NÃO vem do cliente (segurança MESS-03): o servidor deriva do canal autenticado (http=user, socket=agent).
export const SendChat = Type.Object({ text: Type.String({ minLength: 1 }), thread: Type.Optional(Type.Integer({ minimum: 1, maximum: 7 })) });
export type SendChat = Static<typeof SendChat>;

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
  targetNodeId: Id,
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

// #56 — presets de Início rápido: editáveis e persistidos no runtime. `theme` é o tema do xterm do terminal criado.
export const PresetInput = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 40, pattern: "^[a-z0-9][a-z0-9-]*$" }),
  label: Type.String({ minLength: 1, maxLength: 60 }),
  command: Type.String({ minLength: 1, maxLength: 300 }),
  args: Type.Array(Type.String({ maxLength: 4000 }), { maxItems: 50 }),
  enabled: Type.Boolean(),
  icon: Type.String({ maxLength: 40 }), // "" = ícone do agente deduzido pelo comando
  color: Type.String({ maxLength: 12 }), // "" = sem cor
  maestro: Type.Boolean(), // promove o terminal a condutor (#29) — só guardado por enquanto
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
  floorName: "MESS_FLOOR_NAME",
  branchName: "MESS_BRANCH_NAME",
  floorPath: "MESS_FLOOR_PATH",
  rootPath: "MESS_ROOT_PATH",
  projectName: "MESS_PROJECT_NAME",
  roleName: "MESS_ROLE",
  roleInstructions: "MESS_ROLE_INSTRUCTIONS",
  sessionId: "MESS_SESSION_ID",
  skills: "MESS_SKILLS", // #57 nomes das habilidades anexadas, separados por vírgula
  skillsText: "MESS_SKILLS_TEXT", // #57 instruções completas das habilidades
} as const;

// #57 — Skills: conjuntos de instruções reutilizáveis anexáveis a um terminal (vários por nó), injetadas como o papel.
export const Skill = Type.Object({ skillId: Id, name: Type.String(), description: Type.String(), instructions: Type.String(), createdAt: Type.String(), updatedAt: Type.String() });
export type Skill = Static<typeof Skill>;
export const CreateSkill = Type.Object({ name: Type.String({ minLength: 1, maxLength: 60 }), description: Type.Optional(Type.String({ maxLength: 200 })), instructions: Type.String({ maxLength: 20000 }) });
export type CreateSkill = Static<typeof CreateSkill>;
export const PatchSkill = Type.Object({ name: Type.Optional(Type.String({ minLength: 1, maxLength: 60 })), description: Type.Optional(Type.String({ maxLength: 200 })), instructions: Type.Optional(Type.String({ maxLength: 20000 })) });
export type PatchSkill = Static<typeof PatchSkill>;
