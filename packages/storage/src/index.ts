import Database from "better-sqlite3";
import type { ChatMessage, Connection, Drawing, Folder, Message, Node, Role, Session, Workspace } from "@messai/contracts";

const MIGRATIONS: string[] = [
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
];
type DrwRow = { drawing_id: string; workspace_id: string; kind: Drawing["kind"]; points: string; color: string; width: number; created_at: string; group_id: string | null };
const drwFrom = (r: DrwRow): Drawing => ({ drawingId: r.drawing_id, workspaceId: r.workspace_id, kind: r.kind, points: JSON.parse(r.points) as Drawing["points"], color: r.color, width: r.width, createdAt: r.created_at, ...(r.group_id ? { groupId: r.group_id } : {}) });
type MsgRow = { message_id: string; workspace_id: string; from_node_id: string; to_node_id: string; text: string; reply_to: string | null; created_at: string; read_at: string | null; delivered: number };
const msgFrom = (r: MsgRow): Message => ({ messageId: r.message_id, workspaceId: r.workspace_id, fromNodeId: r.from_node_id, toNodeId: r.to_node_id, text: r.text, createdAt: r.created_at, delivered: r.delivered === 1, ...(r.reply_to ? { replyTo: r.reply_to } : {}), ...(r.read_at ? { readAt: r.read_at } : {}) });
type ConnRow = { connection_id: string; workspace_id: string; source_node_id: string; target_node_id: string; label: string | null; created_at: string; style: Connection["style"] | null };
const connFrom = (r: ConnRow): Connection => ({ connectionId: r.connection_id, workspaceId: r.workspace_id, sourceNodeId: r.source_node_id, targetNodeId: r.target_node_id, createdAt: r.created_at, ...(r.label !== null ? { label: r.label } : {}), ...(r.style ? { style: r.style } : {}) });

type WsRow = { workspace_id: string; machine_id: string; name: string; cwd: string; icon: string; color: string; folder_id: string | null; sort_order: number; revision: number; created_at: string; parent_id: string | null; branch: string | null; floor_type: Workspace["floorType"] | null; status: Workspace["status"] | null; status_text: string | null };
type ChatRow = { chat_id: string; workspace_id: string; node_id: string; thread: number; role: ChatMessage["role"]; text: string; created_at: string };
const chatFrom = (r: ChatRow): ChatMessage => ({ chatId: r.chat_id, workspaceId: r.workspace_id, nodeId: r.node_id, thread: r.thread, role: r.role, text: r.text, createdAt: r.created_at });
type FolderRow = { folder_id: string; name: string; kind: Folder["kind"]; parent_id: string | null; sort_order: number; collapsed: number; created_at: string };
const folderFrom = (r: FolderRow): Folder => ({ folderId: r.folder_id, name: r.name, kind: r.kind, sortOrder: r.sort_order, collapsed: r.collapsed === 1, createdAt: r.created_at, ...(r.parent_id ? { parentId: r.parent_id } : {}) });
type NodeRow = { node_id: string; workspace_id: string; kind: Node["kind"]; title: string; x: number; y: number; w: number; h: number; session_id: string | null; content: string | null; created_at: string; role_id: string | null; locked: number; color: string | null; file_path: string | null; title_auto: number };
type RoleRow = { role_id: string; name: string; badge: string; instructions: string; created_at: string; updated_at: string };
const roleFrom = (r: RoleRow): Role => ({ roleId: r.role_id, name: r.name, badge: r.badge, instructions: r.instructions, createdAt: r.created_at, updatedAt: r.updated_at });
type SessRow = { session_id: string; workspace_id: string; node_id: string; command: string; args: string; cwd: string; state: Session["state"]; pid: number | null; exit_code: number | null; cols: number; rows: number; created_at: string; persistent: number; resume_id: string | null };

