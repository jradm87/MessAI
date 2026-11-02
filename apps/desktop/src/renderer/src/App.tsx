import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Background, BackgroundVariant, MiniMap, ReactFlow, applyNodeChanges, applyEdgeChanges, type EdgeChange, useReactFlow, ReactFlowProvider, useOnViewportChange, type Connection as FlowConnection, type Edge, type EdgeTypes, type Node as FlowNode, type NodeChange, type NodeTypes } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Map as MapIcon, Minus, Plus, Activity, Layers, AlignStartVertical, AlignCenterVertical, AlignEndVertical, AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal, LayoutGrid, Sun, Moon, Monitor, Sparkles, Undo2, Redo2, Magnet } from "lucide-react";
import { useAtomValue } from "jotai";
import { themeAtom } from "./atoms.js";
import { getThemePref, setThemePref, nextTheme, THEME_LABEL, cssVar } from "./theme.js";
import { BUILD_VERSION, type Role, type Drawing, type Folder, type Geometry, type Node, type NodeGroup, type Preset, type Sidebar as SidebarData, type Skill, type TermTheme, type Workspace, type WorkspaceSnapshot } from "@messai/contracts";
import { gridLayout, alignGeometries, type AlignMode, snapGeometry } from "@messai/domain";
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
import { store, sessStateMapAtom, unreadMapAtom, attentionAtom, finishedMapAtom, summaryMapAtom } from "./atoms.js";
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
import { ShutdownOverlay } from "./ShutdownOverlay.js";
import { Preferences } from "./Preferences.js";
import { setPref, usePref } from "./prefs.js";
import { ACTION_BY_ID, comboFromEvent, effectiveCombo, sameCombo, type Keymap } from "./keymap.js";
import { History, plural, type ConnSpec, type DrawingSpec, type NodeSpec, type Op } from "./undo.js";
import { GroupLayer, type Guides } from "./GroupLayer.js";
import { Palette, type PaletteAction } from "./Palette.js";
import type { PaletteItem } from "./palette.js";
import { useHint, useKeymap } from "./shortcuts.js";

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

type UndoProps = { canUndo: boolean; canRedo: boolean; undoLabel: string | null; redoLabel: string | null; onUndo: () => void; onRedo: () => void };
function ZoomBar({ minimap, setMinimap, onUsage, agents, wsName, inFloors, onFloors, hud, onHud, history }: { minimap: boolean; setMinimap: (v: boolean) => void; onUsage: () => void; agents: string[]; wsName?: string; inFloors: boolean; onFloors: () => void; hud: boolean; onHud: () => void; history: UndoProps }) {
  const rf = useReactFlow(); const [z, setZ] = useState(100);
  useOnViewportChange({ onChange: (v) => setZ(Math.round(v.zoom * 100)) });
  useAtomValue(themeAtom); // re-renderiza o botão quando o tema efetivo muda
  const pref = getThemePref(); const ThemeIcon = pref === "light" ? Sun : pref === "dark" ? Moon : Monitor;
  // #38 Agent Usage: desligado em Preferências → Agentes → Uso some da barra; provedores escondidos também
  const hMini = useHint("minimap.toggle"); const hIn = useHint("zoom.in"); const hOut = useHint("zoom.out"); const hMagnet = useHint("snap.toggle"); // #58 tooltips seguem o keymap
  const magnetOn = usePref("snapMagnetic"); // #78
  const usageOn = usePref("usageEnabled"); const hidden = new Set(usePref("usageDisabled").split(",").filter(Boolean));
  const shownAgents = usageOn ? agents.filter((a) => !hidden.has(a)) : [];
  return (
    <div className="botbar">
      {wsName && <button className={`bb-pill ${inFloors ? "on" : ""}`} title="Andares" onClick={onFloors} data-testid="ws-pill"><Layers size={15} /><span className="bb-name">{inFloors ? "Floors" : wsName}</span></button>}
      {shownAgents.slice(0, 5).map((a) => <button key={a} className="bb-circle" title={`${a} — Agent Usage`} data-testid="bb-agent" onClick={onUsage}><AgentIcon id={a} size={20} /></button>)}
      {usageOn && shownAgents.length === 0 && <button className="bb-circle" title="Agent Usage" data-testid="bb-usage" onClick={onUsage}><Activity size={15} /></button>}
      <button className="bb-circle" title={`Tema: ${THEME_LABEL[pref]} (clique alterna Sistema → Claro → Escuro)`} data-testid="theme-toggle" onClick={() => setThemePref(nextTheme(pref))}><ThemeIcon size={15} /></button>
      <button className={`bb-circle ${magnetOn ? "on" : ""}`} title={`Encaixe magnético ao arrastar: ${magnetOn ? "ligado" : "desligado"}${hMagnet}`} data-testid="snap-toggle" onClick={() => setPref("snapMagnetic", !magnetOn)}><Magnet size={15} /></button>
      <button className="bb-circle" title={history.canUndo ? `Desfazer: ${history.undoLabel} (Ctrl+Z)` : "Nada para desfazer"} disabled={!history.canUndo} data-testid="undo" onClick={history.onUndo}><Undo2 size={15} /></button>
      <button className="bb-circle" title={history.canRedo ? `Refazer: ${history.redoLabel} (Ctrl+Shift+Z)` : "Nada para refazer"} disabled={!history.canRedo} data-testid="redo" onClick={history.onRedo}><Redo2 size={15} /></button>
      <button className={`bb-circle ${hud ? "on" : ""}`} title={hud ? "Companheiro: fechar janela flutuante" : "Companheiro: abrir janela flutuante (agentes que terminaram, resumo e próximo passo)"} data-testid="hud-toggle" onClick={onHud}><Sparkles size={15} /></button>
      <button className="bb-circle" title={`Minimapa${hMini}`} onClick={() => setMinimap(!minimap)}><MapIcon size={15} /></button>
      <div className="bb-zoom">
        <button className="tb" title={`Reduzir${hOut}`} onClick={() => void rf.zoomOut({ duration: 120 })}><Minus size={14} /></button>
        <span className="pct" onClick={() => void rf.zoomTo(1, { duration: 150 })} title="100%">{z}%</span>
        <button className="tb" title={`Ampliar${hIn}`} onClick={() => void rf.zoomIn({ duration: 120 })}><Plus size={14} /></button>
      </div>
    </div>
  );
}

