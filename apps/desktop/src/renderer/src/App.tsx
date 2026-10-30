import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Background, BackgroundVariant, MiniMap, ReactFlow, applyNodeChanges, applyEdgeChanges, type EdgeChange, useReactFlow, ReactFlowProvider, useOnViewportChange, type Connection as FlowConnection, type Edge, type EdgeTypes, type Node as FlowNode, type NodeChange, type NodeTypes } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Map as MapIcon, Minus, Plus, Activity, Layers, AlignStartVertical, AlignCenterVertical, AlignEndVertical, AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal, LayoutGrid } from "lucide-react";
import { BUILD_VERSION, type Role, type Drawing, type Folder, type Geometry, type Preset, type Sidebar as SidebarData, type Workspace, type WorkspaceSnapshot } from "@messai/contracts";
import { gridLayout, alignGeometries, type AlignMode } from "@messai/domain";
import { Sidebar } from "./Sidebar.js";
import { WorkspaceDialog, type WorkspaceInput } from "./WorkspaceDialog.js";
import { RolesDialog } from "./RolesDialog.js";
import { askText } from "./ask.js";
import { FloorDialog } from "./FloorDialog.js";
import { FloorOverview, STATUS_COLOR, STATUS_LABEL } from "./FloorOverview.js";
import { NodeActionBar, type NodeAction } from "./NodeActionBar.js";
import { AgentUsage } from "./AgentUsage.js";
import { AgentIcon, agentKind } from "./agentIcons.js";
import { Api, ApiClientError, Stream, type Connection } from "./api.js";
import { store, sessStateMapAtom, unreadMapAtom, attentionAtom } from "./atoms.js";
import { TerminalNode } from "./TerminalNode.js";
import { NoteNode } from "./NoteNode.js";
import { TextNode } from "./TextNode.js";
import { TreeNode } from "./TreeNode.js";
import { FilePreview } from "./FilePreview.js";
import { RopeEdge, CircuitEdge, type EdgeData } from "./RopeEdge.js";
import { AddMenu, type AddChoice } from "./AddMenu.js";
import { Toolbar, type Tool, type DrawStyle } from "./Toolbar.js";
import { DrawingLayer, type CreateRect } from "./DrawingLayer.js";
import { NewTerminalDialog, type NewTerminalInput } from "./NewTerminalDialog.js";

const nodeTypes: NodeTypes = { terminal: TerminalNode as never, note: NoteNode as never, text: TextNode as never, tree: TreeNode as never };
const edgeTypes: EdgeTypes = { rope: RopeEdge as never, circuit: CircuitEdge as never };
const SIZE = { terminal: { w: 640, h: 380 }, note: { w: 260, h: 160 }, text: { w: 220, h: 48 }, tree: { w: 300, h: 420 } } as const;

function freeSpot(nodes: { geometry: Geometry }[], size: { w: number; h: number }, at?: { x: number; y: number }): Geometry {
  if (at) return { x: at.x, y: at.y, ...size };
  if (nodes.length === 0) return { x: 40, y: 40, ...size };
  const right = Math.max(...nodes.map((n) => n.geometry.x + n.geometry.w));
  const top = Math.min(...nodes.map((n) => n.geometry.y));
  return { x: right + 40, y: top, ...size };
}
const isTyping = () => { const el = document.activeElement as HTMLElement | null; return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable || el.classList.contains("xterm-helper-textarea")); };

function ZoomBar({ minimap, setMinimap, onUsage, agents, wsName, inFloors, onFloors }: { minimap: boolean; setMinimap: (v: boolean) => void; onUsage: () => void; agents: string[]; wsName?: string; inFloors: boolean; onFloors: () => void }) {
  const rf = useReactFlow(); const [z, setZ] = useState(100);
  useOnViewportChange({ onChange: (v) => setZ(Math.round(v.zoom * 100)) });
  return (
    <div className="botbar">
      {wsName && <button className={`bb-pill ${inFloors ? "on" : ""}`} title="Andares" onClick={onFloors} data-testid="ws-pill"><Layers size={15} /><span className="bb-name">{inFloors ? "Floors" : wsName}</span></button>}
      {agents.slice(0, 5).map((a) => <button key={a} className="bb-circle" title={`${a} — Agent Usage`} onClick={onUsage}><AgentIcon id={a} size={20} /></button>)}
      {agents.length === 0 && <button className="bb-circle" title="Agent Usage" onClick={onUsage}><Activity size={15} /></button>}
      <button className="bb-circle" title="Minimapa (Ctrl+Shift+M)" onClick={() => setMinimap(!minimap)}><MapIcon size={15} /></button>
      <div className="bb-zoom">
        <button className="tb" title="Reduzir (Ctrl+-)" onClick={() => void rf.zoomOut({ duration: 120 })}><Minus size={14} /></button>
        <span className="pct" onClick={() => void rf.zoomTo(1, { duration: 150 })} title="100%">{z}%</span>
        <button className="tb" title="Ampliar (Ctrl++)" onClick={() => void rf.zoomIn({ duration: 120 })}><Plus size={14} /></button>
      </div>
    </div>
  );
}

