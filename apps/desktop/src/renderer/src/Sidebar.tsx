import { useMemo, useState, type DragEvent } from "react";
import { ChevronDown, ChevronRight, Plus, Settings, FolderPlus, Folder as FolderIcon, FolderOpen, Minus, GitBranch, Layers, Terminal } from "lucide-react";
import type { Folder, Sidebar as SidebarData, Workspace } from "@messai/contracts";
import { WsIcon } from "./wsicons.js";

export type SidebarActions = {
  select: (id: string) => void;
  settings: () => void;
  newWorkspace: (folderId?: string) => void;
  editWorkspace: (w: Workspace) => void;
  deleteWorkspace: (w: Workspace) => void;
  moveWorkspace: (w: Workspace, folderId: string | null) => void;
  newFolder: (kind: "folder" | "group", parentId?: string) => void;
  renameFolder: (f: Folder) => void;
  deleteFolder: (f: Folder) => void;
  toggleFolder: (f: Folder) => void;
  moveFolder: (f: Folder, parentId: string | null) => void;
  newFloor: (ground: Workspace) => void;
  overview: (ground: Workspace) => void;
};
const STATUS_COLOR: Record<string, string> = { working: "#5aa9ff", blocked: "#ff6b6b", review: "#f6c344", done: "#4cd964" };
type Ctx = { x: number; y: number; ws?: Workspace; folder?: Folder };

