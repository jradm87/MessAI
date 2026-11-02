import { useEffect, useMemo, useState } from "react";
import { Plus, GitBranch, PlaneLanding, Trash2, Home, Terminal, Play, Square } from "lucide-react";
import type { FloorHookSection, FloorHooksState, FloorStatus, LandResult, Workspace } from "@messai/contracts";
import type { Api, Stream } from "./api.js";

export const STATUS_LABEL: Record<FloorStatus, string> = { working: "Trabalhando", blocked: "Bloqueado", review: "Pronto para revisão", done: "Concluído" };
export const STATUS_COLOR: Record<FloorStatus, string> = { working: "#5aa9ff", blocked: "#ff6b6b", review: "#f6c344", done: "#4cd964" };
const NODE_COLOR: Record<string, string> = { terminal: "#5aa9ff", note: "#f6c344", tree: "#4cd964", text: "#8a8a90" };
const HOOK_SECTIONS: { key: FloorHookSection; label: string; desc: string }[] = [
  { key: "setup", label: "Setup (ao criar)", desc: "Roda automaticamente quando o andar é criado." },
  { key: "run", label: "Run (sob demanda)", desc: "Serviços ou tarefas iniciados manualmente." },
  { key: "teardown", label: "Teardown (ao remover)", desc: "Roda antes de remover o andar/worktree." },
];
const HOOK_STATE_LABEL: Record<string, string> = { idle: "inativo", running: "rodando", succeeded: "concluído", failed: "falhou", stopped: "parado" };

type Mini = { nodes: { x: number; y: number; w: number; h: number; kind: string; id: string }[]; conns: [string, string][] };