const wsFrom = (r: WsRow): Workspace => ({ workspaceId: r.workspace_id, machineId: r.machine_id, name: r.name, cwd: r.cwd, icon: r.icon, color: r.color, sortOrder: r.sort_order, revision: r.revision, createdAt: r.created_at, ...(r.folder_id ? { folderId: r.folder_id } : {}), ...(r.parent_id ? { parentId: r.parent_id } : {}), ...(r.branch ? { branch: r.branch } : {}), ...(r.floor_type ? { floorType: r.floor_type } : {}), ...(r.status ? { status: r.status } : {}), ...(r.status_text ? { statusText: r.status_text } : {}) });
const nodeFrom = (r: NodeRow): Node => ({
  nodeId: r.node_id, workspaceId: r.workspace_id, kind: r.kind, title: r.title,
  geometry: { x: r.x, y: r.y, w: r.w, h: r.h }, createdAt: r.created_at,
  ...(r.session_id ? { sessionId: r.session_id } : {}),
  ...(r.role_id ? { roleId: r.role_id } : {}),
  ...(r.locked ? { locked: true } : {}),
  ...(r.color ? { color: r.color } : {}),
  ...(r.file_path ? { filePath: r.file_path } : {}),
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
    for (let i = v; i < MIGRATIONS.length; i++) {
      this.db.transaction(() => {
        this.db.exec(MIGRATIONS[i]!);
        this.db.pragma(`user_version = ${i + 1}`);
      })();
    }
  }
  close(): void { this.db.close(); }

  getMeta(key: string): string | undefined {
    return (this.db.prepare("SELECT value FROM meta WHERE key=?").get(key) as { value: string } | undefined)?.value;
  }
  setMeta(key: string, value: string): void {
    this.db.prepare("INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, value);
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
  insertChat(m: ChatMessage): void { this.db.prepare("INSERT INTO chats VALUES(?,?,?,?,?,?,?)").run(m.chatId, m.workspaceId, m.nodeId, m.thread, m.role, m.text, m.createdAt); }
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
    this.db.prepare("INSERT INTO workspaces(workspace_id,machine_id,name,cwd,revision,created_at,icon,color,folder_id,sort_order,parent_id,branch,floor_type,status,status_text) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(w.workspaceId, w.machineId, w.name, w.cwd, w.revision, w.createdAt, w.icon, w.color, w.folderId ?? null, w.sortOrder, w.parentId ?? null, w.branch ?? null, w.floorType ?? null, w.status ?? null, w.statusText ?? null);
  }
  updateWorkspace(id: string, patch: { name?: string | undefined; cwd?: string | undefined; icon?: string | undefined; color?: string | undefined; folderId?: string | null | undefined; sortOrder?: number | undefined; status?: Workspace["status"] | undefined; statusText?: string | undefined }, revision: number): void {
    const sets = ["revision=?"]; const vals: unknown[] = [revision];
    if (patch.status !== undefined) { sets.push("status=?"); vals.push(patch.status); }
    if (patch.statusText !== undefined) { sets.push("status_text=?"); vals.push(patch.statusText); }
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
  getNode(id: string): Node | undefined {
    const r = this.db.prepare("SELECT * FROM nodes WHERE node_id=?").get(id) as NodeRow | undefined;
    return r ? nodeFrom(r) : undefined;
  }
  insertNode(n: Node, titleAuto = true): void {
    this.db.prepare("INSERT INTO nodes(node_id,workspace_id,kind,title,x,y,w,h,session_id,content,created_at,role_id,locked,color,file_path,title_auto) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
      n.nodeId, n.workspaceId, n.kind, n.title, n.geometry.x, n.geometry.y, n.geometry.w, n.geometry.h,
      n.sessionId ?? null, n.content ?? null, n.createdAt, n.roleId ?? null, n.locked ? 1 : 0, n.color ?? null, n.filePath ?? null, titleAuto ? 1 : 0);
  }
  setNodeRole(id: string, roleId: string | null): void { this.db.prepare("UPDATE nodes SET role_id=? WHERE node_id=?").run(roleId, id); }
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
  updateNode(id: string, patch: { title?: string | undefined; geometry?: Node["geometry"] | undefined; content?: string | undefined; sessionId?: string | undefined; locked?: boolean | undefined; color?: string | null | undefined; filePath?: string | undefined; titleAuto?: boolean | undefined }): void {
    const g = patch.geometry;
    const sets = ["title=COALESCE(?,title)", "x=COALESCE(?,x)", "y=COALESCE(?,y)", "w=COALESCE(?,w)", "h=COALESCE(?,h)", "content=COALESCE(?,content)", "session_id=COALESCE(?,session_id)"];
    const vals: unknown[] = [patch.title ?? null, g?.x ?? null, g?.y ?? null, g?.w ?? null, g?.h ?? null, patch.content ?? null, patch.sessionId ?? null];
    if (patch.locked !== undefined) { sets.push("locked=?"); vals.push(patch.locked ? 1 : 0); }
    if (patch.color !== undefined) { sets.push("color=?"); vals.push(patch.color); }
    if (patch.filePath !== undefined) { sets.push("file_path=?"); vals.push(patch.filePath); }
    if (patch.titleAuto !== undefined) { sets.push("title_auto=?"); vals.push(patch.titleAuto ? 1 : 0); }
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
  listConnections(workspaceId: string): Connection[] { return (this.db.prepare("SELECT * FROM connections WHERE workspace_id=? ORDER BY created_at").all(workspaceId) as ConnRow[]).map(connFrom); }
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