function Canvas({ conn }: { conn: Connection }) {
  useAtomValue(themeAtom); // a grade do canvas e o fundo seguem o tema; re-render ao trocar
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
  const [selDrawings, setSelDrawings] = useState<Set<string>>(new Set());
  const selDrawingsRef = useRef(selDrawings); useEffect(() => { selDrawingsRef.current = selDrawings; }, [selDrawings]);
  const [minimap, setMinimap] = useState(true);
  const [toasts, setToasts] = useState<{ id: number; text: string; kind: "info" | "err" | "ok" }[]>([]);
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
  const [prefsOpen, setPrefsOpen] = useState(false); // #64 janela de Preferências
  const [paletteOpen, setPaletteOpen] = useState(false); // #69 paleta global
  const keymap = useKeymap(); const keymapRef = useRef<Keymap>(keymap); keymapRef.current = keymap; // #58 atalhos editáveis
  // #67: estado da janela flutuante do companheiro (vive no processo principal; aqui só espelho + preferência).
  const [hud, setHud] = useState(false);
  const HUD_PREF = "mess.hud";
  useEffect(() => {
    const m = window.messai;
    const off = m.onHudState?.((o) => { setHud(o); try { localStorage.setItem(HUD_PREF, o ? "1" : "0"); } catch { /* sem storage */ } });
    void m.hudState?.().then(async (o) => {
      setHud(o); if (o) return;
      let want = false; try { want = localStorage.getItem(HUD_PREF) === "1"; } catch { /* sem storage */ }
      if (!want) return;
      const c = await api.companion().catch(() => null);
      if (c && !c.enabled) return; // companheiro desligado (MESS_COMPANION=0): não reabre sozinho; o toggle manual continua valendo
      void m.hudToggle?.(true);
    });
    return () => off?.();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const fittedFor = useRef<string | null>(null); // espaço já enquadrado ao abrir
  const pendingFocus = useRef<string | null>(null); // nó a selecionar assim que o espaço pedido pelo HUD carregar
  const [renameSig, setRenameSig] = useState<{ id: string; n: number }>({ id: "", n: 0 });
  const bumpRename = (id: string) => setRenameSig((p) => ({ id, n: p.id === id ? p.n + 1 : 1 }));
  const homeDir = conn.homeDir ?? "";
  const [overview, setOverview] = useState<string | null>(null); // id do térreo
  const groundOf = (id: string | null): Workspace | null => { const w = side.workspaces.find((x) => x.workspaceId === id); if (!w) return null; return w.parentId ? side.workspaces.find((x) => x.workspaceId === w.parentId) ?? null : w; };
  const loadRoles = useCallback(() => api.roles().then((r) => setRoles((old) => (JSON.stringify(old) === JSON.stringify(r) ? old : r))).catch(() => {}), [api]);
  const [skills, setSkills] = useState<Skill[]>([]); // #57
  const loadSkills = useCallback(() => api.skills().then((r) => setSkills((old) => (JSON.stringify(old) === JSON.stringify(r) ? old : r))).catch(() => {}), [api]);
  useEffect(() => { void loadSkills(); const t = setInterval(() => void loadSkills(), 4000); return () => clearInterval(t); }, [loadSkills]);
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
      if (m.type === "taskFinished" && m.event.workspaceId === current) store.set(finishedMapAtom, (p) => ({ ...p, [m.event.nodeId]: m.event.at })); // #65: acende atenção no nó
      if (m.type === "taskSummary" && m.summary.workspaceId === current) store.set(summaryMapAtom, (p) => ({ ...p, [m.summary.nodeId]: { summary: m.summary.summary, nextStep: m.summary.nextStep, at: m.summary.at, model: m.summary.model } })); // #66
      if (m.type === "session" && m.session.workspaceId === current) setSessState((st) => st[m.session.nodeId] === m.session.state ? st : { ...st, [m.session.nodeId]: m.session.state });
    });
    setSessState({}); setLinking(null); setSelDrawings(new Set()); fittedFor.current = null;
    void api.snapshot(current).then(setSnap).catch(() => setCurrent(null));
    void api.unread(current).then(setUnread).catch(() => {});
    return () => { off(); stream.unsubscribe(current); };
  }, [current, stream, api]);

  // ===== #77 desfazer/refazer: uma pilha por espaço; operações descritas como dados (undo.ts) e executadas aqui contra a API =====
  const histories = useRef(new Map<string, History>());
  const snapRef = useRef<WorkspaceSnapshot | null>(snap); snapRef.current = snap; // os handlers de teclado capturam closures antigas: leem o snapshot pela ref
  // #78 encaixe magnético: liga/desliga pelo botão ímã (ou tecla M, pref `snapMagnetic`); segurar Alt durante o arrasto também
  // vale, mas no Linux o gerenciador de janelas costuma capturar Alt+arrastar (e Shift/Ctrl são do React Flow) — por isso o toggle.
  const altRef = useRef(false);
  const magnet = usePref("snapMagnetic"); const magnetRef = useRef(magnet); magnetRef.current = magnet;
  const snappedRef = useRef(new Map<string, { x: number; y: number }>()); // posição encaixada por nó durante o arrasto (o onNodeDragStop lê daqui)
  const [guides, setGuides] = useState<Guides>({ vertical: [], horizontal: [] });
  useEffect(() => { const d = (e: KeyboardEvent) => { if (e.key === "Alt") altRef.current = true; }; const u = (e: KeyboardEvent) => { if (e.key === "Alt") altRef.current = false; }; const blur = () => { altRef.current = false; }; window.addEventListener("keydown", d, true); window.addEventListener("keyup", u, true); window.addEventListener("blur", blur); return () => { window.removeEventListener("keydown", d, true); window.removeEventListener("keyup", u, true); window.removeEventListener("blur", blur); }; }, []);
  const groupsOf = (): NodeGroup[] => snapRef.current?.groups ?? [];
  const membersOf = (groupId: string): string[] => (snapRef.current?.nodes ?? []).filter((n) => n.groupId === groupId).map((n) => n.nodeId);
  const selectNodes = (ids: string[]) => { const set = new Set(ids); const next = flowRef.current.map((n) => ({ ...n, selected: set.has(n.id) })); flowRef.current = next; setFlow(next); };
  /** Agrupa os nós selecionados (≥2) com inversa; devolve false se não havia o que agrupar. */
  const groupSelectedNodes = async (): Promise<boolean> => {
    const ids = flowRef.current.filter((n) => n.selected).map((n) => n.id); if (ids.length < 2 || !current) return false;
    try { const r = await runOp((rev) => api.createNodeGroup(current, { expectedRevision: rev, nodeIds: ids })); rec({ label: `agrupar ${plural(ids.length, "nó", "nós")}`, forward: [{ type: "createGroup", ref: r.group.groupId, spec: { nodeIds: ids, label: "", color: "" } }], inverse: [{ type: "deleteGroup", id: r.group.groupId }] }); toast(`Grupo criado com ${ids.length} nós — duplo clique no rótulo para nomear`); } catch { /* já avisou */ }
    return true;
  };
  const ungroup = async (groupId: string) => {
    const g = groupsOf().find((x) => x.groupId === groupId); if (!g) return;
    const members = membersOf(groupId);
    try { await runOp((rev) => api.deleteNodeGroup(groupId, rev)); rec({ label: "desagrupar", forward: [{ type: "deleteGroup", id: groupId }], inverse: [{ type: "createGroup", ref: groupId, spec: { nodeIds: members, label: g.label, color: g.color } }] }); } catch { /* já avisou */ }
  };
  const patchGroup = (groupId: string, patch: { label?: string; color?: string }) => {
    const g = groupsOf().find((x) => x.groupId === groupId); if (!g) return;
    const inverse: { label?: string; color?: string } = {}; if (patch.label !== undefined) inverse.label = g.label; if (patch.color !== undefined) inverse.color = g.color;
    void mutate((r) => api.patchNodeGroup(groupId, { expectedRevision: r, ...patch }));
    rec({ label: patch.label !== undefined ? "renomear grupo" : "cor do grupo", forward: [{ type: "patchGroup", id: groupId, patch }], inverse: [{ type: "patchGroup", id: groupId, patch: inverse }] });
  };
  const [histTick, setHistTick] = useState(0); // re-render dos botões/rótulos
  const bump = () => setHistTick((t) => t + 1);
  /** Como `mutate`, mas PROPAGA o erro (a pilha precisa saber que falhou) e devolve o que a API respondeu. */
  const runOp = async <T,>(fn: (rev: number) => Promise<T>): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
      try { const out = await fn(revision.current); revision.current += 1; return out; }
      catch (e) {
        if (e instanceof ApiClientError && e.error.code === "CONFLICT" && current && attempt === 0) { if (typeof e.error.revision === "number") revision.current = e.error.revision; else { const sn = await api.snapshot(current); setSnap(sn); revision.current = sn.workspace.revision; } continue; }
        toast(e instanceof ApiClientError ? `${e.error.code}: ${e.message}` : String(e), "err"); throw e;
      }
    }
  };
  const execOp = (wsId: string) => async (op: Op): Promise<string | void> => {
    switch (op.type) {
      case "createNode": { const sp = op.spec; const r = await runOp((rev) => api.createNode(wsId, { expectedRevision: rev, kind: sp.kind, title: sp.title, geometry: sp.geometry, ...(sp.content !== undefined ? { content: sp.content } : {}), ...(sp.color ? { color: sp.color } : {}), ...(sp.icon ? { icon: sp.icon } : {}), ...(sp.termTheme ? { termTheme: sp.termTheme } : {}), ...(sp.roleId ? { roleId: sp.roleId } : {}), ...(sp.skillIds?.length ? { skillIds: sp.skillIds } : {}), ...(sp.command ? { command: sp.command, args: sp.args ?? [] } : {}), ...(sp.cwd ? { cwd: sp.cwd } : {}), ...(sp.persistent ? { persistent: true } : {}) })); return r.node.nodeId; }
      case "deleteNode": await runOp((rev) => api.deleteNode(op.id, rev)); return;
      case "patchNode": await runOp((rev) => api.patchNode(op.id, { expectedRevision: rev, ...op.patch })); return;
      case "layout": await runOp((rev) => api.applyLayout(wsId, rev, op.moves)); return;
      case "createConnection": { const c = await runOp((rev) => api.createConnectionRev(wsId, rev, op.spec.sourceNodeId, op.spec.targetNodeId)); if (op.spec.style && op.spec.style !== "rope") await runOp((rev) => api.patchConnection(c.connectionId, { expectedRevision: rev, style: op.spec.style as "rope" | "circuit" })); return c.connectionId; }
      case "deleteConnection": await runOp((rev) => api.deleteConnection(op.id, rev)); return;
      case "patchConnection": await runOp((rev) => api.patchConnection(op.id, { expectedRevision: rev, ...op.patch })); return;
      case "createDrawing": { const d = await runOp((rev) => api.createDrawing(wsId, { expectedRevision: rev, kind: op.spec.kind as "pen" | "line" | "arrow" | "rect", points: op.spec.points, color: op.spec.color, width: op.spec.width })); return d.drawingId; }
      case "deleteDrawing": await runOp((rev) => api.deleteDrawing(op.id, rev)); return;
      case "patchDrawing": await runOp((rev) => api.patchDrawing(op.id, { expectedRevision: rev, points: op.points })); return;
      case "groupDrawings": await runOp((rev) => api.groupDrawings(wsId, { expectedRevision: rev, drawingIds: op.ids, grouped: op.grouped })); return;
      case "createGroup": { const r = await runOp((rev) => api.createNodeGroup(wsId, { expectedRevision: rev, nodeIds: op.spec.nodeIds, label: op.spec.label, color: op.spec.color })); return r.group.groupId; }
      case "deleteGroup": await runOp((rev) => api.deleteNodeGroup(op.id, rev)); return;
      case "patchGroup": await runOp((rev) => api.patchNodeGroup(op.id, { expectedRevision: rev, ...op.patch })); return;
    }
  };
  const hist = (wsId = current): History => { const id = wsId ?? "__none__"; let h = histories.current.get(id); if (!h) { h = new History(execOp(id)); histories.current.set(id, h); } return h; };
  const rec = (e: { label: string; forward: Op[]; inverse: Op[]; key?: string }) => { hist().record(e); bump(); };
  /** Spec de recriação de um nó a partir do snapshot (+ sessão, para terminais). */
  const specOf = async (n: Node): Promise<NodeSpec> => {
    const sp: NodeSpec = { kind: n.kind, title: n.title, geometry: n.geometry, ...(n.content !== undefined ? { content: n.content } : {}), ...(n.color ? { color: n.color } : {}), ...(n.icon ? { icon: n.icon } : {}), ...(n.termTheme ? { termTheme: n.termTheme as TermTheme } : {}), ...(n.roleId ? { roleId: n.roleId } : {}), ...(n.skillIds?.length ? { skillIds: n.skillIds } : {}) };
    if (n.kind === "terminal" && n.sessionId) { const ses = await api.session(n.sessionId).catch(() => null); if (ses) { sp.command = ses.command; sp.args = ses.args; sp.cwd = ses.cwd; if (ses.persistent) sp.persistent = true; } }
    return sp;
  };
  const connSpec = (c: { sourceNodeId: string; targetNodeId: string; style?: string }): ConnSpec => ({ sourceNodeId: c.sourceNodeId, targetNodeId: c.targetNodeId, ...(c.style ? { style: c.style } : {}) });
  const drawSpec = (d: { kind: string; points: [number, number][]; color: string; width: number; groupId?: string }): DrawingSpec => ({ kind: d.kind, points: d.points, color: d.color, width: d.width, ...(d.groupId ? { groupId: d.groupId } : {}) });
  /** Exclui nós (e suas conexões) registrando a inversa: recriar nó + reconectar. Vários nós = uma etapa. */
  const deleteNodes = async (ids: string[]) => {
    const sn = snapRef.current; if (!ids.length || !sn) return;
    const h = hist(); if (ids.length > 1) h.beginGroup(`excluir ${plural(ids.length, "nó", "nós")}`);
    for (const id of ids) {
      const n = sn.nodes.find((x) => x.nodeId === id); if (!n) { try { await runOp((rev) => api.deleteNode(id, rev)); } catch { /* já avisou */ } continue; } // fora do snapshot: apaga sem inversa (não some da tela sem motivo)
      const sp = await specOf(n);
      const conns = (sn.connections ?? []).filter((c) => c.sourceNodeId === id || c.targetNodeId === id);
      try { await runOp((rev) => api.deleteNode(id, rev)); } catch { continue; }
      h.record({ label: `excluir ${n.kind === "terminal" ? "terminal" : n.kind === "note" ? "nota" : "nó"}`, forward: [{ type: "deleteNode", id }], inverse: [{ type: "createNode", ref: id, spec: sp }, ...conns.map((c): Op => ({ type: "createConnection", ref: c.connectionId, spec: connSpec(c) }))] });
    }
    if (ids.length > 1) h.endGroup(); bump();
  };
  /** PATCH num nó com inversa calculada a partir dos campos atuais. `key` funde edições seguidas (digitação). */
  const patchRec = (n: Node, patch: Record<string, unknown>, label: string, key?: string) => {
    const inverse: Record<string, unknown> = {};
    for (const k of Object.keys(patch)) { const cur = (n as unknown as Record<string, unknown>)[k]; inverse[k] = cur === undefined ? (k === "content" || k === "title" ? "" : null) : cur; }
    void mutate((r) => api.patchNode(n.nodeId, { expectedRevision: r, ...patch }));
    rec({ label, forward: [{ type: "patchNode", id: n.nodeId, patch }], inverse: [{ type: "patchNode", id: n.nodeId, patch: inverse }], ...(key ? { key } : {}) });
  };
  const undo = async () => { const h = hist(); if (!h.canUndo) { toast("Nada para desfazer"); return; } try { const e = await h.undo(); if (e) toast(`Desfeito: ${e.label}`, "ok"); } catch { /* já avisou */ } bump(); };
  const redo = async () => { const h = hist(); if (!h.canRedo) { toast("Nada para refazer"); return; } try { const e = await h.redo(); if (e) toast(`Refeito: ${e.label}`, "ok"); } catch { /* já avisou */ } bump(); };
  void histTick;

  const toast = (text: string, kind: "info" | "err" | "ok" = "info") => {
    const id = Date.now() + Math.random();
    setToasts((ts) => [...ts, { id, text, kind }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 4000);
  };
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
      const del = () => void deleteNodes([n.nodeId]);
      const rename = (title: string) => patchRec(n, { title }, "renomear", `title:${n.nodeId}`);
      const change = (content: string) => patchRec(n, { content }, "editar conteúdo", `content:${n.nodeId}`);
      const linkCount = (snap.connections ?? []).filter((c) => c.sourceNodeId === n.nodeId || c.targetNodeId === n.nodeId).length;
      // atenção/não-lidas: o nó lê dos átomos (atoms.ts), não entram no rebuild.
      const extras = { onLink: () => startLink(n.nodeId), linkCount, onChat: () => (chatFor === n.nodeId ? setChatFor(null) : openChat(n.nodeId)), onRaise: () => toast("Elevar/acoplar: em breve") };
      return {
        id: n.nodeId, type: n.kind,
        position: keepLocal ? old.position : { x: n.geometry.x, y: n.geometry.y },
        style: keepLocal && old.style ? old.style : { width: n.geometry.w, height: n.geometry.h },
        ...(old?.selected ? { selected: true } : {}),
        data: n.kind === "terminal" ? { title: n.title, sessionId: n.sessionId!, api, stream, onDelete: del, onRename: rename,
            ...(n.icon ? { icon: n.icon } : {}), ...(n.color ? { color: n.color } : {}), ...(n.termTheme ? { termTheme: n.termTheme } : {}), // #56 aparência do nó
            ...(n.groupId ? { groupId: n.groupId } : {}), // #78
            onAppearance: (p: { icon?: string | null; color?: string | null; termTheme?: TermTheme | null }) => patchRec(n, p, "aparência do terminal"), editSignal: renameSig.id === n.nodeId ? renameSig.n : 0, ...extras,
            composerOpen: composerFor === n.nodeId, onComposerClose: () => setComposerFor(null), workspaceId: snap.workspace.workspaceId,
            chatOpen: chatFor === n.nodeId, onChatClose: () => setChatFor(null),
            ...(n.roleId && roles.find((r) => r.roleId === n.roleId) ? { role: roles.find((r) => r.roleId === n.roleId)! } : {}), roles,
            onSetRole: (roleId: string | null) => patchRec(n, { roleId }, "trocar papel"), onManageRoles: () => setRolesDialog(true),
            skills, ...(n.skillIds ? { skillIds: n.skillIds } : {}), onSetSkills: (skillIds: string[]) => patchRec(n, { skillIds }, "habilidades do terminal"), onManageSkills: () => { setPref("agentsSub", "skills"); setPref("prefsTab", "agents"); setPrefsOpen(true); }, // #57
            onResume: () => void api.restart(n.nodeId).catch(() => {}),
            onFocus: () => { focusedTerm.current = n.nodeId; if (composerRef.current && composerRef.current !== n.nodeId) setComposerFor(n.nodeId); },
            targets: snap.nodes.filter((o) => o.nodeId !== n.nodeId && o.kind !== "text").map((o) => ({ id: o.nodeId, kind: o.kind as "terminal" | "note", title: o.title, connected: (snap.connections ?? []).some((c) => (c.sourceNodeId === n.nodeId && c.targetNodeId === o.nodeId) || (c.targetNodeId === n.nodeId && c.sourceNodeId === o.nodeId)) })) }
          : n.kind === "note" ? { title: n.title, content: n.content ?? "", editSignal: renameSig.id === n.nodeId ? renameSig.n : 0, locked: !!n.locked, ...(n.groupId ? { groupId: n.groupId } : {}), ...(n.color ? { color: n.color } : {}), ...(n.filePath ? { filePath: n.filePath } : {}), onChange: change, onDelete: del, onRename: rename, ...extras,
              onLock: (locked: boolean) => patchRec(n, { locked }, locked ? "bloquear nota" : "desbloquear nota"),
              onColor: (color: string | null) => patchRec(n, { color }, "cor da nota"),
              onMove: () => void window.messai.pickDirectory?.().then((d) => { if (d) void mutate((r) => api.patchNode(n.nodeId, { expectedRevision: r, filePath: `${d}/${n.title.replace(/[\\/:*?"<>|]+/g, " ").trim() || "nota"}.md` })); }) }
          : n.kind === "tree" ? { title: n.title, content: n.content ?? "", editSignal: renameSig.id === n.nodeId ? renameSig.n : 0, workspaceId: snap.workspace.workspaceId, api, ...(n.groupId ? { groupId: n.groupId } : {}), onChange: change, onDelete: del, onRename: rename, ...extras,
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
        onStyle: (st) => { void mutate((r) => api.patchConnection(c.connectionId, { expectedRevision: r, style: st })); rec({ label: "estilo do cabo", forward: [{ type: "patchConnection", id: c.connectionId, patch: { style: st } }], inverse: [{ type: "patchConnection", id: c.connectionId, patch: { style: c.style ?? "rope" } }] }); },
        onCut: () => { void mutate((r) => api.deleteConnection(c.connectionId, r)); rec({ label: "cortar cabo", forward: [{ type: "deleteConnection", id: c.connectionId }], inverse: [{ type: "createConnection", ref: c.connectionId, spec: connSpec(c) }] }); },
        onGo: (end) => selectNode(end === "source" ? c.sourceNodeId : c.targetNodeId),
      };
      return { id: c.connectionId, type: style, source: c.sourceNodeId, target: c.targetNodeId, deletable: true, data, ...(wasSelected ? { selected: true } : {}) };
    }));
  }, [snap, composerFor, chatFor, roles, skills, renameSig]);

  /** Seleciona um nó e o traz para a vista. */
  const selectNode = (id: string) => {
    const next = flowRef.current.map((n) => ({ ...n, selected: n.id === id }));
    flowRef.current = next; setFlow(next);
    void rf.fitView({ nodes: [{ id }], padding: 0.5, duration: 200, maxZoom: 1.2 });
  };
  // "Ir ao terminal" vindo do HUD: troca de espaço (se preciso) e seleciona o nó quando ele existir no canvas.
  /** Vai a um nó (deste ou de outro espaço): seleciona direto ou troca de espaço e seleciona quando ele aparecer. Usado pelo HUD e pela paleta. */
  const focusNode = (workspaceId: string, nodeId: string) => {
    setOverview(null);
    if (flowRef.current.some((n) => n.id === nodeId)) { selectNode(nodeId); return; }
    pendingFocus.current = nodeId; setCurrent(workspaceId);
  };
  useEffect(() => window.messai.onFocusNode?.((t) => focusNode(t.workspaceId, t.nodeId)), []); // eslint-disable-line react-hooks/exhaustive-deps
  // #69 paleta: o que cada item faz
  const paletteActions: PaletteAction[] = [
    { id: "terminal.new", label: "Novo terminal", detail: "Ctrl+T", keywords: "criar shell agente" },
    { id: "note.new", label: "Nova nota", detail: "Ctrl+Shift+D", keywords: "criar markdown" },
    { id: "ws.new", label: "Novo espaço", detail: "Ctrl+Shift+N", keywords: "workspace projeto" },
    { id: "prefs", label: "Preferências", detail: "Ctrl+,", keywords: "configurações tema atalhos" },
    { id: "theme", label: "Alternar tema", keywords: "claro escuro sistema" },
    { id: "minimap", label: "Alternar minimapa", detail: "Ctrl+Shift+M" },
    { id: "hud", label: "Janela flutuante do companheiro", keywords: "hud resumo" },
    { id: "attention.next", label: "Ir ao próximo terminal esperando você", detail: "Ctrl+Shift+A", keywords: "atenção" },
  ];
  const onPalettePick = (it: PaletteItem) => {
    if (it.kind === "workspace" || it.kind === "floor") { if (it.workspaceId) { setOverview(null); setCurrent(it.workspaceId); } return; }
    if (it.kind === "node" || it.kind === "attention" || it.kind === "content") {
      if (it.workspaceId && it.nodeId) { focusNode(it.workspaceId, it.nodeId); if (it.kind === "attention") void api.seen(it.nodeId).catch(() => {}); if (it.kind === "content" && it.label.startsWith("chat ·")) setTimeout(() => openChat(it.nodeId!), 450); }
      return;
    }
    switch (it.action) {
      case "terminal.new": if (current) { const c = viewCenter(); setDialog({ rect: { x: c.x - 320, y: c.y - 190, ...SIZE.terminal } }); } return;
      case "note.new": if (current) { const c = viewCenter(); createSimple("note", { x: c.x - 130, y: c.y - 80, ...SIZE.note }); } return;
      case "ws.new": setWsDialog({}); return;
      case "prefs": setPrefsOpen(true); return;
      case "theme": setThemePref(nextTheme(getThemePref())); return;
      case "minimap": setMinimap((v) => !v); return;
      case "hud": void window.messai.hudToggle?.().then(setHud); return;
      case "attention.next": { const att = flowRef.current.filter((n) => store.get(attentionAtom(n.id))); if (!att.length) { toast("Nenhum terminal precisa de atenção neste espaço"); return; } const i = att.findIndex((n) => n.selected); selectNode(att[(i + 1) % att.length]!.id); return; }
    }
  };
  useEffect(() => {
    const id = pendingFocus.current;
    if (!id || !flow.some((n) => n.id === id)) return;
    pendingFocus.current = null;
    // Depois do enquadramento inicial do espaço. Sem cancelar no cleanup: o React Flow dispara mudanças de
    // dimensão (e portanto `flow`) logo após montar os nós, o que cancelaria a seleção antes de acontecer.
    setTimeout(() => selectNode(id), 350);
  }, [flow]); // eslint-disable-line react-hooks/exhaustive-deps
  const startLink = (id: string) => { setLinking(id); toast("Conectar: clique no nó de destino (Esc cancela)"); };
  const finishLink = (targetId: string) => {
    const src = linkingRef.current; setLinking(null); if (!src || !current || src === targetId) return;
    if (edgesRef.current.some((e) => (e.source === src && e.target === targetId) || (e.source === targetId && e.target === src))) { toast("Já estão conectados"); return; }
    void mutate(async (r) => { const c = await api.createConnectionRev(current, r, src, targetId); rec({ label: "conectar", forward: [{ type: "createConnection", ref: c.connectionId, spec: connSpec(c) }], inverse: [{ type: "deleteConnection", id: c.connectionId }] }); });
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
    // #78 (1) selecionar um nó de grupo seleciona o grupo inteiro (assim o React Flow arrasta todos juntos);
    //     (2) com Alt pressionado, a posição arrastada encaixa em vizinhos/grade (snapGeometry) e as guias aparecem.
    let eff: NodeChange[] = changes;
    const sels = changes.filter((c): c is Extract<NodeChange, { type: "select" }> => c.type === "select" && c.selected);
    if (sels.length) {
      const extra: NodeChange[] = []; const have = new Set(changes.filter((c) => c.type === "select").map((c) => (c as { id: string }).id));
      for (const c of sels) { const gid = snapRef.current?.nodes.find((n) => n.nodeId === c.id)?.groupId; if (!gid) continue; for (const m of membersOf(gid)) if (!have.has(m)) { have.add(m); extra.push({ type: "select", id: m, selected: true }); } }
      if (extra.length) eff = [...changes, ...extra];
    }
    // Vale para as mudanças durante o arrasto E para a final (dragging=false, que o React Flow emite a partir da posição do
    // ponteiro): o onNodeDragStop lê a posição encaixada de snappedRef, porque o nodeLookup interno ainda não re-renderizou.
    const moving = eff.filter((c): c is Extract<NodeChange, { type: "position" }> => c.type === "position" && !!c.position);
    if (moving.length && (altRef.current || magnetRef.current) && snapRef.current) {
      const lead = moving[0]!; const ids = new Set(moving.map((c) => c.id));
      const sn = snapRef.current.nodes.find((n) => n.nodeId === lead.id);
      if (sn) {
        const others = snapRef.current.nodes.filter((n) => !ids.has(n.nodeId)).map((n) => n.geometry);
        const zoom = rf.getZoom(); const res = snapGeometry({ x: lead.position!.x, y: lead.position!.y, w: sn.geometry.w, h: sn.geometry.h }, others, { threshold: 8 / Math.max(zoom, 0.2), grid: 48 });
        const dx = res.x - lead.position!.x, dy = res.y - lead.position!.y;
        eff = eff.map((c) => { if (c.type !== "position" || !c.position || !ids.has(c.id)) return c; const pos = { x: c.position.x + dx, y: c.position.y + dy }; snappedRef.current.set(c.id, pos); return { ...c, position: pos }; });
        setGuides(lead.dragging ? res.guides : { vertical: [], horizontal: [] });
      }
    } else if (moving.length) { for (const c of moving) snappedRef.current.set(c.id, c.position!); if (moving.some((c) => c.dragging === false)) setGuides({ vertical: [], horizontal: [] }); }
    let next: FlowNode[] = [];
    setFlow((cur) => { next = applyNodeChanges(eff, cur); flowRef.current = next; return next; });
    let missingOnEnd = false; // resize terminou com o nó já fora do snap/flow (ex.: deletado no meio)
    // Posição NÃO é tratada aqui: no arrasto rápido o React Flow coalesce as mudanças de posição e a
    // última pode vir atrasada/na origem. Usamos onNodeDragStop (posição final autoritativa). Aqui só o resize.
    for (const c of changes) {
      if (c.type !== "dimensions") continue;
      const n = snap?.nodes.find((x) => x.nodeId === c.id); const f = next.find((x) => x.id === c.id);
      {
        if (c.resizing) { dragging.current = true; } // mantém o tamanho local durante o arrasto; não deixa o snapshot reverter
        else {
          dragging.current = false; // sempre destrava no fim do resize, mesmo se o nó sumiu
          if (n && f) {
            // Dimensões reais: a própria mudança traz {width,height}; depois caímos para width/measured/style/antigo.
            const dim = (c as { dimensions?: { width?: number; height?: number } }).dimensions;
            const fw = f as FlowNode & { width?: number; height?: number; style?: { width?: number; height?: number } };
            const w = Math.round(Number(dim?.width ?? fw.width ?? f.measured?.width ?? fw.style?.width ?? n.geometry.w));
            const h = Math.round(Number(dim?.height ?? fw.height ?? f.measured?.height ?? fw.style?.height ?? n.geometry.h));
            // Redimensionar pela borda de cima/esquerda também move o x/y (a âncora sobe/vai pra esquerda).
            // Persistimos posição E tamanho juntos; senão o nó volta pro x/y antigo e "cresce pro lado errado".
            const x = Math.round(f.position.x), y = Math.round(f.position.y);
            if (w >= 40 && h >= 40 && (w !== n.geometry.w || h !== n.geometry.h || x !== n.geometry.x || y !== n.geometry.y)) { void mutate((r) => api.patchNode(c.id, { expectedRevision: r, geometry: { x, y, w, h } })); rec({ label: "redimensionar", key: `resize:${c.id}`, forward: [{ type: "patchNode", id: c.id, patch: { geometry: { x, y, w, h } } }], inverse: [{ type: "patchNode", id: c.id, patch: { geometry: n.geometry } }] }); }
          } else missingOnEnd = true;
        }
      }
    }
    // Destravou sem patch (nó sumiu): o efeito pode ter pulado snapshots durante o arrasto; resincroniza do snap atual.
    if (missingOnEnd) setSnap((s) => (s ? { ...s } : s));
  }, [snap, api]);

  // Arrasto de nó: estado e posição final vêm dos callbacks dedicados do React Flow (robusto no arrasto rápido).
  const onNodeDragStart = useCallback(() => { dragging.current = true; }, []);
  const onNodeDragStop = useCallback((_: unknown, node: FlowNode, nodes: FlowNode[]) => {
    dragging.current = false;
    const moved = nodes.length ? nodes : [node]; // multi-seleção: todos os arrastados
    setGuides({ vertical: [], horizontal: [] });
    // #78: membros do grupo do nó arrastado que (por qualquer motivo) não vieram na seleção acompanham o mesmo delta.
    // #78 posição final: a última aplicada pelo onNodesChange e, com o ímã ligado, o encaixe recalculado AQUI (o último pointermove
    // pode ser coalescido pelo navegador e nunca virar mudança de posição; recalcular na soltura garante a borda exata).
    const rawPos = (nd: FlowNode) => snappedRef.current.get(nd.id) ?? nd.position;
    let fix = { dx: 0, dy: 0 };
    if ((altRef.current || magnetRef.current) && snap) {
      const sn0 = snap.nodes.find((x) => x.nodeId === node.id); const ids = new Set(moved.map((m) => m.id));
      if (sn0) { const p0 = rawPos(node); const res = snapGeometry({ x: p0.x, y: p0.y, w: sn0.geometry.w, h: sn0.geometry.h }, snap.nodes.filter((n) => !ids.has(n.nodeId)).map((n) => n.geometry), { threshold: 8 / Math.max(rf.getZoom(), 0.2), grid: 48 }); fix = { dx: res.x - p0.x, dy: res.y - p0.y }; }
      if (fix.dx || fix.dy) setFlow((cur) => { const n2 = cur.map((n) => (ids.has(n.id) ? { ...n, position: { x: n.position.x + fix.dx, y: n.position.y + fix.dy } } : n)); flowRef.current = n2; return n2; });
    }
    const posOf = (nd: FlowNode) => { const p = rawPos(nd); return { x: p.x + fix.dx, y: p.y + fix.dy }; };
    const lead = snap?.nodes.find((x) => x.nodeId === node.id);
    if (lead?.groupId) { const dx = Math.round(posOf(node).x) - lead.geometry.x, dy = Math.round(posOf(node).y) - lead.geometry.y; const inMove = new Set(moved.map((m) => m.id)); for (const m of membersOf(lead.groupId)) { if (inMove.has(m)) continue; const f = flowRef.current.find((x) => x.id === m); if (f) moved.push({ ...f, position: { x: f.position.x + dx, y: f.position.y + dy } }); } }
    void (async () => {
      let missing = false; const before: { nodeId: string; geometry: Geometry }[] = []; const after: { nodeId: string; geometry: Geometry }[] = [];
      for (const nd of moved) {
        const sn = snap?.nodes.find((x) => x.nodeId === nd.id);
        if (sn) {
          const g = { ...sn.geometry, x: Math.round(posOf(nd).x), y: Math.round(posOf(nd).y) };
          if (g.x !== sn.geometry.x || g.y !== sn.geometry.y) { before.push({ nodeId: nd.id, geometry: sn.geometry }); after.push({ nodeId: nd.id, geometry: g }); }
          await mutate((r) => api.patchNode(nd.id, { expectedRevision: r, geometry: g })); // sequencial: sem colisão de revisão
        } else missing = true;
      }
      snappedRef.current.clear();
      if (after.length) rec({ label: `mover ${plural(after.length, "nó", "nós")}`, forward: [{ type: "layout", moves: after }], inverse: [{ type: "layout", moves: before }] }); // #77: arrasto múltiplo = uma etapa
      if (missing) setSnap((s) => (s ? { ...s } : s));
    })();
  }, [snap, api]);
  const onConnect = useCallback((c: FlowConnection) => { if (current && c.source && c.target) void mutate(async (r) => { const made = await api.createConnectionRev(current, r, c.source, c.target); rec({ label: "conectar", forward: [{ type: "createConnection", ref: made.connectionId, spec: connSpec(made) }], inverse: [{ type: "deleteConnection", id: made.connectionId }] }); }); }, [current, api]); // eslint-disable-line react-hooks/exhaustive-deps
  const onEdgesChange = useCallback((changes: EdgeChange[]) => setEdges((es) => applyEdgeChanges(changes, es)), []);
  const onEdgesDelete = useCallback((del: Edge[]) => { for (const e of del) { const c = snap?.connections.find((x) => x.connectionId === e.id); void mutate((r) => api.deleteConnection(e.id, r)); if (c) rec({ label: "cortar cabo", forward: [{ type: "deleteConnection", id: e.id }], inverse: [{ type: "createConnection", ref: e.id, spec: connSpec(c) }] }); } }, [api, snap]); // eslint-disable-line react-hooks/exhaustive-deps

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
    // #56 aparência: o que veio do diálogo vence; senão, a do preset. Preset "terminal + chat" abre o chat ao criar.
    const icon = i.icon ?? preset?.icon ?? ""; const color = i.color ?? preset?.color ?? ""; const termTheme = i.termTheme ?? preset?.theme ?? "system";
    const look = { ...(icon ? { icon } : {}), ...(color ? { color } : {}), ...(termTheme !== "system" ? { termTheme } : {}) };
    const target = i.target ?? preset?.target ?? "terminal";
    void mutate(async (r) => { const input = { expectedRevision: r, kind: "terminal", geometry, title: i.title, ...look, ...(usePreset ? { command: preset.command, args: preset.args } : cmdParts ? { command: cmdParts[0]!, args: cmdParts.slice(1) } : {}), ...(i.cwd ? { cwd: i.cwd } : {}), ...(i.roleId ? { roleId: i.roleId } : {}), ...(i.persistent ? { persistent: true } : {}) }; const made = await api.createNode(current, input); const { expectedRevision: _er, ...sp } = input; rec({ label: "criar terminal", forward: [{ type: "createNode", ref: made.node.nodeId, spec: sp as NodeSpec }], inverse: [{ type: "deleteNode", id: made.node.nodeId }] }); ensureVisible(geometry); if (target === "chat") setTimeout(() => openChat(made.node.nodeId), 300); });
    setTool("select");
  };
  const createSimple = (kind: "note" | "text" | "tree", geometry: Geometry) => {
    if (!current) return;
    void mutate(async (r) => { const made = await api.createNode(current, { expectedRevision: r, kind, geometry, content: "" }); rec({ label: kind === "note" ? "criar nota" : kind === "text" ? "criar texto" : "criar árvore", forward: [{ type: "createNode", ref: made.node.nodeId, spec: { kind, title: made.node.title, geometry, content: "" } }], inverse: [{ type: "deleteNode", id: made.node.nodeId }] }); ensureVisible(geometry); });
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
    await deleteNodes(sel.map((n) => n.id)); // sequencial + uma etapa de undo
    const drw = [...selDrawingsRef.current];
    if (drw.length > 1) hist().beginGroup(`apagar ${plural(drw.length, "desenho", "desenhos")}`);
    for (const id of drw) { const d = snapRef.current?.drawings.find((x) => x.drawingId === id); await mutate((r) => api.deleteDrawing(id, r)); if (d) hist().record({ label: "apagar desenho", forward: [{ type: "deleteDrawing", id }], inverse: [{ type: "createDrawing", ref: id, spec: drawSpec(d) }] }); }
    if (drw.length > 1) hist().endGroup(); if (drw.length) { setSelDrawings(new Set()); bump(); }
  };
  const groupMembers = (id: string): string[] => { const all = snap?.drawings ?? []; const d = all.find((x) => x.drawingId === id); return d?.groupId ? all.filter((x) => x.groupId === d.groupId).map((x) => x.drawingId) : [id]; };
  const selectDrawing = (id: string, additive: boolean) => setSelDrawings((prev) => {
    const grp = groupMembers(id); // selecionar um membro do grupo seleciona o grupo inteiro
    if (!additive) return new Set(grp);
    const next = new Set(prev); const allIn = grp.every((g) => next.has(g)); grp.forEach((g) => (allIn ? next.delete(g) : next.add(g))); return next;
  });
  const moveDrawing = (id: string, points: [number, number][]) => { const d = snap?.drawings.find((x) => x.drawingId === id); void mutate((r) => api.patchDrawing(id, { expectedRevision: r, points })); if (d) rec({ label: "mover desenho", key: `drawing:${id}`, forward: [{ type: "patchDrawing", id, points }], inverse: [{ type: "patchDrawing", id, points: d.points }] }); };
  const duplicateSelected = async () => {
    const sel = flowRef.current.filter((n) => n.selected); if (!sel.length || !current) return;
    for (const n of sel) {
      try { const r = await api.duplicateNode(n.id, revision.current); revision.current = r.revision; const sp = await specOf(r.node); rec({ label: "duplicar", forward: [{ type: "createNode", ref: r.node.nodeId, spec: sp }], inverse: [{ type: "deleteNode", id: r.node.nodeId }] }); }
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
    const before = moves.map((m) => ({ nodeId: m.id, geometry: items.find((i) => i.id === m.id)!.geometry }));
    rec({ label: `organizar ${plural(moves.length, "nó", "nós")}`, forward: [{ type: "layout", moves: moves.map((m) => ({ nodeId: m.id, geometry: m.geometry })) }], inverse: [{ type: "layout", moves: before }] });
  };
  const arrangeGrid = () => layoutSelected((items) => gridLayout(items, 40), true);
  const alignSelected = (mode: AlignMode) => layoutSelected((items) => alignGeometries(items, mode), false);

  // Atalhos (iguais ao Maestri onde já existe a função)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      // #58: cada ação casa pelo keymap (padrão do catálogo ou override do usuário); ações sem `whileTyping` são ignoradas com foco em input/terminal.
      const combo = comboFromEvent(e); const typing = isTyping();
      const is = (id: string) => { const a = ACTION_BY_ID.get(id)!; return !(typing && !a.whileTyping) && sameCombo(effectiveCombo(id, keymapRef.current), combo); };
      if (is("palette.open")) { e.preventDefault(); setPaletteOpen((v) => !v); return; } // #69 paleta global
      if (is("prefs.toggle")) { e.preventDefault(); setPrefsOpen((v) => !v); return; } // #64 Preferências
      if (is("ws.new")) { e.preventDefault(); setWsDialog({}); return; }
      if (is("sidebar.toggle")) { e.preventDefault(); setSideMini((v) => !v); return; } // dentro do terminal Ctrl+B é o prefixo do tmux
      if (is("floors.overview")) { e.preventDefault(); if (overview) setOverview(null); else { const g = groundOf(current); if (g) setOverview(g.workspaceId); else toast("Selecione um espaço"); } return; }
      if (is("composer.toggle")) {
        e.preventDefault(); if (composerRef.current) { setComposerFor(null); return; }
        const sel = pickTerminal(); if (sel) setComposerFor(sel); else toast("Nenhum terminal para compor"); return;
      }
      if (is("chat.toggle")) {
        e.preventDefault(); if (chatRef.current) { setChatFor(null); return; }
        const sel = pickTerminal(); if (sel) openChat(sel); else toast("Nenhum terminal para o chat"); return;
      }
      if (is("link.start")) { /* no terminal Ctrl+L limpa a tela */ e.preventDefault(); const sel = flowRef.current.filter((n) => n.selected); if (sel.length === 1) startLink(sel[0]!.id); else toast("Selecione um nó para conectar"); return; }
      if (is("node.next") || is("node.prev")) { e.preventDefault(); const ns = flowRef.current; if (!ns.length) return; const i = ns.findIndex((n) => n.selected); const j = (i + (is("node.prev") ? -1 : 1) + ns.length) % ns.length; selectNode(ns[j]!.id); return; }
      if (is("wire.next") || is("wire.prev")) {
        e.preventDefault(); const sel = flowRef.current.find((n) => n.selected); if (!sel) return;
        const nb = neighbors(sel.id); if (!nb.length) { toast("Este nó não tem conexões"); return; }
        wireIdx.current = (wireIdx.current + (is("wire.next") ? 1 : -1) + nb.length) % nb.length; selectNode(nb[wireIdx.current]!); return;
      }
      if (is("attention.select")) {
        e.preventDefault(); const att = flowRef.current.filter((n) => store.get(attentionAtom(n.id)));
        if (!att.length) { toast("Nenhum terminal precisa de atenção"); return; }
        const i = att.findIndex((n) => n.selected); selectNode(att[(i + 1) % att.length]!.id); return;
      }
      if (is("attention.list")) { e.preventDefault(); const att = flowRef.current.filter((n) => store.get(attentionAtom(n.id))); toast(att.length ? `Esperando: ${att.map((n) => String((n.data as { title?: string }).title ?? "texto")).join(", ")}` : "Nenhum terminal precisa de atenção"); return; }
      if (is("ws.prev") || is("ws.next") || (ctrl && !e.shiftKey && !e.altKey && (e.key === "[" || e.key === "]") && !typing)) { // Ctrl+[ / Ctrl+] são apelidos fixos (no terminal Ctrl+[ é Esc)
        e.preventDefault(); const ws = sideRef.current.workspaces; if (ws.length < 2) return;
        const i = ws.findIndex((w) => w.workspaceId === current); const d = is("ws.prev") || e.key === "[" ? -1 : 1;
        setCurrent(ws[(i + d + ws.length) % ws.length]!.workspaceId); return;
      }
      if (is("terminal.new")) { e.preventDefault(); if (current) { const c = viewCenter(); setDialog({ rect: { x: c.x - 320, y: c.y - 190, ...SIZE.terminal } }); } return; }
      if (is("note.new")) { e.preventDefault(); if (current) { const c = viewCenter(); createSimple("note", { x: c.x - 130, y: c.y - 80, ...SIZE.note }); } return; }
      if (is("minimap.toggle")) { e.preventDefault(); setMinimap((v) => !v); return; }
      if (is("zoom.in")) { e.preventDefault(); void rf.zoomIn({ duration: 120 }); return; }
      if (is("zoom.out")) { e.preventDefault(); void rf.zoomOut({ duration: 120 }); return; }
      if (is("view.fit")) { e.preventDefault(); const sel = flowRef.current.filter((n) => n.selected); void rf.fitView(sel.length ? { nodes: sel, padding: 0.3, duration: 250 } : { padding: 0.15, duration: 250 }); return; }
      if (is("node.duplicate")) { e.preventDefault(); void duplicateSelected(); return; }
      if (is("arrange.grid")) { e.preventDefault(); arrangeGrid(); return; } // Ctrl+Shift+T não é entrada de terminal; vale mesmo com o xterm focado
      if (is("drawings.group") || is("drawings.ungroup")) { // agrupar / desagrupar: nós selecionados primeiro (#78), senão desenhos
        e.preventDefault();
        if (is("drawings.ungroup")) { const grouped = flowRef.current.find((n) => n.selected && snapRef.current?.nodes.find((x) => x.nodeId === n.id)?.groupId); if (grouped) { void ungroup(snapRef.current!.nodes.find((x) => x.nodeId === grouped.id)!.groupId!); return; } }
        else if (flowRef.current.filter((n) => n.selected).length >= 2) { void groupSelectedNodes(); return; }
        const ids = [...selDrawingsRef.current]; if (!current || !ids.length) { if (!is("drawings.ungroup")) toast("Selecione 2+ nós ou desenhos para agrupar"); return; }
        if (is("drawings.ungroup")) { void mutate((r) => api.groupDrawings(current, { expectedRevision: r, drawingIds: ids, grouped: false })); rec({ label: "desagrupar desenhos", forward: [{ type: "groupDrawings", ids, grouped: false }], inverse: [{ type: "groupDrawings", ids, grouped: true }] }); }
        else if (ids.length >= 2) { void mutate((r) => api.groupDrawings(current, { expectedRevision: r, drawingIds: ids, grouped: true })); rec({ label: "agrupar desenhos", forward: [{ type: "groupDrawings", ids, grouped: true }], inverse: [{ type: "groupDrawings", ids, grouped: false }] }); }
        else toast("Selecione 2+ desenhos para agrupar");
        return;
      }
      if (is("snap.toggle")) { e.preventDefault(); setPref("snapMagnetic", !magnetRef.current); toast(magnetRef.current ? "Encaixe magnético desligado" : "Encaixe magnético ligado (bordas/centros dos vizinhos e grade)"); return; } // #78
      if (is("history.undo")) { e.preventDefault(); void undo(); return; } // #77
      if (is("history.redo") || (ctrl && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "y" && !typing)) { e.preventDefault(); void redo(); return; }
      if (is("delete")) { e.preventDefault(); deleteSelected(); return; }
      if ((e.key === "Delete" || e.key === "Backspace") && !isTyping() && (flowRef.current.some((n) => n.selected) || selDrawingsRef.current.size > 0)) { e.preventDefault(); void deleteSelected(); return; }
      if (e.key === "Escape" && linkingRef.current) { setLinking(null); return; }
      if (e.key === "Escape" && overview) { setOverview(null); return; }
      if (typing) return;
      const tools: [string, Tool][] = [["tool.select", "select"], ["tool.terminal", "terminal"], ["tool.note", "note"], ["tool.text", "text"], ["tool.tree", "tree"], ["tool.draw", "draw"], ["tool.pan", "pan"]];
      for (const [id, tool] of tools) if (is(id)) { e.preventDefault(); setTool(tool); if (tool === "draw") setStyle((s) => ({ ...s, kind: s.kind === "erase" ? "pen" : s.kind })); return; }
      if (is("draw.thinner")) setStyle((s) => ({ ...s, width: Math.max(1, s.width - 1) }));
      if (is("draw.thicker")) setStyle((s) => ({ ...s, width: Math.min(24, s.width + 1) }));
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
    settings: () => setPrefsOpen(true),
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
        <div className="info-bar">{snap?.workspace.parentId && <span className="floor-badge" style={{ borderColor: STATUS_COLOR[snap.workspace.status ?? "working"] }} title={STATUS_LABEL[snap.workspace.status ?? "working"]}>andar · {snap.workspace.branch}</span>}{snap ? `${snap.workspace.name} · rev ${snap.workspace.revision} · ${snap.nodes.length} nós` : "sem espaço"}{linking ? " — conectar: clique no destino (Esc cancela)" : ""}</div>
        <div className="toasts">{toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} onClick={() => setToasts((ts) => ts.filter((x) => x.id !== t.id))}>{t.text}</div>
        ))}</div>
        <button className="pri add-btn" data-testid="add" disabled={!current} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); const p = e.currentTarget.closest("main")!.getBoundingClientRect(); setMenu({ x: r.left - p.left, y: r.bottom - p.top + 4 }); }}>+ Adicionar</button>
        {stale && <div className="banner">O runtime em execução é de uma versão anterior ao app. Reinicie o runtime para usar os recursos novos (isso encerra os shells dele; eles ficam como "lost" e podem ser reiniciados).</div>}
        {!current && <div className="empty">Crie um espaço com o botão + da barra lateral ou Ctrl+Shift+N.</div>}
        {wsDialog && <WorkspaceDialog {...(wsDialog.edit ? { edit: wsDialog.edit } : {})} {...(wsDialog.folderId ? { defaultFolderId: wsDialog.folderId } : {})} defaultCwd={homeDir} folders={side.folders} onSubmit={(i) => void submitWs(i)} onClose={() => setWsDialog(null)} />}
        {menu && <AddMenu presets={presets.filter((p) => p.enabled)}x={menu.x} y={menu.y} onClose={() => setMenu(null)} onPick={(c) => add(c, menu.at)} />}
        {dialog && <NewTerminalDialog presets={presets.filter((p) => p.enabled)}roles={roles} defaultCwd={snap?.workspace.cwd || homeDir} onClose={() => { setDialog(null); setTool("select"); }} onCreate={(i) => createTerminal(dialog.rect, i)} onManageRoles={() => setRolesDialog(true)} tmux={features.includes("terminal.tmux")} />}
        {preview && snap && <FilePreview api={api} workspaceId={snap.workspace.workspaceId} path={preview} onClose={() => setPreview(null)} onOpenNote={(rel) => { setPreview(null); void mutate((r) => api.createNode(snap.workspace.workspaceId, { expectedRevision: r, kind: "note", geometry: { ...freeSpot(snap.nodes, { w: 360, h: 260 }), w: 360, h: 260 }, filePath: `${snap.workspace.cwd}/${rel}` })); }} />}
        {floorDialog && <FloorDialog ground={floorDialog} onSubmit={(i) => void submitFloor(floorDialog, i)} onClose={() => setFloorDialog(null)} />}
        {overview && groundOf(overview) && <FloorOverview ground={groundOf(overview)!} floors={side.workspaces.filter((w) => w.parentId === overview)} current={current} terminals={side.terminals} api={api}
          onOpen={(id) => { setCurrent(id); setOverview(null); }} onNew={() => { setFloorDialog(groundOf(overview)!); }} onClose={() => setOverview(null)} onChanged={() => void refreshList()} onError={toast} />}
        {paletteOpen && <Palette api={api} workspaces={side.workspaces} currentId={current} currentNodes={(snap?.nodes ?? []).map((n) => ({ nodeId: n.nodeId, kind: n.kind, title: n.title }))} actions={paletteActions} onClose={() => setPaletteOpen(false)} onPick={onPalettePick} />}
        {prefsOpen && <Preferences api={api} onClose={() => setPrefsOpen(false)} onPresetsChanged={() => void api.presets().then(setPresets).catch(() => {})}
          workspaceCwd={snap?.workspace.cwd ?? ""} onRolesChanged={() => { void loadRoles(); void loadSkills(); }} onOpenUsage={() => { setPrefsOpen(false); setUsage(true); }}
          onOpenTerminal={(t) => { if (!current) { toast("Abra um espaço para criar o terminal de login"); return; } setPrefsOpen(false); createTerminal(freeSpot(snap?.nodes ?? [], SIZE.terminal), { title: t.title, command: t.command }); }} />}
        {rolesDialog && <RolesDialog api={api} workspaceCwd={snap?.workspace.cwd ?? ""} onClose={() => setRolesDialog(false)} onChanged={() => void loadRoles()} />}
        <ReactFlow nodes={flow} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={onNodesChange} onNodeDragStart={onNodeDragStart} onNodeDragStop={onNodeDragStop} onEdgesChange={onEdgesChange} onConnect={onConnect} onEdgesDelete={onEdgesDelete}
          onNodeClick={(_, n) => { if (linkingRef.current) finishLink(n.id); }} onPaneClick={() => { if (linkingRef.current) setLinking(null); if (selDrawingsRef.current.size) setSelDrawings(new Set()); }}
          nodesDraggable={selectMode} nodesConnectable={selectMode} elementsSelectable={selectMode} panOnDrag={tool === "pan" ? [0, 1, 2] : selectMode ? [1, 2] : false} selectionOnDrag={selectMode} panOnScroll zoomOnScroll={false} zoomActivationKeyCode="Alt" panActivationKeyCode="Control" multiSelectionKeyCode={null}
          nodesFocusable={false} fitView minZoom={0.1} maxZoom={3} proOptions={{ hideAttribution: true }} colorMode="dark" deleteKeyCode="Delete"
          onNodesDelete={() => {}} onBeforeDelete={async ({ nodes: ns, edges: es }) => ({ nodes: [], edges: ns.length ? [] : es })}>
          <Background variant={BackgroundVariant.Lines} gap={48} size={1} color={cssVar("--grid") || "#2c2c30"} />
          {minimap && <MiniMap pannable zoomable />}
          <GroupLayer groups={snap?.groups ?? []} flow={flow} guides={guides} onSelect={(gid) => selectNodes(membersOf(gid))} onRename={(gid, label) => patchGroup(gid, { label })} onColor={(gid, color) => patchGroup(gid, { color })} onUngroup={(gid) => void ungroup(gid)} />
          <DrawingLayer tool={tool} style={style} drawings={drawings}
            selected={selDrawings} onSelect={selectDrawing} onMovePoints={moveDrawing}
            onDraw={(d) => current && void mutate(async (r) => { const made = await api.createDrawing(current, { expectedRevision: r, ...d }); rec({ label: "desenhar", forward: [{ type: "createDrawing", ref: made.drawingId, spec: drawSpec(made) }], inverse: [{ type: "deleteDrawing", id: made.drawingId }] }); })}
            onErase={(id) => { const dd = snap?.drawings.find((x) => x.drawingId === id); void mutate((r) => api.deleteDrawing(id, r)); if (dd) rec({ label: "apagar desenho", forward: [{ type: "deleteDrawing", id }], inverse: [{ type: "createDrawing", ref: id, spec: drawSpec(dd) }] }); }}
            onCreateRect={onCreateRect} />
        </ReactFlow>
        <ZoomBar minimap={minimap} setMinimap={setMinimap} onUsage={() => setUsage(true)} agents={barAgents} {...(curWs ? { wsName: curWs.name } : {})} inFloors={!!overview} onFloors={() => (overview ? setOverview(null) : grd && setOverview(grd.workspaceId))} hud={hud} onHud={() => void window.messai.hudToggle?.().then(setHud)} history={{ canUndo: hist().canUndo, canRedo: hist().canRedo, undoLabel: hist().undoLabel, redoLabel: hist().redoLabel, onUndo: () => void undo(), onRedo: () => void redo() }} />
        {usage && <AgentUsage api={api} onClose={() => setUsage(false)} />}
      </main>
    </div>
  );
}

export function App({ conn }: { conn: Connection }) { return <ReactFlowProvider><Canvas conn={conn} /><ShutdownOverlay /></ReactFlowProvider>; }
