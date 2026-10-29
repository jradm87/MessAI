import { useState } from "react";
import { Plus, GitBranch, X, PlaneLanding, Trash2 } from "lucide-react";
import type { FloorStatus, LandResult, Workspace } from "@messyai/contracts";
import type { Api } from "./api.js";

export const STATUS_LABEL: Record<FloorStatus, string> = { working: "Trabalhando", blocked: "Bloqueado", review: "Pronto para revisão", done: "Concluído" };
export const STATUS_COLOR: Record<FloorStatus, string> = { working: "#5aa9ff", blocked: "#ff6b6b", review: "#f6c344", done: "#4cd964" };

/** Visão geral dos andares (Ctrl+Shift+\): térreo embaixo, andares empilhados em perspectiva, "+ Novo andar" no topo. */
export function FloorOverview({ ground, floors, current, terminals, api, onOpen, onNew, onClose, onChanged, onError }: {
  ground: Workspace; floors: Workspace[]; current: string | null; terminals: Record<string, number>; api: Api;
  onOpen: (id: string) => void; onNew: () => void; onClose: () => void; onChanged: () => void; onError: (m: string) => void;
}) {
  const [land, setLand] = useState<{ floor: Workspace; mode: "merge" | "squash"; keep: boolean; delBranch: boolean; result?: LandResult; busy?: boolean } | null>(null);
  const setStatus = (f: Workspace, status: FloorStatus) => api.patchWorkspace(f.workspaceId, { expectedRevision: f.revision, status }).then(onChanged).catch((e) => onError(String(e)));
  const doLand = async () => {
    if (!land) return; setLand({ ...land, busy: true });
    try { const result = await api.landFloor(land.floor.workspaceId, { mode: land.mode, keepFloor: land.keep, deleteBranch: land.delBranch }); setLand({ ...land, busy: false, result }); onChanged(); if (result.removed && current === land.floor.workspaceId) onOpen(ground.workspaceId); }
    catch (e) { setLand({ ...land, busy: false }); onError(String(e)); }
  };
  const del = (f: Workspace) => { if (confirm(`Excluir o andar "${f.name}"? O worktree é removido; a branch fica.`)) void api.deleteWorkspace(f.workspaceId).then(() => { onChanged(); if (current === f.workspaceId) onOpen(ground.workspaceId); }).catch((e) => onError(String(e))); };
  const stack = [...floors].reverse(); // o mais novo no topo
  return (
    <div className="overview" data-testid="overview" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ov-head"><GitBranch size={16} /> Andares de <b>{ground.name}</b> <span className="sp" /><button className="tb" title="Fechar (Esc)" onClick={onClose}><X size={16} /></button></div>
      <div className="ov-stage">
        <button className="ov-card new" onClick={onNew} data-testid="ov-new"><Plus size={22} /><span>Novo andar</span></button>
        {stack.map((f) => (
          <div key={f.workspaceId} className={`ov-card floor ${current === f.workspaceId ? "on" : ""}`} onClick={() => onOpen(f.workspaceId)} data-testid="ov-floor">
            <div className="ov-title"><span className="ov-dot" style={{ background: STATUS_COLOR[f.status ?? "working"] }} /> {f.name}<span className="sp" /><span className="mut">{terminals[f.workspaceId] ?? 0} term.</span></div>
            <div className="ov-meta"><GitBranch size={12} /> {f.branch ?? "sem branch"} · {f.floorType === "none" ? "mesmo diretório" : "worktree"}</div>
            <div className="ov-status">
              <select value={f.status ?? "working"} onClick={(e) => e.stopPropagation()} onChange={(e) => void setStatus(f, e.target.value as FloorStatus)}>
                {(Object.keys(STATUS_LABEL) as FloorStatus[]).map((k) => <option key={k} value={k}>{STATUS_LABEL[k]}</option>)}
              </select>
              {f.statusText && <span className="mut st-text" title={f.statusText}>{f.statusText}</span>}
              <span className="sp" />
              {f.floorType === "worktree" && <button className="tb" title="Pousar (merge no térreo)" onClick={(e) => { e.stopPropagation(); setLand({ floor: f, mode: "merge", keep: false, delBranch: false }); }}><PlaneLanding size={14} /></button>}
              <button className="tb danger" title="Excluir andar" onClick={(e) => { e.stopPropagation(); del(f); }}><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
        <div className={`ov-card ground ${current === ground.workspaceId ? "on" : ""}`} onClick={() => onOpen(ground.workspaceId)} data-testid="ov-ground">
          <div className="ov-title">Térreo · {ground.name}<span className="sp" /><span className="mut">{terminals[ground.workspaceId] ?? 0} term.</span></div>
          <div className="ov-meta">{ground.cwd}</div>
        </div>
      </div>
      {land && (
        <div className="modal-backdrop" onMouseDown={() => !land.busy && setLand(null)}>
          <div className="modal land-modal" onMouseDown={(e) => e.stopPropagation()}>
            <h2>Pousar "{land.floor.name}" no térreo</h2>
            {!land.result ? (<div className="form">
              <div className="mut">Faz merge local de <code>{land.floor.branch}</code> em {ground.name}. O térreo precisa estar sem alterações pendentes.</div>
              <div className="tabs"><button className={land.mode === "merge" ? "on" : ""} onClick={() => setLand({ ...land, mode: "merge" })}>Merge (--no-ff)</button><button className={land.mode === "squash" ? "on" : ""} onClick={() => setLand({ ...land, mode: "squash" })}>Squash</button></div>
              <label className="chk"><input type="checkbox" checked={land.keep} onChange={(e) => setLand({ ...land, keep: e.target.checked })} /> Manter o andar depois de pousar</label>
              <label className="chk"><input type="checkbox" checked={land.delBranch} disabled={land.keep} onChange={(e) => setLand({ ...land, delBranch: e.target.checked })} /> Apagar a branch</label>
              <div className="actions"><button onClick={() => setLand(null)}>Cancelar</button><button className="pri" disabled={land.busy} onClick={() => void doLand()}>{land.busy ? "Pousando…" : "Pousar"}</button></div>
            </div>) : land.result.ok ? (<div className="form">
              <div>✅ Pousado. {land.result.removed ? "Andar e worktree removidos." : "Andar mantido como Concluído."}</div>
              <pre className="land-out">{land.result.output}</pre>
              <div className="actions"><button className="pri" onClick={() => setLand(null)}>Fechar</button></div>
            </div>) : (<div className="form">
              <div>⚠️ Não pousou: conflitos em <b>{land.result.conflicts.join(", ") || "(ver saída)"}</b>. O merge foi abortado e o térreo está limpo. Resolva no andar (rebase/merge do térreo) e tente de novo.</div>
              <pre className="land-out">{land.result.output}</pre>
              <div className="actions"><button className="pri" onClick={() => setLand(null)}>Fechar</button></div>
            </div>)}
          </div>
        </div>
      )}
    </div>
  );
}