function Canvas({ conn }: { conn: Connection }) {
  const api = useMemo(() => new Api(conn), [conn]);
  const stream = useMemo(() => new Stream(conn), [conn]);
  const rf = useReactFlow();
  const [side, setSide] = useState<SidebarData>({ folders: [], workspaces: [], terminals: {} });
  const [current, setCurrent] = useState<string | null>(null);
  const [wsDialog, setWsDialog] = useState<{ edit?: Workspace; folderId?: string } | null>(null);
  const [sideMini, setSideMini] = useState(false);
  const [snap, setSnap] = useState<WorkspaceSnapshot | null>(null);
  const [flow, setFlow] = useState<FlowNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const flowRef = useRef<FlowNode[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [menu, setMenu] = useState<{ x: number; y: number; at?: { x: number; y: number } } | null>(null);
  const [dialog, setDialog] = useState<{ rect: Geometry } | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [style, setStyle] = useState<DrawStyle>({ kind: "pen", color: "#e0453a", width: 3 });
  const [minimap, setMinimap] = useState(true);
  const [msg, setMsg] = useState("");
  const [stale, setStale] = useState(false);
  // Sessão e não-lidas vivem em átomos Jotai (atoms.ts): cada nó assina o seu, então
  // evento de PTY/mensagem não reconstrói o canvas. Estes setters escrevem no store.
  const setUnread = (u: Record<string, number>) => store.set(unreadMapAtom, u);
  const setSessState = (u: Record<string, string> | ((p: Record<string, string>) => Record<string, string>)) => store.set(sessStateMapAtom, u);
  const [linking, setLinking] = useState<string | null>(null);
  const linkingRef = useRef<string | null>(null); useEffect(() => { linkingRef.current = linking; }, [linking]);
  const edgesRef = useRef<Edge[]>([]); useEffect(() => { edgesRef.current = edges; }, [edges]);
  const sideRef = useRef<SidebarData>({ folders: [], workspaces: [], terminals: {} }); useEffect(() => { sideRef.current = side; }, [side]);
  const wireIdx = useRef(0);
  const [composerFor, setComposerFor] = useState<string | null>(null);
  const composerRef = useRef<string | null>(null); useEffect(() => { composerRef.current = composerFor; }, [composerFor]);
  const focusedTerm = useRef<string | null>(null);
  const [chatFor, setChatFor] = useState<string | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [features, setFeatures] = useState<string[]>([]);
  useEffect(() => { void api.capabilities().then((c) => setFeatures(c.features)).catch(() => {}); }, [api]);
  const [rolesDialog, setRolesDialog] = useState(false);
  const [floorDialog, setFloorDialog] = useState<Workspace | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [usage, setUsage] = useState(false);
  const fittedFor = useRef<string | null>(null); // espaço já enquadrado ao abrir
  const [renameSig, setRenameSig] = useState<{ id: string; n: number }>({ id: "", n: 0 });
  const bumpRename = (id: string) => setRenameSig((p) => ({ id, n: p.id === id ? p.n + 1 : 1 }));
  const homeDir = conn.homeDir ?? "";
  const [overview, setOverview] = useState<string | null>(null); // id do térreo
  const groundOf = (id: string | null): Workspace | null => { const w = side.workspaces.find((x) => x.workspaceId === id); if (!w) return null; return w.parentId ? side.workspaces.find((x) => x.workspaceId === w.parentId) ?? null : w; };
  const loadRoles = useCallback(() => api.roles().then((r) => setRoles((old) => (JSON.stringify(old) === JSON.stringify(r) ? old : r))).catch(() => {}), [api]);
  useEffect(() => { void loadRoles(); const t = setInterval(() => void loadRoles(), 4000); return () => clearInterval(t); }, [loadRoles]);
  useEffect(() => { if (dialog || rolesDialog) void loadRoles(); }, [dialog, rolesDialog, loadRoles]);
  const chatRef = useRef<string | null>(null); useEffect(() => { chatRef.current = chatFor; }, [chatFor]);
  const pickTerminal = () => flowRef.current.find((n) => n.selected && n.type === "terminal")?.id ?? focusedTerm.current ?? flowRef.current.find((n) => n.type === "terminal")?.id ?? null;
  const openChat = (id: string) => { setChatFor(id); setComposerFor(id); };
  const revision = useRef(0);
  const dragging = useRef(false);

  const LAST = "mess.lastWorkspace";
  const applySide = useCallback((d: SidebarData) => {
    setSide(d);
    setCurrent((c) => {
      if (c && d.workspaces.some((w) => w.workspaceId === c)) return c;
      let last: string | null = null; try { last = localStorage.getItem(LAST); } catch { /* sem storage */ }
      return d.workspaces.find((w) => w.workspaceId === last)?.workspaceId ?? d.workspaces[0]?.workspaceId ?? null;
    });
  }, []);
  const refreshList = useCallback(async () => { applySide(await api.sidebar()); }, [api, applySide]);
  useEffect(() => { void refreshList(); void api.presets().then(setPresets).catch(() => {}); void api.health().then((h) => setStale((h.buildVersion ?? 0) < BUILD_VERSION)).catch(() => {}); const t = setInterval(() => void refreshList().catch(() => {}), 4000); return () => clearInterval(t); }, [refreshList, api]);
  useEffect(() => stream.on((m) => { if (m.type === "sidebar") applySide(m.sidebar); }), [stream, applySide]);
  useEffect(() => { if (current) { try { localStorage.setItem(LAST, current); } catch { /* sem storage */ } } }, [current]);

  useEffect(() => {
    if (!current) { setSnap(null); return; }
    stream.subscribe(current);
    const off = stream.on((m) => {
      if (m.type === "workspace" && m.snapshot.workspace.workspaceId === current) { setSnap(m.snapshot); void api.unread(current).then(setUnread).catch(() => {}); }
      if (m.type === "message" && m.message.workspaceId === current) void api.unread(current).then(setUnread).catch(() => {});
      if (m.type === "session" && m.session.workspaceId === current) setSessState((st) => st[m.session.nodeId] === m.session.state ? st : { ...st, [m.session.nodeId]: m.session.state });
    });
    setSessState({}); setLinking(null); fittedFor.current = null;
    void api.snapshot(current).then(setSnap).catch(() => setCurrent(null));
    void api.unread(current).then(setUnread).catch(() => {});
    return () => { off(); stream.unsubscribe(current); };
  }, [current, stream, api]);

  const toast = (t: string) => { setMsg(t); setTimeout(() => setMsg(""), 3000); };
  // Aplica uma mutação; em CONFLICT (409 = nada foi escrito) recarrega a revisão fresca e tenta UMA vez.
  // Sem isso, mexer numa janela bumpa a revisão no servidor e a operação seguinte (alinhar/grade/arrastar)
  // falha calada enquanto o snapshot do WS não chega — "funciona 1x e depois não faz nada".
  const mutate = async (fn: (rev: number) => Promise<unknown>) => {
    for (let attempt = 0; ; attempt++) {
      try { await fn(revision.current); revision.current += 1; return; } // toda mutação sobe a revisão em 1; manter local evita 409 na operação seguinte
      catch (e) {
        if (e instanceof ApiClientError && e.error.code === "CONFLICT" && current) {
          if (typeof e.error.revision === "number") revision.current = e.error.revision;
          else { const s = await api.snapshot(current); setSnap(s); revision.current = s.workspace.revision; }
          if (attempt === 0) continue;
          setSnap(await api.snapshot(current)); toast("Conflito de revisão; estado recarregado.");
        } else toast(e instanceof ApiClientError ? `${e.error.code}: ${e.message}` : String(e));
        return;
      }
    }
  };

  useEffect(() => {
    if (!snap) { setFlow([]); setEdges([]); return; }
    revision.current = snap.workspace.revision;
    if (dragging.current) return; // não reconstruir durante arrasto/resize; o snapshot do patch do drop reconstrói logo em seguida
    const prev = new Map(flowRef.current.map((n) => [n.id, n]));
    setFlow(snap.nodes.map((n) => {
      const old = prev.get(n.nodeId); const keepLocal = dragging.current && old;
      const del = () => void mutate((r) => api.deleteNode(n.nodeId, r));
      const rename = (title: string) => void mutate((r) => api.patchNode(n.nodeId, { expectedRevision: r, title }));
      const change = (content: string) => void mutate((r) => api.patchNode(n.nodeId, { expectedRevision: r, content }));
      const linkCount = (snap.connections ?? []).filter((c) => c.sourceNodeId === n.nodeId || c.targetNodeId === n.nodeId).length;
      // atenção/não-lidas: o nó lê dos átomos (atoms.ts), não entram no rebuild.
      const extras = { onLink: () => startLink(n.nodeId), linkCount, onChat: () => (chatFor === n.nodeId ? setChatFor(null) : openChat(n.nodeId)), onRaise: () => toast("Elevar/acoplar: em breve") };
      return {
        id: n.nodeId, type: n.kind,
        position: keepLocal ? old.position : { x: n.geometry.x, y: n.geometry.y },
        style: keepLocal && old.style ? old.style : { width: n.geometry.w, height: n.geometry.h },
        ...(old?.selected ? { selected: true } : {}),
        data: n.kind === "terminal" ? { title: n.title, sessionId: n.sessionId!, api, stream, onDelete: del, onRename: rename, editSignal: renameSig.id === n.nodeId ? renameSig.n : 0, ...extras,
            composerOpen: composerFor === n.nodeId, onComposerClose: () => setComposerFor(null), workspaceId: snap.workspace.workspaceId,
            chatOpen: chatFor === n.nodeId, onChatClose: () => setChatFor(null),
            ...(n.roleId && roles.find((r) => r.roleId === n.roleId) ? { role: roles.find((r) => r.roleId === n.roleId)! } : {}), roles,
            onSetRole: (roleId: string | null) => void mutate((r) => api.patchNode(n.nodeId, { expectedRevision: r, roleId })), onManageRoles: () => setRolesDialog(true),
            onResume: () => void api.restart(n.nodeId).catch(() => {}),
            onFocus: () => { focusedTerm.current = n.nodeId; if (composerRef.current && composerRef.current !== n.nodeId) setComposerFor(n.nodeId); },
            targets: snap.nodes.filter((o) => o.nodeId !== n.nodeId && o.kind !== "text").map((o) => ({ id: o.nodeId, kind: o.kind as "terminal" | "note", title: o.title, connected: (snap.connections ?? []).some((c) => (c.sourceNodeId === n.nodeId && c.targetNodeId === o.nodeId) || (c.targetNodeId === n.nodeId && c.sourceNodeId === o.nodeId)) })) }
          : n.kind === "note" ? { title: n.title, content: n.content ?? "", editSignal: renameSig.id === n.nodeId ? renameSig.n : 0, locked: !!n.locked, ...(n.color ? { color: n.color } : {}), ...(n.filePath ? { filePath: n.filePath } : {}), onChange: change, onDelete: del, onRename: rename, ...extras,
              onLock: (locked: boolean) => void mutate((r) => api.patchNode(n.nodeId, { expectedRevision: r, locked })),
              onColor: (color: string | null) => void mutate((r) => api.patchNode(n.nodeId, { expectedRevision: r, color })),
              onMove: () => void window.messai.pickDirectory?.().then((d) => { if (d) void mutate((r) => api.patchNode(n.nodeId, { expectedRevision: r, filePath: `${d}/${n.title.replace(/[\\/:*?"<>|]+/g, " ").trim() || "nota"}.md` })); }) }
          : n.kind === "tree" ? { title: n.title, content: n.content ?? "", editSignal: renameSig.id === n.nodeId ? renameSig.n : 0, workspaceId: snap.workspace.workspaceId, api, onChange: change, onDelete: del, onRename: rename, ...extras,
              onOpenNote: (rel: string) => void mutate((r) => api.createNode(snap.workspace.workspaceId, { expectedRevision: r, kind: "note", geometry: { x: n.geometry.x + n.geometry.w + 40, y: n.geometry.y, w: 360, h: 260 }, filePath: `${snap.workspace.cwd}/${rel}` })),
              onPreview: (rel: string) => setPreview(rel), toast }
          : { content: n.content ?? "", onChange: change, onDelete: del, onRaise: extras.onRaise, editSignal: renameSig.id === n.nodeId ? renameSig.n : 0 },
      };
    }));
    setEdges((prevEdges) => (snap.connections ?? []).map((c) => {
      const style = c.style ?? "rope";
      const wasSelected = prevEdges.find((e) => e.id === c.connectionId)?.selected;
      const data: EdgeData = {
        style,
        onStyle: (st) => void mutate((r) => api.patchConnection(c.connectionId, { expectedRevision: r, style: st })),
        onCut: () => void mutate((r) => api.deleteConnection(c.connectionId, r)),
        onGo: (end) => selectNode(end === "source" ? c.sourceNodeId : c.targetNodeId),
      };
      return { id: c.connectionId, type: style, source: c.sourceNodeId, target: c.targetNodeId, deletable: true, data, ...(wasSelected ? { selected: true } : {}) };
    }));
  }, [snap, composerFor, chatFor, roles, renameSig]);

  /** Seleciona um nó e o traz para a vista. */
  const selectNode = (id: string) => {
    const next = flowRef.current.map((n) => ({ ...n, selected: n.id === id }));
    flowRef.current = next; setFlow(next);
    void rf.fitView({ nodes: [{ id }], padding: 0.5, duration: 200, maxZoom: 1.2 });
  };
  const startLink = (id: string) => { setLinking(id); toast("Conectar: clique no nó de destino (Esc cancela)"); };
  const finishLink = (targetId: string) => {
    const src = linkingRef.current; setLinking(null); if (!src || !current || src === targetId) return;
    if (edgesRef.current.some((e) => (e.source === src && e.target === targetId) || (e.source === targetId && e.target === src))) { toast("Já estão conectados"); return; }
    void mutate((r) => api.createConnectionRev(current, r, src, targetId));
  };
  const neighbors = (id: string) => edgesRef.current.flatMap((e) => (e.source === id ? [e.target] : e.target === id ? [e.source] : []));
  // Ao abrir um espaço, enquadra uma vez se houver nós (evita "canvas vazio" com tudo fora da vista).
  useEffect(() => {
    if (!snap || !current || fittedFor.current === current) return;
    if (snap.nodes.length === 0) { fittedFor.current = current; return; }
    const id = current;
    const t = setTimeout(() => { if (fittedFor.current === id) return; fittedFor.current = id; void rf.fitView({ padding: 0.2, duration: 300, maxZoom: 1.2 }).catch(() => {}); }, 120);
    return () => clearTimeout(t);
  }, [snap, current, rf]);
  useEffect(() => { flowRef.current = flow; }, [flow]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    // Updater funcional: aplica as mudanças sempre sobre o estado MAIS recente (flowRef pode estar atrasado),
    // senão um resize/arrasto sobrescreve a lista com uma versão antiga e os outros nós "somem" da tela.
    let next: FlowNode[] = [];
    setFlow((cur) => { next = applyNodeChanges(changes, cur); flowRef.current = next; return next; });
    for (const c of changes) {
      if (c.type !== "position" && c.type !== "dimensions") continue;
      const n = snap?.nodes.find((x) => x.nodeId === c.id); const f = next.find((x) => x.id === c.id);
      if (c.type === "position") {
        if (c.dragging) dragging.current = true;
        else if (n && f) { dragging.current = false; void mutate((r) => api.patchNode(c.id, { expectedRevision: r, geometry: { ...n.geometry, x: f.position.x, y: f.position.y } })); }
      }
      if (c.type === "dimensions") {
        if (c.resizing) { dragging.current = true; } // mantém o tamanho local durante o arrasto; não deixa o snapshot reverter
        else if (n && f) {
          dragging.current = false;
          // Dimensões reais: a própria mudança traz {width,height}; depois caímos para width/measured/style/antigo.
          const dim = (c as { dimensions?: { width?: number; height?: number } }).dimensions;
          const fw = f as FlowNode & { width?: number; height?: number; style?: { width?: number; height?: number } };
          const w = Math.round(Number(dim?.width ?? fw.width ?? f.measured?.width ?? fw.style?.width ?? n.geometry.w));
          const h = Math.round(Number(dim?.height ?? fw.height ?? f.measured?.height ?? fw.style?.height ?? n.geometry.h));
          if (w >= 40 && h >= 40 && (w !== n.geometry.w || h !== n.geometry.h)) void mutate((r) => api.patchNode(c.id, { expectedRevision: r, geometry: { ...n.geometry, w, h } }));
        }
      }
    }
  }, [snap, api]);

  const onConnect = useCallback((c: FlowConnection) => { if (current && c.source && c.target) void mutate((r) => api.createConnectionRev(current, r, c.source, c.target)); }, [current, api]);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => setEdges((es) => applyEdgeChanges(changes, es)), []);
  const onEdgesDelete = useCallback((del: Edge[]) => { for (const e of del) void mutate((r) => api.deleteConnection(e.id, r)); }, [api]);

  const ensureVisible = (g: Geometry) => {
    const main = document.querySelector("main.canvas")!.getBoundingClientRect();
    const tl = rf.screenToFlowPosition({ x: main.left, y: main.top }), br = rf.screenToFlowPosition({ x: main.right, y: main.bottom });
    const visible = g.x >= tl.x && g.y >= tl.y && g.x + g.w <= br.x && g.y + g.h <= br.y;
    if (!visible) setTimeout(() => void rf.fitView({ padding: 0.15, duration: 250 }), 80);
  };
  const createTerminal = (geometry: Geometry, i: NewTerminalInput) => {
    if (!current) return; setDialog(null);
    const preset = presets.find((p) => p.id === i.presetId);
    const cmdParts = i.command ? i.command.split(/\s+/) : undefined;
    const usePreset = preset && (!i.command || i.command === preset.command);
    void mutate(async (r) => { await api.createNode(current, { expectedRevision: r, kind: "terminal", geometry, title: i.title, ...(usePreset ? { command: preset.command, args: preset.args } : cmdParts ? { command: cmdParts[0]!, args: cmdParts.slice(1) } : {}), ...(i.cwd ? { cwd: i.cwd } : {}), ...(i.roleId ? { roleId: i.roleId } : {}), ...(i.persistent ? { persistent: true } : {}) }); ensureVisible(geometry); });
    setTool("select");
  };
  const createSimple = (kind: "note" | "text" | "tree", geometry: Geometry) => {
    if (!current) return;
    void mutate(async (r) => { await api.createNode(current, { expectedRevision: r, kind, geometry, content: "" }); ensureVisible(geometry); });
    setTool("select");
  };
  const onCreateRect = (kind: "terminal" | "note" | "text" | "tree", rect: CreateRect) => {
    const g = { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.max(40, Math.round(rect.w)), h: Math.max(40, Math.round(rect.h)) };
    if (kind === "terminal") setDialog({ rect: g }); else createSimple(kind, g);
  };
  const add = (choice: AddChoice, at?: { x: number; y: number }) => {
    setMenu(null); if (!current) return;
    const nodes = snap?.nodes ?? [];
    if (choice.kind === "note") return createSimple("note", freeSpot(nodes, SIZE.note, at));
    if (choice.kind === "tree") return createSimple("tree", freeSpot(nodes, SIZE.tree, at));
    const g = freeSpot(nodes, SIZE.terminal, at);
    const persistent = features.includes("terminal.tmux");
    if (choice.preset) createTerminal(g, { title: choice.preset.label, presetId: choice.preset.id, persistent });
    else if (choice.command) createTerminal(g, { title: choice.command, command: choice.command, persistent });
    else setDialog({ rect: g });
  };
  const viewCenter = (): { x: number; y: number } => { const m = document.querySelector("main.canvas")!.getBoundingClientRect(); return rf.screenToFlowPosition({ x: m.left + m.width / 2, y: m.top + m.height / 2 }); };
  const deleteSelected = async () => {
    const sel = flowRef.current.filter((n) => n.selected);
    for (const n of sel) await mutate((r) => api.deleteNode(n.id, r)); // sequencial: cada delete avança a revisão antes do próximo (sem colisão/flicker)
  };
  const duplicateSelected = async () => {
    const sel = flowRef.current.filter((n) => n.selected); if (!sel.length || !current) return;
    for (const n of sel) {
      try { const r = await api.duplicateNode(n.id, revision.current); revision.current = r.revision; }
      catch (e) { if (e instanceof ApiClientError && e.error.code === "CONFLICT") { setSnap(await api.snapshot(current)); } toast(e instanceof ApiClientError ? `${e.error.code}: ${e.message}` : String(e)); break; }
    }
  };
  // Alinhar/organizar: lê a geometria viva do flow (o efeito de atalhos não depende de snap), calcula no domínio (testado) e aplica tudo numa revisão só.
  const geoOf = (n: FlowNode): Geometry => ({ x: Math.round(n.position.x), y: Math.round(n.position.y), w: Math.round(Number((n.style as { width?: number } | undefined)?.width ?? n.measured?.width ?? 40)), h: Math.round(Number((n.style as { height?: number } | undefined)?.height ?? n.measured?.height ?? 40)) });
  const layoutSelected = (fn: (items: { id: string; geometry: Geometry }[]) => { id: string; geometry: Geometry }[], wantAll: boolean) => {
    if (!current) return;
    const all = flowRef.current; const sel = all.filter((n) => n.selected);
    const pool = sel.length >= 2 ? sel : wantAll ? all : [];
    if (pool.length < 2) { toast("Selecione 2+ nós"); return; }
    const items = pool.map((n) => ({ id: n.id, geometry: geoOf(n) }));
    const moves = fn(items); if (!moves.length) { toast("Os nós já estão alinhados"); return; }
    void mutate((r) => api.applyLayout(current, r, moves.map((m) => ({ nodeId: m.id, geometry: m.geometry }))));
  };
  const arrangeGrid = () => layoutSelected((items) => gridLayout(items, 40), true);
  const alignSelected = (mode: AlignMode) => layoutSelected((items) => alignGeometries(items, mode), false);

  // Atalhos (iguais ao Maestri onde já existe a função)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.shiftKey && e.key.toLowerCase() === "n") { e.preventDefault(); setWsDialog({}); return; }
      if (ctrl && !e.shiftKey && e.key.toLowerCase() === "b" && !isTyping()) { e.preventDefault(); setSideMini((v) => !v); return; } // dentro do terminal Ctrl+B é o prefixo do tmux
      if (ctrl && e.shiftKey && (e.key === "\\" || e.key === "|")) { e.preventDefault(); if (overview) setOverview(null); else { const g = groundOf(current); if (g) setOverview(g.workspaceId); else toast("Selecione um espaço"); } return; }
      if (ctrl && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault(); if (composerRef.current) { setComposerFor(null); return; }
        const sel = pickTerminal(); if (sel) setComposerFor(sel); else toast("Nenhum terminal para compor"); return;
      }
      if (ctrl && !e.shiftKey && e.key.toLowerCase() === "j") {
        e.preventDefault(); if (chatRef.current) { setChatFor(null); return; }
        const sel = pickTerminal(); if (sel) openChat(sel); else toast("Nenhum terminal para o chat"); return;
      }
      if (ctrl && e.key.toLowerCase() === "l" && !isTyping()) { /* no terminal Ctrl+L limpa a tela */ e.preventDefault(); const sel = flowRef.current.filter((n) => n.selected); if (sel.length === 1) startLink(sel[0]!.id); else toast("Selecione um nó para conectar"); return; }
      if (ctrl && e.key === "Tab") { e.preventDefault(); const ns = flowRef.current; if (!ns.length) return; const i = ns.findIndex((n) => n.selected); const j = (i + (e.shiftKey ? -1 : 1) + ns.length) % ns.length; selectNode(ns[j]!.id); return; }
      if (ctrl && e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault(); const sel = flowRef.current.find((n) => n.selected); if (!sel) return;
        const nb = neighbors(sel.id); if (!nb.length) { toast("Este nó não tem conexões"); return; }
        wireIdx.current = (wireIdx.current + (e.key === "ArrowRight" ? 1 : -1) + nb.length) % nb.length; selectNode(nb[wireIdx.current]!); return;
      }
      if (ctrl && e.shiftKey && e.key.toLowerCase() === "a") {
        e.preventDefault(); const att = flowRef.current.filter((n) => store.get(attentionAtom(n.id)));
        if (!att.length) { toast("Nenhum terminal precisa de atenção"); return; }
        const i = att.findIndex((n) => n.selected); selectNode(att[(i + 1) % att.length]!.id); return;
      }
      if (ctrl && e.altKey && e.key.toLowerCase() === "a") { e.preventDefault(); const att = flowRef.current.filter((n) => store.get(attentionAtom(n.id))); toast(att.length ? `Esperando: ${att.map((n) => String((n.data as { title?: string }).title ?? "texto")).join(", ")}` : "Nenhum terminal precisa de atenção"); return; }
      if (ctrl && !e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown" || ((e.key === "[" || e.key === "]") && !isTyping()))) { // Ctrl+[ no terminal é Esc
        e.preventDefault(); const ws = sideRef.current.workspaces; if (ws.length < 2) return;
        const i = ws.findIndex((w) => w.workspaceId === current); const d = e.key === "ArrowUp" || e.key === "[" ? -1 : 1;
        setCurrent(ws[(i + d + ws.length) % ws.length]!.workspaceId); return;
      }
      if (ctrl && !e.shiftKey && e.key.toLowerCase() === "t") { e.preventDefault(); if (current) { const c = viewCenter(); setDialog({ rect: { x: c.x - 320, y: c.y - 190, ...SIZE.terminal } }); } return; }
      if (ctrl && e.shiftKey && e.key.toLowerCase() === "d") { e.preventDefault(); if (current) { const c = viewCenter(); createSimple("note", { x: c.x - 130, y: c.y - 80, ...SIZE.note }); } return; }
      if (ctrl && e.shiftKey && e.key.toLowerCase() === "m") { e.preventDefault(); setMinimap((v) => !v); return; }
      if (ctrl && (e.key === "=" || e.key === "+")) { e.preventDefault(); void rf.zoomIn({ duration: 120 }); return; }
      if (ctrl && e.key === "-") { e.preventDefault(); void rf.zoomOut({ duration: 120 }); return; }
      if (ctrl && e.key === "\\") { e.preventDefault(); const sel = flowRef.current.filter((n) => n.selected); void rf.fitView(sel.length ? { nodes: sel, padding: 0.3, duration: 250 } : { padding: 0.15, duration: 250 }); return; }
      if (ctrl && !e.shiftKey && e.key.toLowerCase() === "d" && !isTyping()) { e.preventDefault(); void duplicateSelected(); return; }
      if (ctrl && e.shiftKey && e.key.toLowerCase() === "t") { e.preventDefault(); arrangeGrid(); return; } // Ctrl+Shift+T não é entrada de terminal; vale mesmo com o xterm focado
      if (ctrl && e.key.toLowerCase() === "w" && !isTyping()) { e.preventDefault(); deleteSelected(); return; }
      if ((e.key === "Delete" || e.key === "Backspace") && !isTyping() && flowRef.current.some((n) => n.selected)) { e.preventDefault(); deleteSelected(); return; }
      if (e.key === "Escape" && linkingRef.current) { setLinking(null); return; }
      if (e.key === "Escape" && overview) { setOverview(null); return; }
      if (isTyping() || ctrl || e.altKey) return;
      const k = e.key.toLowerCase();
      const map: Record<string, Tool> = { v: "select", t: "terminal", n: "note", l: "text", f: "tree", b: "draw", h: "pan" };
      if (map[k]) { setTool(map[k]!); if (k === "b") setStyle((s) => ({ ...s, kind: s.kind === "erase" ? "pen" : s.kind })); return; }
      if (k === "[") setStyle((s) => ({ ...s, width: Math.max(1, s.width - 1) }));
      if (k === "]") setStyle((s) => ({ ...s, width: Math.min(24, s.width + 1) }));
      if (e.key === "Escape") { setTool("select"); setMenu(null); setLinking(null); }
    };
    // Fase de captura: o xterm cancela a propagação das teclas que trata; os atalhos globais precisam vê-las antes.
    window.addEventListener("keydown", onKey, true); return () => window.removeEventListener("keydown", onKey, true);
  }, [current, rf, presets, overview, side]);

  const run = (p: Promise<unknown>) => p.then(() => refreshList()).catch((e) => toast(e instanceof ApiClientError ? `${e.error.code}: ${e.message}` : String(e)));
  const submitWs = async (i: WorkspaceInput) => {
    const d = wsDialog; setWsDialog(null);
    try {
      if (d?.edit) await api.patchWorkspace(d.edit.workspaceId, { expectedRevision: d.edit.revision, name: i.name, cwd: i.cwd, icon: i.icon, color: i.color, folderId: i.folderId ?? null });
      else { const w = await api.createWorkspace(i); setCurrent(w.workspaceId); }
      await refreshList();
    } catch (e) { toast(e instanceof ApiClientError ? `${e.error.code}: ${e.message}` : String(e)); }
  };
  const sideActions = {
    select: (id: string) => setCurrent(id),
    newWorkspace: (folderId?: string) => setWsDialog(folderId ? { folderId } : {}),
    editWorkspace: (w: Workspace) => setWsDialog({ edit: w }),
    deleteWorkspace: (w: Workspace) => { if (confirm(`Apagar "${w.name}" e encerrar seus processos?`)) void run(api.deleteWorkspace(w.workspaceId).then(() => { if (current === w.workspaceId) setCurrent(null); })); },
    moveWorkspace: (w: Workspace, folderId: string | null) => void run(api.patchWorkspace(w.workspaceId, { expectedRevision: w.revision, folderId })),
    newFolder: (kind: "folder" | "group", parentId?: string) => void askText(kind === "group" ? "Nome do grupo" : "Nome da pasta").then((name) => { if (name) void run(api.createFolder({ name, kind, ...(parentId ? { parentId } : {}) })); }),
    renameFolder: (f: Folder) => void askText("Novo nome", f.name).then((name) => { if (name && name !== f.name) void run(api.patchFolder(f.folderId, { name })); }),
    deleteFolder: (f: Folder) => { if (confirm(`Apagar "${f.name}"? Os espaços dentro ficam soltos.`)) void run(api.deleteFolder(f.folderId)); },
    toggleFolder: (f: Folder) => void run(api.patchFolder(f.folderId, { collapsed: !f.collapsed })),
    moveFolder: (f: Folder, parentId: string | null) => void run(api.patchFolder(f.folderId, { parentId })),
    newFloor: (g: Workspace) => setFloorDialog(g),
    overview: (g: Workspace) => setOverview(g.workspaceId),
  };
  const submitFloor = async (g: Workspace, i: Parameters<typeof api.createFloor>[1]) => {
    setFloorDialog(null);
    try { const f = await api.createFloor(g.workspaceId, i); await refreshList(); setCurrent(f.workspaceId); toast(`Andar "${f.name}" criado na branch ${f.branch ?? "(sem branch)"}`); }
    catch (e) { toast(e instanceof ApiClientError ? `${e.error.code}: ${e.message}` : String(e)); }
  };
  const drawings: Drawing[] = snap?.drawings ?? [];
  const selectMode = tool === "select";
  const barAgents = (() => { const set = new Set<string>(); for (const n of snap?.nodes ?? []) if (n.kind === "terminal") set.add(agentKind(n.title)); return [...set]; })();
  const curWs = side.workspaces.find((w) => w.workspaceId === current);
  const grd = groundOf(current);

  return (
    <div className={`app ${sideMini ? "mini" : ""}`}>
      <Sidebar data={side} current={current} collapsed={sideMini} machine={conn.baseUrl.replace("http://", "")} act={sideActions} />
      <main className={`canvas tool-${tool} ${linking ? "linking" : ""}`}
        onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) e.preventDefault(); }}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length || !current) return; e.preventDefault();
          const at = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
          [...e.dataTransfer.files].forEach((f, i) => {
            const path = window.messai.pathForFile?.(f);
            if (path && /\.(md|markdown|txt)$/i.test(path)) void mutate((r) => api.createNode(current, { expectedRevision: r, kind: "note", geometry: { x: at.x + i * 30, y: at.y + i * 30, w: 320, h: 220 }, filePath: path }));
            else toast(`${f.name}: só .md/.txt viram nota (outros arquivos: em breve)`);
          });
        }} onContextMenu={(e) => { e.preventDefault(); if (!current || tool !== "select") return; const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: e.clientX - r.left, y: e.clientY - r.top, at: rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }) }); }}>
        <Toolbar tool={tool} setTool={setTool} style={style} setStyle={setStyle} onFileTree={() => {}} onPortal={() => toast("Portais: em breve")} />
        {(() => {
          const selNodes = flow.filter((n) => n.selected);
          if (selNodes.length !== 1) return null;
          const sn = selNodes[0]!; const id = sn.id; const kind = sn.type as NodeAction["kind"];
          const node = snap?.nodes.find((x) => x.nodeId === id);
          const linkCount = (snap?.connections ?? []).filter((c) => c.sourceNodeId === id || c.targetNodeId === id).length;
          const a: NodeAction = {
            kind,
            onEdit: () => bumpRename(id),
            onRaise: () => toast("Elevar/acoplar: em breve"),
            onDuplicate: () => void duplicateSelected(),
            linkCount,
            onDelete: () => deleteSelected(),
            ...(kind !== "text" ? { onLink: () => startLink(id) } : {}),
            ...(kind === "terminal" ? { onChat: () => (chatFor === id ? setChatFor(null) : openChat(id)), onReload: () => void api.restart(id) } : {}),
            ...(kind === "tree" ? { onReload: () => { if (node) toast("Use o botão de atualizar da árvore"); } } : {}),
          };
          return <NodeActionBar a={a} />;
        })()}
        {flow.filter((n) => n.selected).length >= 2 && (
          <div className="align-bar" data-testid="align-bar">
            <button className="tb" title="Alinhar à esquerda" onClick={() => alignSelected("left")}><AlignStartVertical size={15} /></button>
            <button className="tb" title="Centralizar (horizontal)" onClick={() => alignSelected("hcenter")}><AlignCenterVertical size={15} /></button>
            <button className="tb" title="Alinhar à direita" onClick={() => alignSelected("right")}><AlignEndVertical size={15} /></button>
            <span className="sep" />
            <button className="tb" title="Alinhar ao topo" onClick={() => alignSelected("top")}><AlignStartHorizontal size={15} /></button>
            <button className="tb" title="Centralizar (vertical)" onClick={() => alignSelected("vcenter")}><AlignCenterHorizontal size={15} /></button>
            <button className="tb" title="Alinhar embaixo" onClick={() => alignSelected("bottom")}><AlignEndHorizontal size={15} /></button>
            <span className="sep" />
            <button className="tb" title="Organizar em grade (Ctrl+Shift+T)" onClick={arrangeGrid}><LayoutGrid size={15} /></button>
          </div>
        )}
        <div className="info-bar">{snap?.workspace.parentId && <span className="floor-badge" style={{ borderColor: STATUS_COLOR[snap.workspace.status ?? "working"] }} title={STATUS_LABEL[snap.workspace.status ?? "working"]}>andar · {snap.workspace.branch}</span>}{snap ? `${snap.workspace.name} · rev ${snap.workspace.revision} · ${snap.nodes.length} nós` : "sem espaço"}{linking ? " — conectar: clique no destino (Esc cancela)" : ""}{msg ? ` — ${msg}` : ""}</div>
        <button className="pri add-btn" data-testid="add" disabled={!current} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); const p = e.currentTarget.closest("main")!.getBoundingClientRect(); setMenu({ x: r.left - p.left, y: r.bottom - p.top + 4 }); }}>+ Adicionar</button>
        {stale && <div className="banner">O runtime em execução é de uma versão anterior ao app. Reinicie o runtime para usar os recursos novos (isso encerra os shells dele; eles ficam como "lost" e podem ser reiniciados).</div>}
        {!current && <div className="empty">Crie um espaço com o botão + da barra lateral ou Ctrl+Shift+N.</div>}
        {wsDialog && <WorkspaceDialog {...(wsDialog.edit ? { edit: wsDialog.edit } : {})} {...(wsDialog.folderId ? { defaultFolderId: wsDialog.folderId } : {})} defaultCwd={homeDir} folders={side.folders} onSubmit={(i) => void submitWs(i)} onClose={() => setWsDialog(null)} />}
        {menu && <AddMenu presets={presets} x={menu.x} y={menu.y} onClose={() => setMenu(null)} onPick={(c) => add(c, menu.at)} />}
        {dialog && <NewTerminalDialog presets={presets} roles={roles} defaultCwd={snap?.workspace.cwd || homeDir} onClose={() => { setDialog(null); setTool("select"); }} onCreate={(i) => createTerminal(dialog.rect, i)} onManageRoles={() => setRolesDialog(true)} tmux={features.includes("terminal.tmux")} />}
        {preview && snap && <FilePreview api={api} workspaceId={snap.workspace.workspaceId} path={preview} onClose={() => setPreview(null)} onOpenNote={(rel) => { setPreview(null); void mutate((r) => api.createNode(snap.workspace.workspaceId, { expectedRevision: r, kind: "note", geometry: { ...freeSpot(snap.nodes, { w: 360, h: 260 }), w: 360, h: 260 }, filePath: `${snap.workspace.cwd}/${rel}` })); }} />}
        {floorDialog && <FloorDialog ground={floorDialog} onSubmit={(i) => void submitFloor(floorDialog, i)} onClose={() => setFloorDialog(null)} />}
        {overview && groundOf(overview) && <FloorOverview ground={groundOf(overview)!} floors={side.workspaces.filter((w) => w.parentId === overview)} current={current} terminals={side.terminals} api={api}
          onOpen={(id) => { setCurrent(id); setOverview(null); }} onNew={() => { setFloorDialog(groundOf(overview)!); }} onClose={() => setOverview(null)} onChanged={() => void refreshList()} onError={toast} />}
        {rolesDialog && <RolesDialog api={api} workspaceCwd={snap?.workspace.cwd ?? ""} onClose={() => setRolesDialog(false)} onChanged={() => void loadRoles()} />}
        <ReactFlow nodes={flow} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} onEdgesDelete={onEdgesDelete}
          onNodeClick={(_, n) => { if (linkingRef.current) finishLink(n.id); }} onPaneClick={() => { if (linkingRef.current) setLinking(null); }}
          nodesDraggable={selectMode} nodesConnectable={selectMode} elementsSelectable={selectMode} panOnDrag={tool === "pan" ? [0, 1, 2] : selectMode ? [1, 2] : false} selectionOnDrag={selectMode} panOnScroll zoomOnScroll={false} zoomActivationKeyCode="Alt" panActivationKeyCode="Control" multiSelectionKeyCode={null}
          nodesFocusable={false} fitView minZoom={0.1} maxZoom={3} proOptions={{ hideAttribution: true }} colorMode="dark" deleteKeyCode="Delete"
          onNodesDelete={() => {}} onBeforeDelete={async ({ nodes: ns, edges: es }) => ({ nodes: [], edges: ns.length ? [] : es })}>
          <Background variant={BackgroundVariant.Lines} gap={48} size={1} color="#2c2c30" />
          {minimap && <MiniMap pannable zoomable />}
          <DrawingLayer tool={tool} style={style} drawings={drawings}
            onDraw={(d) => current && void mutate((r) => api.createDrawing(current, { expectedRevision: r, ...d }))}
            onErase={(id) => void mutate((r) => api.deleteDrawing(id, r))}
            onCreateRect={onCreateRect} />
        </ReactFlow>
        <ZoomBar minimap={minimap} setMinimap={setMinimap} onUsage={() => setUsage(true)} agents={barAgents} {...(curWs ? { wsName: curWs.name } : {})} inFloors={!!overview} onFloors={() => (overview ? setOverview(null) : grd && setOverview(grd.workspaceId))} />
        {usage && <AgentUsage api={api} onClose={() => setUsage(false)} />}
      </main>
    </div>
  );
}

export function App({ conn }: { conn: Connection }) { return <ReactFlowProvider><Canvas conn={conn} /></ReactFlowProvider>; }
