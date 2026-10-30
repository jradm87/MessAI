import type { ApiError, TreeEntry, FileContent, FsOp, SearchHit, CreateFloor, LandFloor, LandResult, PatchConnection, Role, CreateRole, PatchRole, ChatMessage, SendChat, Attachment, CreateAttachment, FileEntry, Connection as WsConnection, CreateDrawing, PatchDrawing, GroupDrawings, CreateFolder, CreateNode, CreateWorkspace, Drawing, Folder, Geometry, PatchFolder, PatchWorkspace, Preset, Node, PatchNode, Session, Sidebar, Workspace, WorkspaceSnapshot, WsClientMessage, WsServerMessage } from "@messai/contracts";

export type Connection = { baseUrl: string; wsUrl: string; token: string; homeDir?: string };
declare global { interface Window { messai: { connection(): Promise<Connection | null>; pickDirectory?: () => Promise<string | null>; pathForFile?: (f: File) => string } } }

export class ApiClientError extends Error { constructor(readonly error: ApiError, readonly status: number) { super(error.message); } }

export class Api {
  constructor(readonly conn: Connection) {}
  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const r = await fetch(this.conn.baseUrl + path, {
      method, headers: { authorization: `Bearer ${this.conn.token}`, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : null,
    });
    if (r.status === 204) return undefined as T;
    const j = (await r.json()) as T | { error: ApiError };
    if (!r.ok) throw new ApiClientError((j as { error: ApiError }).error, r.status);
    return j as T;
  }
  unread(wsId: string) { return this.req<Record<string, number>>("GET", `/v1/workspaces/${wsId}/unread`); }
  markInboxRead(nodeId: string) { return this.req<unknown>("GET", `/v1/nodes/${nodeId}/inbox?unread=1&mark=1`); }
  health() { return this.req<{ ok: boolean; protocolVersion: number; buildVersion?: number; machineId: string }>("GET", "/v1/health"); }
  agentUsage() { return this.req<{ agents: { id: string; label: string; available: boolean; note?: string; plan?: string; limits?: { label: string; pct: number; resets: string }[]; metrics: { label: string; value: string }[]; models: { name: string; input: number; output: number }[] }[] }>("GET", "/v1/agent-usage"); }
  capabilities() { return this.req<{ features: string[] }>("GET", "/v1/capabilities"); }
  presets() { return this.req<Preset[]>("GET", "/v1/presets"); }
  listWorkspaces() { return this.req<Workspace[]>("GET", "/v1/workspaces"); }
  createWorkspace(input: CreateWorkspace) { return this.req<Workspace>("POST", "/v1/workspaces", input); }
  patchWorkspace(id: string, input: PatchWorkspace) { return this.req<Workspace>("PATCH", `/v1/workspaces/${id}`, input); }
  tree(wsId: string, path: string) { return this.req<TreeEntry[]>("GET", `/v1/workspaces/${wsId}/tree?path=${encodeURIComponent(path)}`); }
  file(wsId: string, path: string) { return this.req<FileContent>("GET", `/v1/workspaces/${wsId}/file?path=${encodeURIComponent(path)}`); }
  fsOp(wsId: string, input: FsOp) { return this.req<{ path: string }>("POST", `/v1/workspaces/${wsId}/fs`, input); }
  search(wsId: string, q: string, content: boolean) { return this.req<SearchHit[]>("GET", `/v1/workspaces/${wsId}/search?q=${encodeURIComponent(q)}${content ? "&content=1" : ""}`); }
  floors(groundId: string) { return this.req<Workspace[]>("GET", `/v1/workspaces/${groundId}/floors`); }
  createFloor(groundId: string, input: CreateFloor) { return this.req<Workspace>("POST", `/v1/workspaces/${groundId}/floors`, input); }
  landFloor(floorId: string, input: LandFloor) { return this.req<LandResult>("POST", `/v1/workspaces/${floorId}/land`, input); }
  deleteWorkspaceOpts(id: string, deleteBranch: boolean) { return this.req<void>("DELETE", `/v1/workspaces/${id}${deleteBranch ? "?deleteBranch=1" : ""}`); }
  sidebar() { return this.req<Sidebar>("GET", "/v1/sidebar"); }
  createFolder(input: CreateFolder) { return this.req<Folder>("POST", "/v1/folders", input); }
  patchFolder(id: string, input: PatchFolder) { return this.req<Folder>("PATCH", `/v1/folders/${id}`, input); }
  deleteFolder(id: string) { return this.req<void>("DELETE", `/v1/folders/${id}`); }
  deleteWorkspace(id: string) { return this.req<void>("DELETE", `/v1/workspaces/${id}`); }
  snapshot(id: string) { return this.req<WorkspaceSnapshot>("GET", `/v1/workspaces/${id}`); }
  createNode(wsId: string, input: CreateNode) { return this.req<{ node: Node; session?: Session; revision: number }>("POST", `/v1/workspaces/${wsId}/nodes`, input); }
  patchNode(id: string, input: PatchNode) { return this.req<Node>("PATCH", `/v1/nodes/${id}`, input); }
  deleteNode(id: string, expectedRevision: number) { return this.req<void>("DELETE", `/v1/nodes/${id}`, { expectedRevision }); }
  duplicateNode(id: string, expectedRevision: number) { return this.req<{ node: Node; session?: Session; revision: number }>("POST", `/v1/nodes/${id}/duplicate`, { expectedRevision }); }
  applyLayout(wsId: string, expectedRevision: number, moves: { nodeId: string; geometry: Geometry }[]) { return this.req<{ revision: number }>("POST", `/v1/workspaces/${wsId}/layout`, { expectedRevision, moves }); }
  createConnectionRev(wsId: string, expectedRevision: number, sourceNodeId: string, targetNodeId: string) { return this.req<WsConnection>("POST", `/v1/workspaces/${wsId}/connections`, { expectedRevision, sourceNodeId, targetNodeId }); }
  patchConnection(id: string, input: PatchConnection) { return this.req<WsConnection>("PATCH", `/v1/connections/${id}`, input); }
  deleteConnection(id: string, expectedRevision: number) { return this.req<void>("DELETE", `/v1/connections/${id}`, { expectedRevision }); }
  createDrawing(wsId: string, input: CreateDrawing) { return this.req<Drawing>("POST", `/v1/workspaces/${wsId}/drawings`, input); }
  patchDrawing(id: string, input: PatchDrawing) { return this.req<Drawing>("PATCH", `/v1/drawings/${id}`, input); }
  groupDrawings(wsId: string, input: GroupDrawings) { return this.req<{ revision: number }>("POST", `/v1/workspaces/${wsId}/drawings/group`, input); }
  deleteDrawing(id: string, expectedRevision: number) { return this.req<void>("DELETE", `/v1/drawings/${id}`, { expectedRevision }); }
  roles() { return this.req<Role[]>("GET", "/v1/roles"); }
  createRole(input: CreateRole) { return this.req<Role>("POST", "/v1/roles", input); }
  patchRole(id: string, input: PatchRole) { return this.req<Role>("PATCH", `/v1/roles/${id}`, input); }
  deleteRole(id: string) { return this.req<void>("DELETE", `/v1/roles/${id}`); }
  discoverRoles(dir: string) { return this.req<{ imported: Role[] }>("POST", "/v1/roles/discover", { dir }); }
  exportRole(id: string, dir: string) { return this.req<{ path: string }>("POST", `/v1/roles/${id}/export`, { dir }); }
  chat(nodeId: string, limit = 200) { return this.req<ChatMessage[]>("GET", `/v1/nodes/${nodeId}/chat?limit=${limit}`); }
  say(nodeId: string, input: SendChat) { return this.req<ChatMessage>("POST", `/v1/nodes/${nodeId}/chat`, input); }
  clearChat(nodeId: string, thread?: number) { return this.req<{ removed: number }>("DELETE", `/v1/nodes/${nodeId}/chat${thread ? `?thread=${thread}` : ""}`); }
  files(nodeId: string, q: string) { return this.req<FileEntry[]>("GET", `/v1/nodes/${nodeId}/files?q=${encodeURIComponent(q)}`); }
  attach(wsId: string, input: CreateAttachment) { return this.req<Attachment>("POST", `/v1/workspaces/${wsId}/attachments`, input); }
  restart(nodeId: string) { return this.req<Session>("POST", `/v1/nodes/${nodeId}/restart`); }
  stop(sessionId: string) { return this.req<Session>("POST", `/v1/sessions/${sessionId}/stop`); }
}