/** Barra lateral: filtro, botão +, WORKSPACES com pastas/subpastas recolhíveis, grupos (divisores) e rodapé. */
export function Sidebar({ data, current, collapsed, machine, act }: { data: SidebarData; current: string | null; collapsed: boolean; machine: string; act: SidebarActions }) {
  const [filter, setFilter] = useState("");
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const q = filter.trim().toLowerCase();
  const byFolder = useMemo(() => {
    const m = new Map<string | null, Workspace[]>();
    for (const w of data.workspaces) { if (w.parentId) continue; if (q && !w.name.toLowerCase().includes(q) && !w.cwd.toLowerCase().includes(q)) continue; const k = w.folderId ?? null; m.set(k, [...(m.get(k) ?? []), w]); }
    return m;
  }, [data.workspaces, q]);
  const children = (parent: string | null) => data.folders.filter((f) => (f.parentId ?? null) === parent);
  const hasMatch = (f: Folder): boolean => (byFolder.get(f.folderId)?.length ?? 0) > 0 || children(f.folderId).some(hasMatch);

  const onDragStart = (e: DragEvent, kind: "ws" | "folder", id: string) => { e.dataTransfer.setData("text/mess", `${kind}:${id}`); e.dataTransfer.effectAllowed = "move"; };
  const onDrop = (e: DragEvent, target: string | null) => {
    e.preventDefault(); e.stopPropagation(); setOver(null);
    const [kind, id] = e.dataTransfer.getData("text/mess").split(":");
    if (kind === "ws") { const w = data.workspaces.find((x) => x.workspaceId === id); if (w && (w.folderId ?? null) !== target) act.moveWorkspace(w, target); }
    if (kind === "folder") { const f = data.folders.find((x) => x.folderId === id); if (f && f.folderId !== target && (f.parentId ?? null) !== target) act.moveFolder(f, target); }
  };
  const allow = (e: DragEvent, id: string | null) => { if (e.dataTransfer.types.includes("text/mess")) { e.preventDefault(); setOver(id); } };

  const wsRow = (w: Workspace, depth: number): React.ReactNode => {
    const n = data.terminals[w.workspaceId] ?? 0;
    const floors = data.workspaces.filter((f) => f.parentId === w.workspaceId && (!q || f.name.toLowerCase().includes(q) || (f.branch ?? "").includes(q)));
    const hasFloors = floors.length > 0;
    return [
      <li key={w.workspaceId} className={`ws ${w.workspaceId === current && !hasFloors ? "on" : ""} ${hasFloors ? "parent" : ""}`} style={{ paddingLeft: 8 + depth * 14 }} draggable onDragStart={(e) => onDragStart(e, "ws", w.workspaceId)}
        onClick={() => act.select(w.workspaceId)} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setCtx({ x: e.clientX, y: e.clientY, ws: w }); }} title={w.cwd}>
        <WsIcon icon={w.icon} color={w.color} size={13} />
        {!collapsed && <><span className="nm">{w.name}</span>{hasFloors && <span className="cnt floors" title={`${floors.length} andar(es) — Ctrl+Shift+\\ abre a visão geral`} onClick={(e) => { e.stopPropagation(); act.overview(w); }}><Layers size={11} /></span>}{n > 0 && <span className="cnt" title={`${n} terminais`}><Terminal size={11} /> {n}</span>}</>}
      </li>,
      ...floors.map((f) => (
        <li key={f.workspaceId} className={`ws floor ${f.workspaceId === current ? "on" : ""}`} style={{ paddingLeft: 8 + (depth + 1) * 14 }} data-testid="side-floor"
          onClick={() => act.select(f.workspaceId)} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setCtx({ x: e.clientX, y: e.clientY, ws: f }); }} title={`${f.branch ?? ""} · ${f.cwd}`}>
          <span className="fl-dot" style={{ background: STATUS_COLOR[f.status ?? "working"] }} /><GitBranch size={12} className="mut" />
          {!collapsed && <><span className="nm">{f.name}</span>{(data.terminals[f.workspaceId] ?? 0) > 0 && <span className="cnt"><Terminal size={11} /> {data.terminals[f.workspaceId]}</span>}</>}
        </li>
      )),
      ...(hasFloors ? [
        <li key={`${w.workspaceId}:ground`} className={`ws floor ground ${w.workspaceId === current ? "on" : ""}`} style={{ paddingLeft: 8 + (depth + 1) * 14 }} data-testid="side-ground"
          onClick={() => act.select(w.workspaceId)} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setCtx({ x: e.clientX, y: e.clientY, ws: w }); }} title={`Térreo · ${w.cwd}`}>
          <Layers size={13} className="gnd-ic" />
          {!collapsed && <span className="nm">Ground</span>}
        </li>,
      ] : []),
    ];
  };
  const folderRows = (parent: string | null, depth: number): React.ReactNode[] => children(parent).flatMap((f) => {
    if (q && !hasMatch(f)) return [];
    const open = q ? true : !f.collapsed;
    const inside = open ? [...folderRows(f.folderId, depth + 1), ...(byFolder.get(f.folderId) ?? []).map((w) => wsRow(w, depth + 1))] : [];
    if (f.kind === "group") {
      return [
        <li key={f.folderId} className={`grp ${over === f.folderId ? "over" : ""}`} style={{ paddingLeft: 8 + depth * 14 }} draggable onDragStart={(e) => onDragStart(e, "folder", f.folderId)}
          onDragOver={(e) => allow(e, f.folderId)} onDragLeave={() => setOver(null)} onDrop={(e) => onDrop(e, f.folderId)}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setCtx({ x: e.clientX, y: e.clientY, folder: f }); }}>
          <span className="line" />{!collapsed && <span className="gl">{f.name}</span>}<span className="line" />
        </li>, ...inside];
    }
    return [
      <li key={f.folderId} className={`fld ${over === f.folderId ? "over" : ""}`} style={{ paddingLeft: 8 + depth * 14 }} draggable onDragStart={(e) => onDragStart(e, "folder", f.folderId)}
        onDragOver={(e) => allow(e, f.folderId)} onDragLeave={() => setOver(null)} onDrop={(e) => onDrop(e, f.folderId)}
        onClick={() => act.toggleFolder(f)} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setCtx({ x: e.clientX, y: e.clientY, folder: f }); }}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}{open ? <FolderOpen size={14} /> : <FolderIcon size={14} />}
        {!collapsed && <span className="nm">{f.name}</span>}
      </li>, ...inside];
  });

  return (
    <aside className={`side ${collapsed ? "mini" : ""}`} onDragOver={(e) => allow(e, null)} onDrop={(e) => onDrop(e, null)} onContextMenu={(e) => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY }); }}>
      <h1>{collapsed ? "M" : "MessAI"}</h1>
      {!collapsed && <div className="slogan">Many agents. One organized mess.</div>}
      {!collapsed && <div className="machine">máquina {machine}</div>}
      <div className="side-top">
        {!collapsed && <input className="filter" placeholder="Filtrar" value={filter} onChange={(e) => setFilter(e.target.value)} data-testid="ws-filter" />}
        <button className="tb" title="Novo espaço (Ctrl+Shift+N)" data-testid="ws-new" onClick={() => act.newWorkspace()}><Plus size={16} /></button>
      </div>
      {!collapsed && <div className="sec">WORKSPACES</div>}
      <ul className={`tree ${over === null && over !== undefined ? "" : ""}`} data-testid="ws-tree">
        {folderRows(null, 0)}
        {(byFolder.get(null) ?? []).map((w) => wsRow(w, 0))}
      </ul>
      {data.workspaces.length === 0 && !collapsed && <div className="mut hint">Clique em + para criar o primeiro espaço.</div>}
      <div className="side-foot">
        <button title="Nova pasta" onClick={() => act.newFolder("folder")}><FolderPlus size={14} />{!collapsed && " Pasta"}</button>
        <button title="Novo grupo" onClick={() => act.newFolder("group")}><Minus size={14} />{!collapsed && " Grupo"}</button>
        <span className="sp" />
        <button className="tb" title="Preferências (Ctrl+,)" data-testid="settings" onClick={() => act.settings()}><Settings size={15} /></button>
      </div>
      {ctx && (
        <div className="menu-backdrop fixed" onMouseDown={() => setCtx(null)} onContextMenu={(e) => { e.preventDefault(); setCtx(null); }}>
          <div className="menu" style={{ left: ctx.x, top: ctx.y, position: "fixed" }} onMouseDown={(e) => e.stopPropagation()} onClick={() => setCtx(null)}>
            {ctx.ws && <>
              {!ctx.ws.parentId && <><div className="mi" onClick={() => act.newFloor(ctx.ws!)}>Novo andar…</div><div className="mi" onClick={() => act.overview(ctx.ws!)}>Visão geral dos andares</div><hr /></>}
              <div className="mi" onClick={() => act.editWorkspace(ctx.ws!)}>Editar…</div>
              <div className="mi" onClick={() => act.moveWorkspace(ctx.ws!, null)}>Tirar da pasta</div>
              <hr /><div className="mi" onClick={() => act.deleteWorkspace(ctx.ws!)}>Apagar espaço</div>
            </>}
            {ctx.folder && <>
              <div className="mi" onClick={() => act.newWorkspace(ctx.folder!.folderId)}>Novo espaço aqui</div>
              {ctx.folder.kind === "folder" && <div className="mi" onClick={() => act.newFolder("folder", ctx.folder!.folderId)}>Nova subpasta</div>}
              <div className="mi" onClick={() => act.renameFolder(ctx.folder!)}>Renomear…</div>
              {ctx.folder.parentId && <div className="mi" onClick={() => act.moveFolder(ctx.folder!, null)}>Mover para a raiz</div>}
              <hr /><div className="mi" onClick={() => act.deleteFolder(ctx.folder!)}>Apagar {ctx.folder.kind === "group" ? "grupo" : "pasta"}</div>
            </>}
            {!ctx.ws && !ctx.folder && <>
              <div className="mi" onClick={() => act.newWorkspace()}>Novo espaço…</div>
              <div className="mi" onClick={() => act.newFolder("folder")}>Nova pasta</div>
              <div className="mi" onClick={() => act.newFolder("group")}>Novo grupo</div>
            </>}
          </div>
        </div>
      )}
    </aside>
  );
}