/** Visão geral dos andares (Ctrl+Shift+\): cada andar é um plano 3D com miniatura dos nós; térreo embaixo, andares acima. */
export function FloorOverview({ ground, floors, current, terminals, api, stream, onOpen, onNew, onClose, onChanged, onError }: {
  ground: Workspace; floors: Workspace[]; current: string | null; terminals: Record<string, number>; api: Api; stream?: Stream;
  onOpen: (id: string) => void; onNew: () => void; onClose: () => void; onChanged: () => void; onError: (m: string) => void;
}) {
  const [land, setLand] = useState<{ floor: Workspace; mode: "merge" | "squash"; keep: boolean; delBranch: boolean; result?: LandResult; busy?: boolean } | null>(null);
  const [hooksModal, setHooksModal] = useState<{ w: Workspace; state: FloorHooksState; setup: string; run: string; teardown: string; activeLog: FloorHookSection; busy?: boolean } | null>(null);
  const [minis, setMinis] = useState<Record<string, Mini>>({});
  const levels = useMemo(() => [ground, ...floors], [ground, floors]);
  const key = levels.map((w) => w.workspaceId).join(",");
  useEffect(() => {
    let alive = true;
    void Promise.all(levels.map((w) => api.snapshot(w.workspaceId)
      .then((s) => [w.workspaceId, { nodes: s.nodes.map((n) => ({ ...n.geometry, kind: n.kind, id: n.nodeId })), conns: (s.connections ?? []).map((c) => [c.sourceNodeId, c.targetNodeId] as [string, string]) }] as const)
      .catch(() => [w.workspaceId, { nodes: [], conns: [] }] as const)))
      .then((entries) => { if (alive) setMinis(Object.fromEntries(entries)); });
    return () => { alive = false; };
  }, [key, api]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!hooksModal) return;
    const wsId = hooksModal.w.workspaceId;
    let alive = true;
    const off = stream?.on((m) => {
      if (m.type === "floorHook" && m.workspaceId === wsId) {
        setHooksModal((cur) => cur && cur.w.workspaceId === wsId ? { ...cur, state: { ...cur.state, status: { ...cur.state.status, [m.status.section]: m.status } } } : cur);
      }
    });
    const t = setInterval(() => {
      void api.floorHooks(wsId).then((st) => {
        if (alive) setHooksModal((cur) => cur && cur.w.workspaceId === wsId ? { ...cur, state: st } : cur);
      }).catch(() => {});
    }, 400);
    return () => { alive = false; clearInterval(t); off?.(); };
  }, [hooksModal?.w.workspaceId, api, stream]); // eslint-disable-line react-hooks/exhaustive-deps

  const openHooks = async (w: Workspace) => {
    try {
      const st = await api.floorHooks(w.workspaceId);
      setHooksModal({ w, state: st, setup: st.hooks.setup, run: st.hooks.run, teardown: st.hooks.teardown, activeLog: "setup" });
    } catch (e) { onError(String(e)); }
  };
  const saveHooks = async () => {
    if (!hooksModal) return;
    try {
      const st = await api.putFloorHooks(hooksModal.w.workspaceId, { setup: hooksModal.setup, run: hooksModal.run, teardown: hooksModal.teardown });
      setHooksModal((cur) => cur ? { ...cur, state: st } : cur);
    } catch (e) { onError(String(e)); }
  };
  const runHook = async (section: FloorHookSection | "all") => {
    if (!hooksModal) return;
    try {
      await api.putFloorHooks(hooksModal.w.workspaceId, { setup: hooksModal.setup, run: hooksModal.run, teardown: hooksModal.teardown });
      const st = await api.runFloorHooks(hooksModal.w.workspaceId, { section });
      const pick: FloorHookSection = section === "all" ? (hooksModal.setup.trim() ? "setup" : hooksModal.run.trim() ? "run" : "teardown") : section;
      setHooksModal((cur) => cur ? { ...cur, state: st, activeLog: pick } : cur);
    } catch (e) { onError(String(e)); }
  };
  const stopHook = async (section: FloorHookSection | "all") => {
    if (!hooksModal) return;
    try {
      const st = await api.stopFloorHooks(hooksModal.w.workspaceId, { section });
      setHooksModal((cur) => cur ? { ...cur, state: st } : cur);
    } catch (e) { onError(String(e)); }
  };

  const setStatus = (f: Workspace, status: FloorStatus) => api.patchWorkspace(f.workspaceId, { expectedRevision: f.revision, status }).then(onChanged).catch((e) => onError(String(e)));
  const doLand = async () => {
    if (!land) return; setLand({ ...land, busy: true });
    try { const result = await api.landFloor(land.floor.workspaceId, { mode: land.mode, keepFloor: land.keep, deleteBranch: land.delBranch }); setLand({ ...land, busy: false, result }); onChanged(); if (result.removed && current === land.floor.workspaceId) onOpen(ground.workspaceId); }
    catch (e) { setLand({ ...land, busy: false }); onError(String(e)); }
  };
  const del = (f: Workspace) => { if (confirm(`Excluir o andar "${f.name}"? O worktree é removido; a branch fica.`)) void api.deleteWorkspace(f.workspaceId).then(() => { onChanged(); if (current === f.workspaceId) onOpen(ground.workspaceId); }).catch((e) => onError(String(e))); };

  const Preview = ({ m }: { m: Mini | undefined }) => {
    if (!m || m.nodes.length === 0) return <div className="f3d-empty">vazio</div>;
    const xs = m.nodes.flatMap((n) => [n.x, n.x + n.w]), ys = m.nodes.flatMap((n) => [n.y, n.y + n.h]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const spanX = Math.max(1, maxX - minX), spanY = Math.max(1, maxY - minY), PAD = 8;
    const nx = (v: number) => PAD + ((v - minX) / spanX) * (100 - 2 * PAD);
    const ny = (v: number) => PAD + ((v - minY) / spanY) * (100 - 2 * PAD);
    const center = (id: string) => { const n = m.nodes.find((x) => x.id === id); return n ? { x: nx(n.x + n.w / 2), y: ny(n.y + n.h / 2) } : null; };
    return (
      <div className="f3d-preview">
        <svg className="f3d-wires" viewBox="0 0 100 100" preserveAspectRatio="none">
          {m.conns.map(([a, b], i) => { const p = center(a), q = center(b); return p && q ? <line key={i} x1={p.x} y1={p.y} x2={q.x} y2={q.y} /> : null; })}
        </svg>
        {m.nodes.map((n) => (
          <div key={n.id} className="f3d-node" style={{ left: `${nx(n.x)}%`, top: `${ny(n.y)}%`, width: `${(n.w / spanX) * (100 - 2 * PAD)}%`, height: `${(n.h / spanY) * (100 - 2 * PAD)}%`, borderColor: NODE_COLOR[n.kind] ?? "#8a8a90" }} />
        ))}
      </div>
    );
  };

  const Level = ({ w, isGround }: { w: Workspace; isGround: boolean }) => (
    <div className={`f3d-level ${current === w.workspaceId ? "on" : ""}`} data-testid={isGround ? "ov-ground" : "ov-floor"}>
      <div className="f3d-label">
        {isGround ? <Home size={13} /> : <span className="ov-dot" style={{ background: STATUS_COLOR[w.status ?? "working"] }} />}
        <b>{isGround ? `Térreo · ${w.name}` : w.name}</b>
        {!isGround && <span className="mut br"><GitBranch size={11} /> {w.branch}</span>}
        <span className="sp" />
        <span className="mut">{terminals[w.workspaceId] ?? 0} term.</span>
        <button className="tb" title="Hooks de ciclo de vida (setup / run / teardown)" data-testid={isGround ? "ground-hooks-btn" : "floor-hooks-btn"} onClick={() => void openHooks(w)}><Terminal size={13} /> Hooks</button>
        {!isGround && <>
          <select className="f3d-status" value={w.status ?? "working"} onChange={(e) => void setStatus(w, e.target.value as FloorStatus)}>
            {(Object.keys(STATUS_LABEL) as FloorStatus[]).map((k) => <option key={k} value={k}>{STATUS_LABEL[k]}</option>)}
          </select>
          {w.floorType === "worktree" && <button className="tb" title="Pousar (merge no térreo)" onClick={() => setLand({ floor: w, mode: "merge", keep: false, delBranch: false })}><PlaneLanding size={13} /></button>}
          <button className="tb danger" title="Excluir andar" onClick={() => del(w)}><Trash2 size={13} /></button>
        </>}
      </div>
      <div className={`f3d-plane ${isGround ? "ground" : ""}`} onClick={() => onOpen(w.workspaceId)} title={`Abrir ${w.name}`}>
        <Preview m={minis[w.workspaceId]} />
      </div>
    </div>
  );

  return (
    <div className="overview" data-testid="overview" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="f3d-stage" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        {[...floors].reverse().map((f) => <Level key={f.workspaceId} w={f} isGround={false} />)}
        <Level w={ground} isGround />
      </div>
      <div className="f3d-pills">
        <button className="f3d-pill new" onClick={onNew} data-testid="ov-new"><Plus size={13} /> New Floor</button>
        {[...floors].reverse().map((f) => <button key={f.workspaceId} className={`f3d-pill ${current === f.workspaceId ? "on" : ""}`} onClick={() => onOpen(f.workspaceId)}><GitBranch size={12} /> {f.name}</button>)}
        <button className={`f3d-pill ground ${current === ground.workspaceId ? "on" : ""}`} onClick={() => onOpen(ground.workspaceId)} data-testid="ov-ground-pill"><Home size={13} /> Ground</button>
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
              <div>⚠️ Não pousou: conflitos em <b>{land.result.conflicts.join(", ") || "(ver saída)"}</b>. O merge foi abortado e o térreo está limpo. Resolva no andar e tente de novo.</div>
              <pre className="land-out">{land.result.output}</pre>
              <div className="actions"><button className="pri" onClick={() => setLand(null)}>Fechar</button></div>
            </div>)}
          </div>
        </div>
      )}
      {hooksModal && (
        <div className="modal-backdrop" onMouseDown={() => setHooksModal(null)}>
          <div className="modal land-modal" data-testid="floor-hooks-modal" style={{ width: 640, maxWidth: "92vw" }} onMouseDown={(e) => e.stopPropagation()}>
            <h2>Hooks · {hooksModal.w.name}</h2>
            <div className="form">
              <div className="mut">Variáveis disponíveis nos comandos: <code>MESS_FLOOR_NAME</code>, <code>MESS_FLOOR_BRANCH</code>, <code>MESS_FLOOR_PATH</code>, <code>MESS_ROOT_PATH</code>, <code>MESS_PROJECT_NAME</code>.</div>
              {HOOK_SECTIONS.map(({ key: sec, label, desc }) => {
                const st = hooksModal.state.status[sec];
                const val = hooksModal[sec];
                return (
                  <div key={sec} style={{ display: "flex", flexDirection: "column", gap: 4, padding: "6px 0", borderBottom: "1px solid var(--border, #2a2a30)" }}>
                    <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
                      <div><b>{label}</b> <span className="mut" style={{ fontSize: 11 }}>{desc}</span></div>
                      <div className="row" style={{ gap: 6, alignItems: "center" }}>
                        <span className="badge" data-testid={`hook-state-${sec}`}>{HOOK_STATE_LABEL[st.state] ?? st.state}{st.exitCode !== undefined ? ` (${st.exitCode})` : ""}</span>
                        <button type="button" className="tb" data-testid={`hook-run-${sec}`} disabled={!val.trim()} onClick={() => void runHook(sec)} title={`Rodar ${sec}`}><Play size={12} /> Rodar</button>
                        {st.state === "running" && <button type="button" className="tb danger" data-testid={`hook-stop-${sec}`} onClick={() => void stopHook(sec)} title={`Parar ${sec}`}><Square size={12} /> Parar</button>}
                      </div>
                    </div>
                    <input value={val} onChange={(e) => setHooksModal({ ...hooksModal, [sec]: e.target.value })} placeholder={`Comando de ${sec}...`} data-testid={`hook-cmd-${sec}`} />
                  </div>
                );
              })}
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
                <div className="tabs">
                  {HOOK_SECTIONS.map(({ key: sec }) => (
                    <button key={sec} type="button" className={hooksModal.activeLog === sec ? "on" : ""} data-testid={`hook-tab-${sec}`} onClick={() => setHooksModal({ ...hooksModal, activeLog: sec })}>
                      Log: {sec} ({HOOK_STATE_LABEL[hooksModal.state.status[sec].state] ?? hooksModal.state.status[sec].state})
                    </button>
                  ))}
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <button type="button" className="tb" data-testid="hook-run-all" onClick={() => void runHook("all")}><Play size={12} /> Rodar tudo</button>
                  <button type="button" className="tb danger" data-testid="hook-stop-all" onClick={() => void stopHook("all")}><Square size={12} /> Parar tudo</button>
                </div>
              </div>
              <pre className="land-out" data-testid="hook-logs" style={{ minHeight: 110, maxHeight: 220, overflow: "auto", margin: 0 }}>{hooksModal.state.status[hooksModal.activeLog].log || "(sem saída)"}</pre>
              <div className="actions">
                <button type="button" onClick={() => setHooksModal(null)}>Fechar</button>
                <button type="button" className="pri" data-testid="hook-save" onClick={() => void saveHooks()}>Salvar hooks</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