type Listener = (m: WsServerMessage) => void;

/** Uma conexão WS por janela; reconecta com backoff e reinscreve. */
export class Stream {
  private ws?: WebSocket;
  private listeners = new Set<Listener>();
  private subscribed = new Set<string>();
  private attached = new Set<string>();
  private backoff = 500;
  clientId?: string;
  constructor(private readonly conn: Connection) { this.open(); }
  private open() {
    const ws = new WebSocket(`${this.conn.wsUrl}?token=${encodeURIComponent(this.conn.token)}`);
    this.ws = ws;
    ws.onopen = () => { this.backoff = 500; for (const w of this.subscribed) this.send({ type: "subscribe", workspaceId: w }); for (const s of this.attached) this.send({ type: "attach", sessionId: s }); };
    ws.onmessage = (e) => { const m = JSON.parse(e.data as string) as WsServerMessage; if (m.type === "hello") this.clientId = m.clientId; for (const l of this.listeners) l(m); };
    ws.onclose = () => { setTimeout(() => this.open(), this.backoff); this.backoff = Math.min(this.backoff * 2, 8000); };
  }
  send(m: WsClientMessage) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m)); }
  on(l: Listener) { this.listeners.add(l); return () => { this.listeners.delete(l); }; }
  subscribe(workspaceId: string) { this.subscribed.add(workspaceId); this.send({ type: "subscribe", workspaceId }); }
  unsubscribe(workspaceId: string) { this.subscribed.delete(workspaceId); }
  attach(sessionId: string) { this.attached.add(sessionId); this.send({ type: "attach", sessionId }); }
  detach(sessionId: string) { this.attached.delete(sessionId); this.send({ type: "detach", sessionId }); }
}
