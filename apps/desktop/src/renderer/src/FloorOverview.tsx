import { useEffect, useMemo, useState } from "react";
import { Plus, GitBranch, GitPullRequest, PlaneLanding, Trash2, Home, Terminal, Play, Square, ExternalLink, RefreshCw, Upload, CheckCircle2 } from "lucide-react";
import type { FloorHookSection, FloorHooksState, FloorPrChecksStatus, FloorPrReviewStatus, FloorPrState, FloorStatus, GitHostEntry, GitHostKind, LandResult, Workspace } from "@messai/contracts";
import type { Api, Stream } from "./api.js";

export const STATUS_LABEL: Record<FloorStatus, string> = { working: "Trabalhando", blocked: "Bloqueado", review: "Pronto para revisão", done: "Concluído" };
export const STATUS_COLOR: Record<FloorStatus, string> = { working: "#5aa9ff", blocked: "#ff6b6b", review: "#f6c344", done: "#4cd964" };
const NODE_COLOR: Record<string, string> = { terminal: "#5aa9ff", note: "#f6c344", tree: "#4cd964", text: "#8a8a90" };
const REVIEW_LABEL: Record<FloorPrReviewStatus, string> = { none: "sem revisão", review_required: "revisão pendente", approved: "aprovado", changes_requested: "ajustes pedidos" };
const CHECKS_LABEL: Record<FloorPrChecksStatus, string> = { none: "sem checks", pending: "checks rodando", passing: "checks verdes", failing: "checks falhando" };
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
  const [prs, setPrs] = useState<Record<string, FloorPrState>>({});
  const [prModal, setPrModal] = useState<{ w: Workspace; pr: FloorPrState; title: string; body: string; baseBranch: string; draft: boolean; push: boolean; showHosts: boolean; hosts: GitHostEntry[]; newHost: string; newHostKind: GitHostKind; newHostTpl: string; busy?: boolean } | null>(null);
  const [minis, setMinis] = useState<Record<string, Mini>>({});
  const levels = useMemo(() => [ground, ...floors], [ground, floors]);
  const key = levels.map((w) => w.workspaceId).join(",");
  useEffect(() => {
    let alive = true;
    void Promise.all(levels.map((w) => api.snapshot(w.workspaceId)
      .then((s) => [w.workspaceId, { nodes: s.nodes.map((n) => ({ ...n.geometry, kind: n.kind, id: n.nodeId })), conns: (s.connections ?? []).map((c) => [c.sourceNodeId, c.targetNodeId] as [string, string]) }] as const)
      .catch(() => [w.workspaceId, { nodes: [], conns: [] }] as const)))
      .then((entries) => { if (alive) setMinis(Object.fromEntries(entries)); });
    void Promise.all(floors.map((f) => api.floorPr(f.workspaceId).then((p) => [f.workspaceId, p] as const).catch(() => null)))
      .then((entries) => { if (alive) setPrs(Object.fromEntries(entries.filter((x): x is [string, FloorPrState] => !!x))); });
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

  const openPrModal = async (w: Workspace) => {
    try {
      const [pr, hosts] = await Promise.all([api.floorPr(w.workspaceId), api.gitHosts()]);
      setPrModal({
        w,
        pr,
        title: pr.title ?? w.name,
        body: pr.body ?? "",
        baseBranch: pr.baseBranch,
        draft: pr.draft ?? false,
        push: true,
        showHosts: false,
        hosts,
        newHost: "",
        newHostKind: "github",
        newHostTpl: "",
      });
    } catch (e) { onError(String(e)); }
  };
  const submitCreatePr = async () => {
    if (!prModal || !prModal.title.trim()) return;
    setPrModal({ ...prModal, busy: true });
    try {
      const pr = await api.createFloorPr(prModal.w.workspaceId, {
        title: prModal.title.trim(),
        body: prModal.body,
        baseBranch: prModal.baseBranch,
        draft: prModal.draft,
        push: prModal.push,
      });
      setPrs((cur) => ({ ...cur, [prModal.w.workspaceId]: pr }));
      setPrModal((cur) => (cur ? { ...cur, pr, busy: false } : null));
      onChanged();
    } catch (e) {
      setPrModal((cur) => (cur ? { ...cur, busy: false } : null));
      onError(String(e));
    }
  };
  const doPrPatch = async (input: Parameters<typeof api.patchFloorPr>[1]) => {
    if (!prModal) return;
    setPrModal({ ...prModal, busy: true });
    try {
      const pr = await api.patchFloorPr(prModal.w.workspaceId, input);
      setPrs((cur) => ({ ...cur, [prModal.w.workspaceId]: pr }));
      setPrModal((cur) => (cur ? { ...cur, pr, busy: false } : null));
      onChanged();
    } catch (e) {
      setPrModal((cur) => (cur ? { ...cur, busy: false } : null));
      onError(String(e));
    }
  };
  const addGitHost = async () => {
    if (!prModal || !prModal.newHost.trim()) return;
    try {
      const next = [...prModal.hosts.filter((h) => h.host.toLowerCase() !== prModal.newHost.trim().toLowerCase()), {
        host: prModal.newHost.trim(),
        kind: prModal.newHostKind,
        ...(prModal.newHostTpl.trim() ? { prUrlTemplate: prModal.newHostTpl.trim() } : {}),
      }];
      const saved = await api.putGitHosts(next);
      const pr = await api.floorPr(prModal.w.workspaceId);
      setPrs((cur) => ({ ...cur, [prModal.w.workspaceId]: pr }));
      setPrModal((cur) => (cur ? { ...cur, hosts: saved, pr, newHost: "", newHostTpl: "" } : null));
    } catch (e) { onError(String(e)); }
  };
  const removeGitHost = async (host: string) => {
    if (!prModal) return;
    try {
      const saved = await api.putGitHosts(prModal.hosts.filter((h) => h.host !== host));
      const pr = await api.floorPr(prModal.w.workspaceId);
      setPrs((cur) => ({ ...cur, [prModal.w.workspaceId]: pr }));
      setPrModal((cur) => (cur ? { ...cur, hosts: saved, pr } : null));
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

  const Level = ({ w, isGround }: { w: Workspace; isGround: boolean }) => {
    const pr = prs[w.workspaceId];
    return (
      <div className={`f3d-level ${current === w.workspaceId ? "on" : ""}`} data-testid={isGround ? "ov-ground" : "ov-floor"}>
        <div className="f3d-label">
          {isGround ? <Home size={13} /> : <span className="ov-dot" style={{ background: STATUS_COLOR[w.status ?? "working"] }} />}
          <b>{isGround ? `Térreo · ${w.name}` : w.name}</b>
          {!isGround && <span className="mut br"><GitBranch size={11} /> {w.branch}</span>}
          {!isGround && pr && pr.state !== "none" && (
            <>
              <span className="badge" data-testid="floor-pr-badge" title={pr.title ?? ""}>
                PR #{pr.number} · {pr.state === "merged" ? "merged" : pr.state === "closed" ? "fechado" : pr.draft ? "rascunho" : "aberto"}
              </span>
              <span className="badge" data-testid="floor-pr-review">{REVIEW_LABEL[pr.reviewStatus]}</span>
              <span className="badge" data-testid="floor-pr-checks">{CHECKS_LABEL[pr.checksStatus]}</span>
            </>
          )}
          <span className="sp" />
          <span className="mut">{terminals[w.workspaceId] ?? 0} term.</span>
          <button className="tb" title="Hooks de ciclo de vida (setup / run / teardown)" data-testid={isGround ? "ground-hooks-btn" : "floor-hooks-btn"} onClick={() => void openHooks(w)}><Terminal size={13} /> Hooks</button>
          {!isGround && <>
            <button className="tb" title="Pull Request do andar (abrir PR, revisão, checks e ações rápidas)" data-testid="floor-pr-btn" onClick={() => void openPrModal(w)}>
              <GitPullRequest size={13} /> {pr && pr.state !== "none" ? `PR #${pr.number}` : "Pull Request"}
            </button>
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
  };

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
      {prModal && (
        <div className="modal-backdrop" onMouseDown={() => !prModal.busy && setPrModal(null)}>
          <div className="modal land-modal" data-testid="floor-pr-modal" style={{ width: 620, maxWidth: "92vw" }} onMouseDown={(e) => e.stopPropagation()}>
            <h2>Pull Request · {prModal.w.name}</h2>
            <div className="form">
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <span className="mut">
                  <code>{prModal.pr.branch}</code> → <code>{prModal.pr.baseBranch}</code> · +{prModal.pr.ahead}/-{prModal.pr.behind} · host <b>{prModal.pr.host}</b> ({prModal.pr.hostKind})
                </span>
                <button type="button" className="tb" data-testid="git-hosts-toggle" onClick={() => setPrModal({ ...prModal, showHosts: !prModal.showHosts })}>
                  Hosts Git ({prModal.hosts.length})
                </button>
              </div>
              {prModal.showHosts && (
                <div style={{ padding: 8, border: "1px solid var(--border, #2a2a30)", borderRadius: 6, display: "flex", flexDirection: "column", gap: 6 }} data-testid="git-hosts-section">
                  <b>Hosts Git configuráveis (GitHub Enterprise, GitLab self-hosted, Gitea, custom)</b>
                  <div className="row" style={{ gap: 6 }}>
                    <input value={prModal.newHost} onChange={(e) => setPrModal({ ...prModal, newHost: e.target.value })} placeholder="ex.: gitlab.minhaempresa.com.br" data-testid="git-host-input" style={{ flex: 1 }} />
                    <select value={prModal.newHostKind} onChange={(e) => setPrModal({ ...prModal, newHostKind: e.target.value as GitHostKind })} data-testid="git-host-kind">
                      <option value="github">GitHub</option>
                      <option value="gitlab">GitLab</option>
                      <option value="gitea">Gitea / Forgejo</option>
                      <option value="custom">Custom</option>
                    </select>
                    <button type="button" className="tb" data-testid="git-host-add" onClick={() => void addGitHost()}>Adicionar</button>
                  </div>
                  {prModal.newHostKind === "custom" && (
                    <input value={prModal.newHostTpl} onChange={(e) => setPrModal({ ...prModal, newHostTpl: e.target.value })} placeholder="Template URL: https://{host}/{repo}/pr?from={head}&to={base}" data-testid="git-host-tpl" />
                  )}
                  {prModal.hosts.map((h) => (
                    <div key={h.host} className="row" style={{ justifyContent: "space-between", fontSize: 12 }} data-testid="git-host-row">
                      <span><b>{h.host}</b> ({h.kind}) {h.prUrlTemplate ? `· ${h.prUrlTemplate}` : ""}</span>
                      <button type="button" className="tb danger" onClick={() => void removeGitHost(h.host)}>Remover</button>
                    </div>
                  ))}
                </div>
              )}
              {prModal.pr.state === "none" ? (
                <>
                  <label>Título do Pull Request<input value={prModal.title} onChange={(e) => setPrModal({ ...prModal, title: e.target.value })} data-testid="pr-title-input" /></label>
                  <label>Descrição<input value={prModal.body} onChange={(e) => setPrModal({ ...prModal, body: e.target.value })} placeholder="Resumo das mudanças deste andar…" data-testid="pr-body-input" /></label>
                  <label>Branch alvo (base)<input value={prModal.baseBranch} onChange={(e) => setPrModal({ ...prModal, baseBranch: e.target.value })} data-testid="pr-base-input" /></label>
                  <div className="row" style={{ gap: 16 }}>
                    <label className="chk"><input type="checkbox" checked={prModal.draft} onChange={(e) => setPrModal({ ...prModal, draft: e.target.checked })} data-testid="pr-draft-chk" /> Rascunho (Draft)</label>
                    <label className="chk"><input type="checkbox" checked={prModal.push} onChange={(e) => setPrModal({ ...prModal, push: e.target.checked })} data-testid="pr-push-chk" /> Fazer push da branch ao abrir</label>
                  </div>
                  <div className="mut" style={{ fontSize: 11 }}>URL de comparação: <code data-testid="pr-compare-url">{prModal.pr.compareUrl}</code></div>
                  <div className="actions">
                    <button type="button" onClick={() => setPrModal(null)}>Cancelar</button>
                    <button type="button" className="tb" data-testid="pr-open-compare" onClick={() => void window.messai?.openExternal?.(prModal.pr.compareUrl)}><ExternalLink size={12} /> Abrir comparação na web</button>
                    <button type="button" className="pri" disabled={prModal.busy || !prModal.title.trim()} data-testid="pr-create-submit" onClick={() => void submitCreatePr()}>
                      {prModal.busy ? "Criando…" : "Abrir Pull Request"}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span className="badge" data-testid="pr-modal-state">PR #{prModal.pr.number} · {prModal.pr.state}</span>
                    <b>{prModal.pr.title}</b>
                    {prModal.pr.draft && <span className="badge">Draft</span>}
                  </div>
                  <div className="mut" style={{ fontSize: 12 }}>URL: <code data-testid="pr-modal-url">{prModal.pr.url}</code></div>
                  <div className="row" style={{ gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                    <label className="row" style={{ gap: 6, fontSize: 12 }}>
                      Revisão:
                      <select value={prModal.pr.reviewStatus} data-testid="pr-review-select" onChange={(e) => void doPrPatch({ reviewStatus: e.target.value as FloorPrReviewStatus })}>
                        {(Object.keys(REVIEW_LABEL) as FloorPrReviewStatus[]).map((k) => <option key={k} value={k}>{REVIEW_LABEL[k]}</option>)}
                      </select>
                    </label>
                    <label className="row" style={{ gap: 6, fontSize: 12 }}>
                      Checks:
                      <select value={prModal.pr.checksStatus} data-testid="pr-checks-select" onChange={(e) => void doPrPatch({ checksStatus: e.target.value as FloorPrChecksStatus })}>
                        {(Object.keys(CHECKS_LABEL) as FloorPrChecksStatus[]).map((k) => <option key={k} value={k}>{CHECKS_LABEL[k]}</option>)}
                      </select>
                    </label>
                  </div>
                  <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 6 }} data-testid="pr-quick-actions">
                    <button type="button" className="tb" data-testid="pr-open-web" onClick={() => prModal.pr.url && void window.messai?.openExternal?.(prModal.pr.url)}><ExternalLink size={12} /> Abrir no navegador</button>
                    <button type="button" className="tb" data-testid="pr-action-push" disabled={prModal.busy} onClick={() => void doPrPatch({ action: "push" })}><Upload size={12} /> Push da branch</button>
                    <button type="button" className="tb" data-testid="pr-action-refresh" disabled={prModal.busy} onClick={() => void doPrPatch({ action: "refresh" })}><RefreshCw size={12} /> Atualizar status</button>
                    {prModal.pr.state === "open" && (
                      <>
                        <button type="button" className="pri" data-testid="pr-action-merge" disabled={prModal.busy} onClick={() => void doPrPatch({ action: "merge" })}><CheckCircle2 size={12} /> Fazer Merge do PR</button>
                        <button type="button" className="tb danger" data-testid="pr-action-close" disabled={prModal.busy} onClick={() => void doPrPatch({ action: "close" })}>Fechar PR</button>
                      </>
                    )}
                  </div>
                  <div className="actions">
                    <button type="button" onClick={() => setPrModal(null)}>Fechar</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
