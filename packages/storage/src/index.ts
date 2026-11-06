import Database from "better-sqlite3";
import type { ChatMessage, Connection, Drawing, Folder, Message, Node, Role, Session, Workspace, Skill, NodeGroup, Score, Band, NodeIsolation, Approval } from "@messai/contracts";

/** Migração por função (idempotente). */
const LATE_SCHEMA = Symbol("late");
const MIGRATIONS: (string | typeof LATE_SCHEMA)[] = [
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS workspaces (
     workspace_id TEXT PRIMARY KEY, machine_id TEXT NOT NULL, name TEXT NOT NULL,
     cwd TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS nodes (
     node_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
     kind TEXT NOT NULL, title TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL, w REAL NOT NULL, h REAL NOT NULL,
     session_id TEXT, content TEXT, created_at TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS nodes_ws ON nodes(workspace_id);
   CREATE TABLE IF NOT EXISTS sessions (
     session_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, node_id TEXT NOT NULL,
     command TEXT NOT NULL, args TEXT NOT NULL, cwd TEXT NOT NULL, state TEXT NOT NULL,
     pid INTEGER, exit_code INTEGER, cols INTEGER NOT NULL, rows INTEGER NOT NULL, created_at TEXT NOT NULL);`,
  `CREATE TABLE IF NOT EXISTS connections (
     connection_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
     source_node_id TEXT NOT NULL REFERENCES nodes(node_id) ON DELETE CASCADE,
     target_node_id TEXT NOT NULL REFERENCES nodes(node_id) ON DELETE CASCADE,
     label TEXT, created_at TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS conn_ws ON connections(workspace_id);`,
  `CREATE TABLE IF NOT EXISTS messages (
     message_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
     from_node_id TEXT NOT NULL, to_node_id TEXT NOT NULL, text TEXT NOT NULL, reply_to TEXT,
     created_at TEXT NOT NULL, read_at TEXT, delivered INTEGER NOT NULL DEFAULT 0);
   CREATE INDEX IF NOT EXISTS msg_to ON messages(to_node_id, read_at);`,
  `CREATE TABLE IF NOT EXISTS drawings (
     drawing_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
     kind TEXT NOT NULL, points TEXT NOT NULL, color TEXT NOT NULL, width REAL NOT NULL, created_at TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS drw_ws ON drawings(workspace_id);`,
  `CREATE TABLE IF NOT EXISTS folders (
     folder_id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'folder', parent_id TEXT,
     sort_order REAL NOT NULL DEFAULT 0, collapsed INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
   ALTER TABLE workspaces ADD COLUMN icon TEXT NOT NULL DEFAULT 'folder';
   ALTER TABLE workspaces ADD COLUMN color TEXT NOT NULL DEFAULT '#8a93a6';
   ALTER TABLE workspaces ADD COLUMN folder_id TEXT;
   ALTER TABLE workspaces ADD COLUMN sort_order REAL NOT NULL DEFAULT 0;
   UPDATE workspaces SET sort_order = (SELECT COUNT(*) FROM workspaces w2 WHERE w2.created_at < workspaces.created_at);`,
  `CREATE TABLE IF NOT EXISTS chats (
     chat_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
     node_id TEXT NOT NULL, thread INTEGER NOT NULL DEFAULT 1, role TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS chats_node ON chats(node_id, thread, created_at);`,
  `CREATE TABLE IF NOT EXISTS roles (
     role_id TEXT PRIMARY KEY, name TEXT NOT NULL, badge TEXT NOT NULL DEFAULT '', instructions TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
   ALTER TABLE nodes ADD COLUMN role_id TEXT;`,
  `ALTER TABLE nodes ADD COLUMN locked INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE nodes ADD COLUMN color TEXT;
   ALTER TABLE nodes ADD COLUMN file_path TEXT;
   ALTER TABLE nodes ADD COLUMN title_auto INTEGER NOT NULL DEFAULT 1;`,
  `ALTER TABLE connections ADD COLUMN style TEXT NOT NULL DEFAULT 'rope';`,
  `ALTER TABLE sessions ADD COLUMN persistent INTEGER NOT NULL DEFAULT 0;`,
  `ALTER TABLE workspaces ADD COLUMN parent_id TEXT;
   ALTER TABLE workspaces ADD COLUMN branch TEXT;
   ALTER TABLE workspaces ADD COLUMN floor_type TEXT;
   ALTER TABLE workspaces ADD COLUMN status TEXT;
   ALTER TABLE workspaces ADD COLUMN status_text TEXT;`,
  `ALTER TABLE drawings ADD COLUMN group_id TEXT;`,
  `ALTER TABLE sessions ADD COLUMN resume_id TEXT;`, // id de sessão do CLI de IA, para retomar após reboot
  `ALTER TABLE nodes ADD COLUMN icon TEXT;
   ALTER TABLE nodes ADD COLUMN term_theme TEXT;`, // #56 aparência do terminal (preset / edição no nó)
  // Passo idempotente (ver lateSchema): substitui as migrações #41/#78/#71/#57, que foram inseridas fora de ordem e quebravam bancos já migrados.
  LATE_SCHEMA,
  // Fase 4 (sempre no FIM): bandas #70 · condutor #29 e limite de memória #80 por nó. Cada passo roda uma vez (versão numerada).
  `CREATE TABLE IF NOT EXISTS bands (
     band_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
     name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '', node_ids TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL);`,
  `ALTER TABLE nodes ADD COLUMN maestro INTEGER NOT NULL DEFAULT 0;`,
  `ALTER TABLE nodes ADD COLUMN mem_limit_mb INTEGER;`,
  `ALTER TABLE chats ADD COLUMN attachments TEXT;`, // #79 anexos do chat (JSON)
  `ALTER TABLE workspaces ADD COLUMN copy_mode TEXT;
   ALTER TABLE workspaces ADD COLUMN exclude_dirs TEXT;`, // #81 cópia isolada (CoW/independente) e pastas excluídas
  `ALTER TABLE workspaces ADD COLUMN unloaded INTEGER NOT NULL DEFAULT 0;`, // #84 espaço descarregado (poupar CPU/RAM)
  // Fase 7/8 (sempre no FIM): #93 modo isolado por nó (JSON) e pedidos de aprovação humana de capacidades.
  `ALTER TABLE nodes ADD COLUMN isolation TEXT;`,
  `CREATE TABLE IF NOT EXISTS approvals (
     approval_id TEXT PRIMARY KEY, node_id TEXT NOT NULL REFERENCES nodes(node_id) ON DELETE CASCADE, workspace_id TEXT NOT NULL,
     capability TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, decided_at TEXT);`,
  `ALTER TABLE nodes ADD COLUMN secret INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE nodes ADD COLUMN secret_env TEXT;`, // nota secreta: valor mascarado no canvas/para agentes; injetado como env no agente ligado
];

/**
 * Esquema "tardio" (busca FTS5 #41, grupos de nós #78, partituras #71, habilidades #57). Estas migrações foram inseridas FORA DE ORDEM
 * na lista numerada; como o banco só guarda um número de versão, quem já tinha migrado numa ordem reexecutava ALTER TABLE já feito
 * ("duplicate column name") e o runtime nem subia. Agora tudo é idempotente (IF NOT EXISTS / coluna só se faltar) e roda uma vez por
 * banco; bancos antigos (qualquer ordem anterior) são normalizados no primeiro boot. NOVAS migrações vão SEMPRE no fim da lista.
 */
function lateSchema(db: Database.Database): void {
  const hasCol = (t: string, c: string) => (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).some((r) => r.name === c);
  const hasTable = (t: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type IN ('table') AND name=?").get(t);
  db.exec(`CREATE TABLE IF NOT EXISTS node_groups (
     group_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
     label TEXT NOT NULL DEFAULT '', color TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS scores (
     score_id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', data TEXT NOT NULL, created_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS skills (
     skill_id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', instructions TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`);
  if (!hasCol("nodes", "skill_ids")) db.exec("ALTER TABLE nodes ADD COLUMN skill_ids TEXT;");
  if (!hasCol("nodes", "group_id")) db.exec("ALTER TABLE nodes ADD COLUMN group_id TEXT REFERENCES node_groups(group_id) ON DELETE SET NULL;");
  if (!hasCol("nodes", "icon")) db.exec("ALTER TABLE nodes ADD COLUMN icon TEXT;");
  if (!hasCol("nodes", "term_theme")) db.exec("ALTER TABLE nodes ADD COLUMN term_theme TEXT;");
  const fresh = !hasTable("search");
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(kind UNINDEXED, ref_id UNINDEXED, workspace_id UNINDEXED, node_id UNINDEXED, title, body, tokenize='unicode61 remove_diacritics 2');`);
  if (fresh) db.exec(`INSERT INTO search(kind, ref_id, workspace_id, node_id, title, body) SELECT 'note', node_id, workspace_id, node_id, title, COALESCE(content,'') FROM nodes WHERE kind IN ('note','text');
INSERT INTO search(kind, ref_id, workspace_id, node_id, title, body) SELECT 'chat', chat_id, workspace_id, node_id, '', text FROM chats WHERE role <> 'system';`); // backfill só quando o índice acabou de ser criado (senão duplicaria)
  db.exec(`   CREATE TRIGGER IF NOT EXISTS search_node_ai AFTER INSERT ON nodes WHEN new.kind IN ('note','text') BEGIN
     INSERT INTO search(kind, ref_id, workspace_id, node_id, title, body) VALUES ('note', new.node_id, new.workspace_id, new.node_id, new.title, COALESCE(new.content,'')); END;
   CREATE TRIGGER IF NOT EXISTS search_node_au AFTER UPDATE OF title, content ON nodes WHEN new.kind IN ('note','text') BEGIN
     DELETE FROM search WHERE kind='note' AND ref_id=new.node_id;
     INSERT INTO search(kind, ref_id, workspace_id, node_id, title, body) VALUES ('note', new.node_id, new.workspace_id, new.node_id, new.title, COALESCE(new.content,'')); END;
   CREATE TRIGGER IF NOT EXISTS search_node_ad AFTER DELETE ON nodes BEGIN
     DELETE FROM search WHERE kind='note' AND ref_id=old.node_id; DELETE FROM search WHERE kind='chat' AND node_id=old.node_id; END;
   CREATE TRIGGER IF NOT EXISTS search_chat_ai AFTER INSERT ON chats WHEN new.role <> 'system' BEGIN
     INSERT INTO search(kind, ref_id, workspace_id, node_id, title, body) VALUES ('chat', new.chat_id, new.workspace_id, new.node_id, '', new.text); END;
   CREATE TRIGGER IF NOT EXISTS search_chat_ad AFTER DELETE ON chats BEGIN DELETE FROM search WHERE kind='chat' AND ref_id=old.chat_id; END;`);
}
type DrwRow = { drawing_id: string; workspace_id: string; kind: Drawing["kind"]; points: string; color: string; width: number; created_at: string; group_id: string | null };
const drwFrom = (r: DrwRow): Drawing => ({ drawingId: r.drawing_id, workspaceId: r.workspace_id, kind: r.kind, points: JSON.parse(r.points) as Drawing["points"], color: r.color, width: r.width, createdAt: r.created_at, ...(r.group_id ? { groupId: r.group_id } : {}) });
type MsgRow = { message_id: string; workspace_id: string; from_node_id: string; to_node_id: string; text: string; reply_to: string | null; created_at: string; read_at: string | null; delivered: number };
const msgFrom = (r: MsgRow): Message => ({ messageId: r.message_id, workspaceId: r.workspace_id, fromNodeId: r.from_node_id, toNodeId: r.to_node_id, text: r.text, createdAt: r.created_at, delivered: r.delivered === 1, ...(r.reply_to ? { replyTo: r.reply_to } : {}), ...(r.read_at ? { readAt: r.read_at } : {}) });
type ConnRow = { connection_id: string; workspace_id: string; source_node_id: string; target_node_id: string; label: string | null; created_at: string; style: Connection["style"] | null };
const connFrom = (r: ConnRow): Connection => ({ connectionId: r.connection_id, workspaceId: r.workspace_id, sourceNodeId: r.source_node_id, targetNodeId: r.target_node_id, createdAt: r.created_at, ...(r.label !== null ? { label: r.label } : {}), ...(r.style ? { style: r.style } : {}) });

type WsRow = { workspace_id: string; machine_id: string; name: string; cwd: string; icon: string; color: string; folder_id: string | null; sort_order: number; revision: number; created_at: string; parent_id: string | null; branch: string | null; floor_type: Workspace["floorType"] | null; copy_mode?: Workspace["copyMode"] | null; exclude_dirs?: string | null; status: Workspace["status"] | null; status_text: string | null; unloaded?: number };
type ChatRow = { chat_id: string; workspace_id: string; node_id: string; thread: number; role: ChatMessage["role"]; text: string; created_at: string; attachments?: string | null };
const chatAtt = (raw: string | null | undefined): ChatMessage["attachments"] => { if (!raw) return undefined; try { const j = JSON.parse(raw) as ChatMessage["attachments"]; return Array.isArray(j) && j.length ? j : undefined; } catch { return undefined; } };
const chatFrom = (r: ChatRow): ChatMessage => ({ chatId: r.chat_id, workspaceId: r.workspace_id, nodeId: r.node_id, thread: r.thread, role: r.role, text: r.text, createdAt: r.created_at, ...(chatAtt(r.attachments) ? { attachments: chatAtt(r.attachments)! } : {}) });
type FolderRow = { folder_id: string; name: string; kind: Folder["kind"]; parent_id: string | null; sort_order: number; collapsed: number; created_at: string };
const folderFrom = (r: FolderRow): Folder => ({ folderId: r.folder_id, name: r.name, kind: r.kind, sortOrder: r.sort_order, collapsed: r.collapsed === 1, createdAt: r.created_at, ...(r.parent_id ? { parentId: r.parent_id } : {}) });
/** #93 JSON salvo → NodeIsolation válido (lixo vira modo confiável, nunca um sandbox pela metade). */
const parseIsolation = (raw: string | null | undefined): NodeIsolation | undefined => {
  if (!raw) return undefined;
  try {
    const j = JSON.parse(raw) as Partial<NodeIsolation>;
    if (j.network !== "none" && j.network !== "host") return undefined;
    const strs = (a: unknown) => (Array.isArray(a) ? a.filter((x): x is string => typeof x === "string" && x.length > 0) : undefined);
    return { network: j.network, ...(strs(j.ro)?.length ? { ro: strs(j.ro)! } : {}), ...(strs(j.rw)?.length ? { rw: strs(j.rw)! } : {}), ...(typeof j.memoryMaxMb === "number" ? { memoryMaxMb: j.memoryMaxMb } : {}), ...(typeof j.tasksMax === "number" ? { tasksMax: j.tasksMax } : {}) };
  } catch { return undefined; }
};
type ApprovalRow = { approval_id: string; node_id: string; workspace_id: string; capability: string; reason: string; status: string; created_at: string; decided_at: string | null; nt: string };
const approvalFrom = (r: ApprovalRow): Approval => ({ approvalId: r.approval_id, nodeId: r.node_id, workspaceId: r.workspace_id, nodeTitle: r.nt, capability: r.capability as Approval["capability"], reason: r.reason, status: r.status as Approval["status"], createdAt: r.created_at, ...(r.decided_at ? { decidedAt: r.decided_at } : {}) });
type NodeRow = { node_id: string; workspace_id: string; kind: Node["kind"]; title: string; x: number; y: number; w: number; h: number; session_id: string | null; content: string | null; created_at: string; role_id: string | null; locked: number; color: string | null; icon: string | null; term_theme: string | null; skill_ids: string | null; group_id: string | null; file_path: string | null; title_auto: number; maestro?: number; mem_limit_mb?: number | null; isolation?: string | null; secret?: number; secret_env?: string | null };
type SkillRow = { skill_id: string; name: string; description: string; instructions: string; created_at: string; updated_at: string };
const skillFrom = (r: SkillRow): Skill => ({ skillId: r.skill_id, name: r.name, description: r.description, instructions: r.instructions, createdAt: r.created_at, updatedAt: r.updated_at });
const parseIds = (raw: string | null): string[] | undefined => { if (!raw) return undefined; try { const j = JSON.parse(raw) as unknown; return Array.isArray(j) && j.length ? j.filter((x): x is string => typeof x === "string") : undefined; } catch { return undefined; } };
type ScoreRow = { score_id: string; name: string; description: string; data: string; created_at: string };
const scoreFrom = (r: ScoreRow): Score => { let d: { nodes?: Score["nodes"]; connections?: Score["connections"] } = {}; try { d = JSON.parse(r.data) as typeof d; } catch { /* partitura corrompida: vazia */ } return { scoreId: r.score_id, name: r.name, description: r.description, nodes: d.nodes ?? [], connections: d.connections ?? [], createdAt: r.created_at }; };
type BandRow = { band_id: string; workspace_id: string; name: string; color: string; node_ids: string; created_at: string };
const bandFrom = (r: BandRow): Band => ({ bandId: r.band_id, workspaceId: r.workspace_id, name: r.name, color: r.color, nodeIds: parseIds(r.node_ids) ?? [], asking: [], createdAt: r.created_at });
type GroupRow = { group_id: string; workspace_id: string; label: string; color: string; created_at: string };
const groupFrom = (r: GroupRow): NodeGroup => ({ groupId: r.group_id, workspaceId: r.workspace_id, label: r.label, color: r.color, createdAt: r.created_at });
type RoleRow = { role_id: string; name: string; badge: string; instructions: string; created_at: string; updated_at: string };
const roleFrom = (r: RoleRow): Role => ({ roleId: r.role_id, name: r.name, badge: r.badge, instructions: r.instructions, createdAt: r.created_at, updatedAt: r.updated_at });
type SessRow = { session_id: string; workspace_id: string; node_id: string; command: string; args: string; cwd: string; state: Session["state"]; pid: number | null; exit_code: number | null; cols: number; rows: number; created_at: string; persistent: number; resume_id: string | null };

const wsFrom = (r: WsRow): Workspace => ({ workspaceId: r.workspace_id, machineId: r.machine_id, name: r.name, cwd: r.cwd, icon: r.icon, color: r.color, sortOrder: r.sort_order, revision: r.revision, createdAt: r.created_at, ...(r.folder_id ? { folderId: r.folder_id } : {}), ...(r.parent_id ? { parentId: r.parent_id } : {}), ...(r.branch ? { branch: r.branch } : {}), ...(r.floor_type ? { floorType: r.floor_type } : {}), ...(r.copy_mode ? { copyMode: r.copy_mode } : {}), ...(parseIds(r.exclude_dirs ?? null) ? { excludeDirs: parseIds(r.exclude_dirs ?? null)! } : {}), ...(r.status ? { status: r.status } : {}), ...(r.status_text ? { statusText: r.status_text } : {}), ...(r.unloaded ? { unloaded: true } : {}) });
const nodeFrom = (r: NodeRow): Node => ({
  nodeId: r.node_id, workspaceId: r.workspace_id, kind: r.kind, title: r.title,
  geometry: { x: r.x, y: r.y, w: r.w, h: r.h }, createdAt: r.created_at,
  ...(r.session_id ? { sessionId: r.session_id } : {}),
  ...(r.role_id ? { roleId: r.role_id } : {}),
  ...(r.locked ? { locked: true } : {}),
  ...(r.color ? { color: r.color } : {}),
  ...(r.icon ? { icon: r.icon } : {}),
  ...(r.term_theme ? { termTheme: r.term_theme } : {}),
  ...(parseIds(r.skill_ids) ? { skillIds: parseIds(r.skill_ids)! } : {}),
  ...(r.group_id ? { groupId: r.group_id } : {}),
  ...(r.maestro ? { maestro: true } : {}),
  ...(r.mem_limit_mb ? { memLimitMb: r.mem_limit_mb } : {}),
  ...(parseIsolation(r.isolation) ? { isolation: parseIsolation(r.isolation)! } : {}),
  ...(r.file_path ? { filePath: r.file_path } : {}),
  ...(r.secret ? { secret: true } : {}),
  ...(r.secret_env ? { secretEnv: r.secret_env } : {}),
  ...(r.content !== null ? { content: r.content } : {}),
});
const sessFrom = (r: SessRow): Session => ({
  sessionId: r.session_id, workspaceId: r.workspace_id, nodeId: r.node_id, command: r.command,
  args: JSON.parse(r.args) as string[], cwd: r.cwd, state: r.state, cols: r.cols, rows: r.rows, createdAt: r.created_at,
  ...(r.pid !== null ? { pid: r.pid } : {}),
  ...(r.exit_code !== null ? { exitCode: r.exit_code } : {}),
  ...(r.persistent ? { persistent: true } : {}),
  ...(r.resume_id ? { resumeId: r.resume_id } : {}),
});

/** #41 Texto livre → consulta FTS5 segura: cada token vira frase entre aspas com prefixo (AND implícito); operadores do usuário são neutralizados. */
export function ftsQuery(q: string): string | null {
  const toks = q.normalize("NFKC").split(/\s+/).map((t) => t.replace(/["*()^:{}]/g, "")).filter((t) => t.length > 0);
  return toks.length ? toks.map((t) => `"${t}"*`).join(" ") : null;
}
export type SearchKind = "note" | "chat";
export type SearchRow = { kind: SearchKind; refId: string; workspaceId: string; nodeId: string; title: string; snippet: string; rank: number };

export class Store {
  readonly db: Database.Database;
  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }
  private migrate(): void {
    const v = this.db.pragma("user_version", { simple: true }) as number;
    const late = MIGRATIONS.indexOf(LATE_SCHEMA); // posição do passo idempotente
    const flagged = v > 0 && !!this.db.prepare("SELECT 1 FROM meta WHERE key='schema.late'").get();
    // Banco que passou pela cauda ANTIGA (versão > posição do passo tardio, sem a marca): normaliza de uma vez, qualquer que tenha sido a ordem.
    if (v > late && !flagged) {
      this.db.transaction(() => { lateSchema(this.db); this.setMeta("schema.late", "1"); this.db.pragma(`user_version = ${late + 1}`); })();
    }
    const from = Math.min(this.db.pragma("user_version", { simple: true }) as number, MIGRATIONS.length);
    for (let i = from; i < MIGRATIONS.length; i++) {
      this.db.transaction(() => {
        const m = MIGRATIONS[i]!;
        if (m === LATE_SCHEMA) { lateSchema(this.db); this.setMeta("schema.late", "1"); } else this.db.exec(m);
        this.db.pragma(`user_version = ${i + 1}`);
      })();
    }
  }
  close(): void { this.db.close(); }
  /** #41 Busca FTS5 em notas/textos e chats; ordena por relevância (título pesa 2×). Consulta malformada → []. */
  search(q: string, opt: { workspaceId?: string | undefined; kinds?: SearchKind[] | undefined; limit?: number | undefined } = {}): SearchRow[] {
    const m = ftsQuery(q); if (!m) return [];
    const where = ["search MATCH ?"]; const args: unknown[] = [m];
    if (opt.workspaceId) { where.push("workspace_id = ?"); args.push(opt.workspaceId); }
    if (opt.kinds?.length) { where.push(`kind IN (${opt.kinds.map(() => "?").join(",")})`); args.push(...opt.kinds); }
    const sql = `SELECT kind, ref_id refId, workspace_id workspaceId, node_id nodeId, title, CASE WHEN body <> '' THEN snippet(search, 5, '[', ']', '…', 14) ELSE title END snippet, bm25(search, 0, 0, 0, 0, 2.0, 1.0) rank FROM search WHERE ${where.join(" AND ")} ORDER BY rank LIMIT ?`;
    try { return this.db.prepare(sql).all(...args, Math.max(1, Math.min(200, opt.limit ?? 50))) as SearchRow[]; } catch { return []; }
  }
  /** #62 Cópia consistente do banco (VACUUM INTO): funciona com o runtime vivo e em WAL. O destino não pode existir. */
  backupTo(path: string): void { this.db.prepare("VACUUM INTO ?").run(path); }
  /** #62 Contagens para o manifesto do backup. */
  counts(): { workspaces: number; nodes: number; notes: number; sessions: number } {
    const n = (sql: string) => (this.db.prepare(sql).get() as { c: number }).c;
    return { workspaces: n("SELECT COUNT(*) c FROM workspaces"), nodes: n("SELECT COUNT(*) c FROM nodes"), notes: n("SELECT COUNT(*) c FROM nodes WHERE kind='note'"), sessions: n("SELECT COUNT(*) c FROM sessions") };
  }

  getMeta(key: string): string | undefined {
    return (this.db.prepare("SELECT value FROM meta WHERE key=?").get(key) as { value: string } | undefined)?.value;
  }
  setMeta(key: string, value: string): void {
    this.db.prepare("INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, value);
  }
  deleteMeta(key: string): void {
    this.db.prepare("DELETE FROM meta WHERE key=?").run(key);
  }

  // workspaces
  listWorkspaces(): Workspace[] { return (this.db.prepare("SELECT * FROM workspaces ORDER BY sort_order, created_at").all() as WsRow[]).map(wsFrom); }
  listFloors(parentId: string): Workspace[] { return (this.db.prepare("SELECT * FROM workspaces WHERE parent_id=? ORDER BY sort_order, created_at").all(parentId) as WsRow[]).map(wsFrom); }
  nextWorkspaceOrder(): number { return ((this.db.prepare("SELECT MAX(sort_order) m FROM workspaces").get() as { m: number | null }).m ?? -1) + 1; }
  terminalCounts(): Record<string, number> {
    const rows = this.db.prepare("SELECT workspace_id, COUNT(*) n FROM sessions WHERE state IN ('running','starting') GROUP BY workspace_id").all() as { workspace_id: string; n: number }[];
    return Object.fromEntries(rows.map((r) => [r.workspace_id, r.n]));
  }
  // chats
  listChat(nodeId: string, thread: number | undefined, limit: number, since?: string): ChatMessage[] {
    const rows = this.db.prepare(`SELECT * FROM (SELECT * FROM chats WHERE node_id=? ${thread ? "AND thread=?" : ""} ${since ? "AND created_at>=?" : ""} ORDER BY created_at DESC LIMIT ?) ORDER BY created_at`)
      .all(...[nodeId, ...(thread ? [thread] : []), ...(since ? [since] : []), limit]) as ChatRow[];
    return rows.map(chatFrom);
  }
  insertChat(m: ChatMessage): void { this.db.prepare("INSERT INTO chats(chat_id,workspace_id,node_id,thread,role,text,created_at,attachments) VALUES(?,?,?,?,?,?,?,?)").run(m.chatId, m.workspaceId, m.nodeId, m.thread, m.role, m.text, m.createdAt, m.attachments?.length ? JSON.stringify(m.attachments) : null); }
  /** #79 mensagem que contém o anexo (a lista é JSON; o LIKE só pré-filtra, a checagem exata é em JS). */
  getChatByAttachment(attachmentId: string): ChatMessage | undefined {
    for (const r of this.db.prepare("SELECT * FROM chats WHERE attachments LIKE ?").all(`%${attachmentId}%`) as ChatRow[]) { const m = chatFrom(r); if (m.attachments?.some((a) => a.attachmentId === attachmentId)) return m; }
    return undefined;
  }
  setChatAttachments(chatId: string, list: NonNullable<ChatMessage["attachments"]>): void { this.db.prepare("UPDATE chats SET attachments=? WHERE chat_id=?").run(list.length ? JSON.stringify(list) : null, chatId); }
  clearChat(nodeId: string, thread?: number): number {
    return Number((thread ? this.db.prepare("DELETE FROM chats WHERE node_id=? AND thread=?").run(nodeId, thread) : this.db.prepare("DELETE FROM chats WHERE node_id=?").run(nodeId)).changes);
  }
  // folders
  listFolders(): Folder[] { return (this.db.prepare("SELECT * FROM folders ORDER BY sort_order, created_at").all() as FolderRow[]).map(folderFrom); }
  getFolder(id: string): Folder | undefined { const r = this.db.prepare("SELECT * FROM folders WHERE folder_id=?").get(id) as FolderRow | undefined; return r ? folderFrom(r) : undefined; }
  insertFolder(f: Folder): void { this.db.prepare("INSERT INTO folders VALUES(?,?,?,?,?,?,?)").run(f.folderId, f.name, f.kind, f.parentId ?? null, f.sortOrder, f.collapsed ? 1 : 0, f.createdAt); }
  updateFolder(id: string, p: { name?: string | undefined; parentId?: string | null | undefined; sortOrder?: number | undefined; collapsed?: boolean | undefined }): void {
    const sets: string[] = []; const vals: unknown[] = [];
    if (p.name !== undefined) { sets.push("name=?"); vals.push(p.name); }
    if (p.parentId !== undefined) { sets.push("parent_id=?"); vals.push(p.parentId); }
    if (p.sortOrder !== undefined) { sets.push("sort_order=?"); vals.push(p.sortOrder); }
    if (p.collapsed !== undefined) { sets.push("collapsed=?"); vals.push(p.collapsed ? 1 : 0); }
    if (!sets.length) return;
    this.db.prepare(`UPDATE folders SET ${sets.join(",")} WHERE folder_id=?`).run(...vals, id);
  }
  deleteFolder(id: string): void {
    // filhos sobem um nível; espaços ficam soltos
    this.db.transaction(() => {
      const f = this.getFolder(id);
      this.db.prepare("UPDATE folders SET parent_id=? WHERE parent_id=?").run(f?.parentId ?? null, id);
      this.db.prepare("UPDATE workspaces SET folder_id=? WHERE folder_id=?").run(f?.parentId ?? null, id);
      this.db.prepare("DELETE FROM folders WHERE folder_id=?").run(id);
    })();
  }
  getWorkspace(id: string): Workspace | undefined {
    const r = this.db.prepare("SELECT * FROM workspaces WHERE workspace_id=?").get(id) as WsRow | undefined;
    return r ? wsFrom(r) : undefined;
  }
  insertWorkspace(w: Workspace): void {
    this.db.prepare("INSERT INTO workspaces(workspace_id,machine_id,name,cwd,revision,created_at,icon,color,folder_id,sort_order,parent_id,branch,floor_type,copy_mode,exclude_dirs,status,status_text,unloaded) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(w.workspaceId, w.machineId, w.name, w.cwd, w.revision, w.createdAt, w.icon, w.color, w.folderId ?? null, w.sortOrder, w.parentId ?? null, w.branch ?? null, w.floorType ?? null, w.copyMode ?? null, w.excludeDirs?.length ? JSON.stringify(w.excludeDirs) : null, w.status ?? null, w.statusText ?? null, w.unloaded ? 1 : 0);
  }
  updateWorkspace(id: string, patch: { name?: string | undefined; cwd?: string | undefined; icon?: string | undefined; color?: string | undefined; folderId?: string | null | undefined; sortOrder?: number | undefined; status?: Workspace["status"] | undefined; statusText?: string | undefined; unloaded?: boolean | undefined }, revision: number): void {
    const sets = ["revision=?"]; const vals: unknown[] = [revision];
    if (patch.status !== undefined) { sets.push("status=?"); vals.push(patch.status); }
    if (patch.statusText !== undefined) { sets.push("status_text=?"); vals.push(patch.statusText); }
    if (patch.unloaded !== undefined) { sets.push("unloaded=?"); vals.push(patch.unloaded ? 1 : 0); }
    if (patch.name !== undefined) { sets.push("name=?"); vals.push(patch.name); }
    if (patch.cwd !== undefined) { sets.push("cwd=?"); vals.push(patch.cwd); }
    if (patch.icon !== undefined) { sets.push("icon=?"); vals.push(patch.icon); }
    if (patch.color !== undefined) { sets.push("color=?"); vals.push(patch.color); }
    if (patch.folderId !== undefined) { sets.push("folder_id=?"); vals.push(patch.folderId); }
    if (patch.sortOrder !== undefined) { sets.push("sort_order=?"); vals.push(patch.sortOrder); }
    this.db.prepare(`UPDATE workspaces SET ${sets.join(",")} WHERE workspace_id=?`).run(...vals, id);
  }
  deleteWorkspace(id: string): void { this.db.prepare("DELETE FROM workspaces WHERE workspace_id=?").run(id); }
  bumpRevision(id: string, revision: number): void { this.db.prepare("UPDATE workspaces SET revision=? WHERE workspace_id=?").run(revision, id); }

  // nodes
  listNodes(workspaceId: string): Node[] { return (this.db.prepare("SELECT * FROM nodes WHERE workspace_id=? ORDER BY created_at").all(workspaceId) as NodeRow[]).map(nodeFrom); }
  listAllNodes(): Node[] { return (this.db.prepare("SELECT * FROM nodes ORDER BY created_at").all() as NodeRow[]).map(nodeFrom); }
  getNode(id: string): Node | undefined {
    const r = this.db.prepare("SELECT * FROM nodes WHERE node_id=?").get(id) as NodeRow | undefined;
    return r ? nodeFrom(r) : undefined;
  }
  insertNode(n: Node, titleAuto = true): void {
    this.db.prepare("INSERT INTO nodes(node_id,workspace_id,kind,title,x,y,w,h,session_id,content,created_at,role_id,locked,color,file_path,title_auto,icon,term_theme,skill_ids,group_id,maestro,mem_limit_mb,isolation,secret,secret_env) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
      n.nodeId, n.workspaceId, n.kind, n.title, n.geometry.x, n.geometry.y, n.geometry.w, n.geometry.h,
      n.sessionId ?? null, n.content ?? null, n.createdAt, n.roleId ?? null, n.locked ? 1 : 0, n.color ?? null, n.filePath ?? null, titleAuto ? 1 : 0, n.icon ?? null, n.termTheme ?? null, n.skillIds?.length ? JSON.stringify(n.skillIds) : null, n.groupId ?? null, n.maestro ? 1 : 0, n.memLimitMb ?? null, n.isolation ? JSON.stringify(n.isolation) : null, n.secret ? 1 : 0, n.secretEnv ?? null);
  }
  setNodeRole(id: string, roleId: string | null): void { this.db.prepare("UPDATE nodes SET role_id=? WHERE node_id=?").run(roleId, id); }
  // #71 partituras (data = JSON {nodes, connections})
  listScores(): Score[] { return (this.db.prepare("SELECT * FROM scores ORDER BY name").all() as ScoreRow[]).map(scoreFrom); }
  getScore(id: string): Score | undefined { const r = this.db.prepare("SELECT * FROM scores WHERE score_id=?").get(id) as ScoreRow | undefined; return r ? scoreFrom(r) : undefined; }
  findScoreByName(name: string): Score | undefined { const r = this.db.prepare("SELECT * FROM scores WHERE lower(name)=lower(?)").get(name) as ScoreRow | undefined; return r ? scoreFrom(r) : undefined; }
  insertScore(sc: Score): void { this.db.prepare("INSERT INTO scores VALUES(?,?,?,?,?)").run(sc.scoreId, sc.name, sc.description, JSON.stringify({ nodes: sc.nodes, connections: sc.connections }), sc.createdAt); }
  updateScore(id: string, p: { name?: string | undefined; description?: string | undefined }): void { this.db.prepare("UPDATE scores SET name=COALESCE(?,name), description=COALESCE(?,description) WHERE score_id=?").run(p.name ?? null, p.description ?? null, id); }
  deleteScore(id: string): void { this.db.prepare("DELETE FROM scores WHERE score_id=?").run(id); }
  // #93 aprovações de capacidade (agente isolado pede; o humano decide)
  insertApproval(a: { approvalId: string; nodeId: string; workspaceId: string; capability: string; reason: string; createdAt: string }): void { this.db.prepare("INSERT INTO approvals(approval_id,node_id,workspace_id,capability,reason,status,created_at) VALUES(?,?,?,?,?,'pending',?)").run(a.approvalId, a.nodeId, a.workspaceId, a.capability, a.reason, a.createdAt); }
  getApproval(id: string): Approval | undefined { const r = this.db.prepare("SELECT a.*, n.title nt FROM approvals a JOIN nodes n ON n.node_id=a.node_id WHERE a.approval_id=?").get(id) as ApprovalRow | undefined; return r ? approvalFrom(r) : undefined; }
  listApprovals(status?: string): Approval[] { return (this.db.prepare(`SELECT a.*, n.title nt FROM approvals a JOIN nodes n ON n.node_id=a.node_id ${status ? "WHERE a.status=?" : ""} ORDER BY a.created_at DESC LIMIT 200`).all(...(status ? [status] : [])) as ApprovalRow[]).map(approvalFrom); }
  decideApproval(id: string, status: "approved" | "denied", at: string): void { this.db.prepare("UPDATE approvals SET status=?, decided_at=? WHERE approval_id=?").run(status, at, id); }
  pendingApprovalFor(nodeId: string, capability: string): Approval | undefined { const r = this.db.prepare("SELECT a.*, n.title nt FROM approvals a JOIN nodes n ON n.node_id=a.node_id WHERE a.node_id=? AND a.capability=? AND a.status='pending'").get(nodeId, capability) as ApprovalRow | undefined; return r ? approvalFrom(r) : undefined; }
  // #70 bandas (node_ids = JSON; ids de nós apagados são filtrados na leitura pelo serviço)
  listBands(workspaceId: string): Band[] { return (this.db.prepare("SELECT * FROM bands WHERE workspace_id=? ORDER BY created_at").all(workspaceId) as BandRow[]).map(bandFrom); }
  getBand(id: string): Band | undefined { const r = this.db.prepare("SELECT * FROM bands WHERE band_id=?").get(id) as BandRow | undefined; return r ? bandFrom(r) : undefined; }
  insertBand(b: Band): void { this.db.prepare("INSERT INTO bands VALUES(?,?,?,?,?,?)").run(b.bandId, b.workspaceId, b.name, b.color, JSON.stringify(b.nodeIds), b.createdAt); }
  updateBand(id: string, p: { name?: string | undefined; color?: string | undefined; nodeIds?: string[] | undefined }): void {
    this.db.prepare("UPDATE bands SET name=COALESCE(?,name), color=COALESCE(?,color), node_ids=COALESCE(?,node_ids) WHERE band_id=?").run(p.name ?? null, p.color ?? null, p.nodeIds ? JSON.stringify(p.nodeIds) : null, id);
  }
  deleteBand(id: string): void { this.db.prepare("DELETE FROM bands WHERE band_id=?").run(id); }
  // #78 grupos de nós
  listGroups(workspaceId: string): NodeGroup[] { return (this.db.prepare("SELECT * FROM node_groups WHERE workspace_id=? ORDER BY created_at").all(workspaceId) as GroupRow[]).map(groupFrom); }
  getGroup(id: string): NodeGroup | undefined { const r = this.db.prepare("SELECT * FROM node_groups WHERE group_id=?").get(id) as GroupRow | undefined; return r ? groupFrom(r) : undefined; }
  insertGroup(g: NodeGroup): void { this.db.prepare("INSERT INTO node_groups VALUES(?,?,?,?,?)").run(g.groupId, g.workspaceId, g.label, g.color, g.createdAt); }
  updateGroup(id: string, p: { label?: string | undefined; color?: string | undefined }): void { this.db.prepare("UPDATE node_groups SET label=COALESCE(?,label), color=COALESCE(?,color) WHERE group_id=?").run(p.label ?? null, p.color ?? null, id); }
  deleteGroup(id: string): void { this.db.prepare("DELETE FROM node_groups WHERE group_id=?").run(id); } // nodes.group_id vira NULL (FK)
  setNodesGroup(ids: string[], groupId: string | null): void { const st = this.db.prepare("UPDATE nodes SET group_id=? WHERE node_id=?"); this.db.transaction(() => { for (const id of ids) st.run(groupId, id); })(); }
  groupMemberCount(groupId: string): number { return (this.db.prepare("SELECT COUNT(*) c FROM nodes WHERE group_id=?").get(groupId) as { c: number }).c; }
  /** Apaga grupos do espaço que ficaram com menos de 1 membro; devolve quantos. */
  pruneEmptyGroups(workspaceId: string): number { return this.db.prepare("DELETE FROM node_groups WHERE workspace_id=? AND (SELECT COUNT(*) FROM nodes WHERE nodes.group_id=node_groups.group_id) = 0").run(workspaceId).changes; }
  // #57 skills
  setNodeSkills(id: string, skillIds: string[]): void { this.db.prepare("UPDATE nodes SET skill_ids=? WHERE node_id=?").run(skillIds.length ? JSON.stringify(skillIds) : null, id); }
  listSkills(): Skill[] { return (this.db.prepare("SELECT * FROM skills ORDER BY name").all() as SkillRow[]).map(skillFrom); }
  getSkill(id: string): Skill | undefined { const r = this.db.prepare("SELECT * FROM skills WHERE skill_id=?").get(id) as SkillRow | undefined; return r ? skillFrom(r) : undefined; }
  findSkillByName(name: string): Skill | undefined { const r = this.db.prepare("SELECT * FROM skills WHERE lower(name)=lower(?)").get(name) as SkillRow | undefined; return r ? skillFrom(r) : undefined; }
  insertSkill(k: Skill): void { this.db.prepare("INSERT INTO skills VALUES(?,?,?,?,?,?)").run(k.skillId, k.name, k.description, k.instructions, k.createdAt, k.updatedAt); }
  updateSkill(id: string, p: { name?: string | undefined; description?: string | undefined; instructions?: string | undefined }, updatedAt: string): void {
    this.db.prepare("UPDATE skills SET name=COALESCE(?,name), description=COALESCE(?,description), instructions=COALESCE(?,instructions), updated_at=? WHERE skill_id=?").run(p.name ?? null, p.description ?? null, p.instructions ?? null, updatedAt, id);
  }
  /** Apaga a skill e a tira de todos os nós; devolve os nós afetados (para republicar os espaços). */
  deleteSkill(id: string): Node[] {
    const affected = this.nodesWithSkill(id);
    this.db.transaction(() => { for (const n of affected) this.setNodeSkills(n.nodeId, (n.skillIds ?? []).filter((x) => x !== id)); this.db.prepare("DELETE FROM skills WHERE skill_id=?").run(id); })();
    return affected;
  }
  nodesWithSkill(id: string): Node[] { return (this.db.prepare("SELECT * FROM nodes WHERE skill_ids LIKE ?").all(`%"${id}"%`) as NodeRow[]).map(nodeFrom).filter((n) => (n.skillIds ?? []).includes(id)); }
  // roles
  listRoles(): Role[] { return (this.db.prepare("SELECT * FROM roles ORDER BY name").all() as RoleRow[]).map(roleFrom); }
  getRole(id: string): Role | undefined { const r = this.db.prepare("SELECT * FROM roles WHERE role_id=?").get(id) as RoleRow | undefined; return r ? roleFrom(r) : undefined; }
  findRoleByName(name: string): Role | undefined { const r = this.db.prepare("SELECT * FROM roles WHERE lower(name)=lower(?)").get(name) as RoleRow | undefined; return r ? roleFrom(r) : undefined; }
  insertRole(r: Role): void { this.db.prepare("INSERT INTO roles VALUES(?,?,?,?,?,?)").run(r.roleId, r.name, r.badge, r.instructions, r.createdAt, r.updatedAt); }
  updateRole(id: string, p: { name?: string | undefined; badge?: string | undefined; instructions?: string | undefined }, updatedAt: string): void {
    this.db.prepare("UPDATE roles SET name=COALESCE(?,name), badge=COALESCE(?,badge), instructions=COALESCE(?,instructions), updated_at=? WHERE role_id=?").run(p.name ?? null, p.badge ?? null, p.instructions ?? null, updatedAt, id);
  }
  deleteRole(id: string): void { this.db.transaction(() => { this.db.prepare("UPDATE nodes SET role_id=NULL WHERE role_id=?").run(id); this.db.prepare("DELETE FROM roles WHERE role_id=?").run(id); })(); }
  nodesWithRole(id: string): Node[] { return (this.db.prepare("SELECT * FROM nodes WHERE role_id=?").all(id) as NodeRow[]).map(nodeFrom); }
  updateNode(id: string, patch: { title?: string | undefined; geometry?: Node["geometry"] | undefined; content?: string | undefined; sessionId?: string | undefined; locked?: boolean | undefined; color?: string | null | undefined; filePath?: string | undefined; titleAuto?: boolean | undefined; icon?: string | null | undefined; termTheme?: string | null | undefined; groupId?: string | null | undefined; maestro?: boolean | undefined; memLimitMb?: number | null | undefined; isolation?: NodeIsolation | null | undefined; secret?: boolean | undefined; secretEnv?: string | null | undefined }): void {
    const g = patch.geometry;
    const sets = ["title=COALESCE(?,title)", "x=COALESCE(?,x)", "y=COALESCE(?,y)", "w=COALESCE(?,w)", "h=COALESCE(?,h)", "content=COALESCE(?,content)", "session_id=COALESCE(?,session_id)"];
    const vals: unknown[] = [patch.title ?? null, g?.x ?? null, g?.y ?? null, g?.w ?? null, g?.h ?? null, patch.content ?? null, patch.sessionId ?? null];
    if (patch.locked !== undefined) { sets.push("locked=?"); vals.push(patch.locked ? 1 : 0); }
    if (patch.color !== undefined) { sets.push("color=?"); vals.push(patch.color); }
    if (patch.filePath !== undefined) { sets.push("file_path=?"); vals.push(patch.filePath); }
    if (patch.titleAuto !== undefined) { sets.push("title_auto=?"); vals.push(patch.titleAuto ? 1 : 0); }
    if (patch.icon !== undefined) { sets.push("icon=?"); vals.push(patch.icon); }
    if (patch.termTheme !== undefined) { sets.push("term_theme=?"); vals.push(patch.termTheme); }
    if (patch.groupId !== undefined) { sets.push("group_id=?"); vals.push(patch.groupId); }
    if (patch.maestro !== undefined) { sets.push("maestro=?"); vals.push(patch.maestro ? 1 : 0); }
    if (patch.memLimitMb !== undefined) { sets.push("mem_limit_mb=?"); vals.push(patch.memLimitMb); }
    if (patch.isolation !== undefined) { sets.push("isolation=?"); vals.push(patch.isolation ? JSON.stringify(patch.isolation) : null); }
    if (patch.secret !== undefined) { sets.push("secret=?"); vals.push(patch.secret ? 1 : 0); }
    if (patch.secretEnv !== undefined) { sets.push("secret_env=?"); vals.push(patch.secretEnv); }
    this.db.prepare(`UPDATE nodes SET ${sets.join(",")} WHERE node_id=?`).run(...vals, id);
  }
  isTitleAuto(id: string): boolean { return ((this.db.prepare("SELECT title_auto t FROM nodes WHERE node_id=?").get(id) as { t: number } | undefined)?.t ?? 0) === 1; }
  deleteNode(id: string): void { this.db.prepare("DELETE FROM nodes WHERE node_id=?").run(id); }

  // connections
  updateConnection(id: string, p: { style?: Connection["style"] | undefined; label?: string | null | undefined }): void {
    const sets: string[] = []; const vals: unknown[] = [];
    if (p.style !== undefined) { sets.push("style=?"); vals.push(p.style); }
    if (p.label !== undefined) { sets.push("label=?"); vals.push(p.label); }
    if (sets.length) this.db.prepare(`UPDATE connections SET ${sets.join(",")} WHERE connection_id=?`).run(...vals, id);
  }
  listConnections(workspaceId: string): Connection[] {
    return (this.db.prepare("SELECT * FROM connections WHERE workspace_id=? OR source_node_id IN (SELECT node_id FROM nodes WHERE workspace_id=?) OR target_node_id IN (SELECT node_id FROM nodes WHERE workspace_id=?) ORDER BY created_at").all(workspaceId, workspaceId, workspaceId) as ConnRow[]).map(connFrom);
  }
  listNodeConnections(nodeId: string): Connection[] {
    return (this.db.prepare("SELECT * FROM connections WHERE source_node_id=? OR target_node_id=? ORDER BY created_at").all(nodeId, nodeId) as ConnRow[]).map(connFrom);
  }
  getConnection(id: string): Connection | undefined {
    const r = this.db.prepare("SELECT * FROM connections WHERE connection_id=?").get(id) as ConnRow | undefined;
    return r ? connFrom(r) : undefined;
  }
  insertConnection(c: Connection): void {
    this.db.prepare("INSERT INTO connections(connection_id,workspace_id,source_node_id,target_node_id,label,created_at,style) VALUES(?,?,?,?,?,?,?)").run(c.connectionId, c.workspaceId, c.sourceNodeId, c.targetNodeId, c.label ?? null, c.createdAt, c.style ?? "rope");
  }
  deleteConnection(id: string): void { this.db.prepare("DELETE FROM connections WHERE connection_id=?").run(id); }

  // drawings
  listDrawings(workspaceId: string): Drawing[] { return (this.db.prepare("SELECT * FROM drawings WHERE workspace_id=? ORDER BY created_at").all(workspaceId) as DrwRow[]).map(drwFrom); }
  getDrawing(id: string): Drawing | undefined { const r = this.db.prepare("SELECT * FROM drawings WHERE drawing_id=?").get(id) as DrwRow | undefined; return r ? drwFrom(r) : undefined; }
  insertDrawing(d: Drawing): void { this.db.prepare("INSERT INTO drawings VALUES(?,?,?,?,?,?,?,?)").run(d.drawingId, d.workspaceId, d.kind, JSON.stringify(d.points), d.color, d.width, d.createdAt, d.groupId ?? null); }
  updateDrawingPoints(id: string, points: Drawing["points"]): void { this.db.prepare("UPDATE drawings SET points=? WHERE drawing_id=?").run(JSON.stringify(points), id); }
  setDrawingGroup(ids: string[], groupId: string | null): void { const stmt = this.db.prepare("UPDATE drawings SET group_id=? WHERE drawing_id=?"); const tx = this.db.transaction(() => { for (const id of ids) stmt.run(groupId, id); }); tx(); }
  deleteDrawing(id: string): void { this.db.prepare("DELETE FROM drawings WHERE drawing_id=?").run(id); }

  // messages
  insertMessage(m: Message): void {
    this.db.prepare("INSERT INTO messages VALUES(?,?,?,?,?,?,?,?,?)").run(m.messageId, m.workspaceId, m.fromNodeId, m.toNodeId, m.text, m.replyTo ?? null, m.createdAt, m.readAt ?? null, m.delivered ? 1 : 0);
  }
  getMessage(id: string): Message | undefined {
    const r = this.db.prepare("SELECT * FROM messages WHERE message_id=? OR message_id LIKE ?").get(id, `${id}%`) as MsgRow | undefined;
    return r ? msgFrom(r) : undefined;
  }
  listInbox(toNodeId: string, unreadOnly: boolean): Message[] {
    const q = unreadOnly ? "SELECT * FROM messages WHERE to_node_id=? AND read_at IS NULL ORDER BY created_at" : "SELECT * FROM messages WHERE to_node_id=? ORDER BY created_at DESC LIMIT 50";
    return (this.db.prepare(q).all(toNodeId) as MsgRow[]).map(msgFrom);
  }
  markRead(ids: string[], at: string): void {
    const st = this.db.prepare("UPDATE messages SET read_at=? WHERE message_id=? AND read_at IS NULL");
    this.db.transaction(() => { for (const id of ids) st.run(at, id); })();
  }
  markDelivered(id: string): void { this.db.prepare("UPDATE messages SET delivered=1 WHERE message_id=?").run(id); }
  /** #69 não-lidas de todos os espaços (nó → contagem). */
  unreadAll(): { nodeId: string; workspaceId: string; count: number }[] {
    return (this.db.prepare("SELECT to_node_id n, workspace_id w, COUNT(*) c FROM messages WHERE read_at IS NULL GROUP BY to_node_id, workspace_id").all() as { n: string; w: string; c: number }[]).map((r) => ({ nodeId: r.n, workspaceId: r.w, count: r.c }));
  }
  /** #69 nós por título (todos os espaços), case-insensitive. */
  searchNodeTitles(q: string, limit = 30): Node[] {
    const fold = (x: string) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); // sem acento/caixa, como a paleta e o FTS5
    const needle = fold(q);
    const rows = this.db.prepare("SELECT * FROM nodes ORDER BY created_at DESC").all() as NodeRow[];
    return rows.filter((r) => fold(r.title).includes(needle)).slice(0, Math.max(1, Math.min(200, limit))).map(nodeFrom);
  }
  unreadCounts(workspaceId: string): Record<string, number> {
    const rows = this.db.prepare("SELECT to_node_id, COUNT(*) n FROM messages WHERE workspace_id=? AND read_at IS NULL GROUP BY to_node_id").all(workspaceId) as { to_node_id: string; n: number }[];
    return Object.fromEntries(rows.map((r) => [r.to_node_id, r.n]));
  }

  // sessions
  listSessions(workspaceId?: string): Session[] {
    const rows = workspaceId
      ? this.db.prepare("SELECT * FROM sessions WHERE workspace_id=?").all(workspaceId)
      : this.db.prepare("SELECT * FROM sessions").all();
    return (rows as SessRow[]).map(sessFrom);
  }
  getSession(id: string): Session | undefined {
    const r = this.db.prepare("SELECT * FROM sessions WHERE session_id=?").get(id) as SessRow | undefined;
    return r ? sessFrom(r) : undefined;
  }
  insertSession(s: Session): void {
    this.db.prepare("INSERT INTO sessions(session_id,workspace_id,node_id,command,args,cwd,state,pid,exit_code,cols,rows,created_at,persistent,resume_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
      s.sessionId, s.workspaceId, s.nodeId, s.command, JSON.stringify(s.args), s.cwd, s.state,
      s.pid ?? null, s.exitCode ?? null, s.cols, s.rows, s.createdAt, s.persistent ? 1 : 0, s.resumeId ?? null);
  }
  setSessionResume(id: string, resumeId: string): void { this.db.prepare("UPDATE sessions SET resume_id=? WHERE session_id=?").run(resumeId, id); }
  updateSession(id: string, patch: { state?: Session["state"]; pid?: number | null; exitCode?: number | null; cols?: number; rows?: number }): void {
    this.db.prepare(`UPDATE sessions SET state=COALESCE(?,state), pid=COALESCE(?,pid), exit_code=COALESCE(?,exit_code),
      cols=COALESCE(?,cols), rows=COALESCE(?,rows) WHERE session_id=?`)
      .run(patch.state ?? null, patch.pid ?? null, patch.exitCode ?? null, patch.cols ?? null, patch.rows ?? null, id);
  }
  deleteSession(id: string): void { this.db.prepare("DELETE FROM sessions WHERE session_id=?").run(id); }

  transaction<T>(fn: () => T): T { return this.db.transaction(fn)(); }
}
