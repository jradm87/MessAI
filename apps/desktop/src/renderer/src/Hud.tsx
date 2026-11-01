import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ArrowRight, Sparkles, Trash2, X } from "lucide-react";
import type { CompanionConfig } from "@messai/contracts";
import { Api, Stream, type Connection } from "./api.js";
import { AgentIcon, agentKind } from "./agentIcons.js";
import { awaitingSummary, EMPTY_HUD, hudReduce, relTime, screenTail } from "./hud-model.js";

/**
 * #67 — janela flutuante do companheiro (segunda BrowserWindow, sempre no topo).
 * Escuta TODOS os espaços: cada agente que conclui um turno vira um cartão com a última tela e,
 * quando o modelo local responde (#66), resumo + próximo passo. Ações: ir ao terminal, dispensar.
 */
export function Hud({ conn }: { conn: Connection }) {
  const api = useMemo(() => new Api(conn), [conn]);
  const stream = useMemo(() => new Stream(conn), [conn]);
  const [state, dispatch] = useReducer(hudReduce, EMPTY_HUD);
  const [companion, setCompanion] = useState<CompanionConfig | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const known = useRef(new Set<string>()); // espaços já inscritos

  // Inscreve em todos os espaços (novos entram quando a sidebar muda; removidos limpam os cartões).
  const syncWorkspaces = useCallback(async () => {
    const ws = await api.listWorkspaces();
    const ids = new Set(ws.map((w) => w.workspaceId));
    for (const id of ids) if (!known.current.has(id)) { known.current.add(id); stream.subscribe(id); }
    for (const id of [...known.current]) if (!ids.has(id)) { known.current.delete(id); stream.unsubscribe(id); dispatch({ type: "workspaceGone", workspaceId: id }); }
  }, [api, stream]);
  useEffect(() => { void syncWorkspaces().catch(() => {}); const t = setInterval(() => void syncWorkspaces().catch(() => {}), 15_000); return () => clearInterval(t); }, [syncWorkspaces]);

  // Nome do nó e do espaço para o cabeçalho do cartão (o evento só traz ids).
  const labelFor = useCallback(async (workspaceId: string, nodeId: string) => {
    try {
      const snap = await api.snapshot(workspaceId);
      const n = snap.nodes.find((x) => x.nodeId === nodeId);
      dispatch({ type: "label", nodeId, ...(n?.title ? { title: n.title } : {}), workspace: snap.workspace.name });
    } catch { /* espaço sumiu entre o evento e a consulta: cartão fica só com o id */ }
  }, [api]);

  useEffect(() => stream.on((m) => {
    if (m.type === "sidebar") void syncWorkspaces().catch(() => {});
    if (m.type === "taskFinished") { dispatch({ type: "finished", event: m.event }); void labelFor(m.event.workspaceId, m.event.nodeId); }
    if (m.type === "taskSummary") dispatch({ type: "summary", summary: m.summary });
  }), [stream, syncWorkspaces, labelFor]);

  // Status do companheiro (modelo local) no rodapé.
  useEffect(() => {
    const load = () => api.companion().then(setCompanion).catch(() => setCompanion(null));
    void load(); const t = setInterval(load, 30_000); return () => clearInterval(t);
  }, [api]);
  // A janela principal avisa quando o usuário focou o terminal (o cartão some dos dois lados).
  useEffect(() => window.messai.onHudDismiss?.((nodeId) => dispatch({ type: "dismiss", nodeId })), []);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(t); }, []);

  const go = (workspaceId: string, nodeId: string) => { void window.messai.hudFocus?.({ workspaceId, nodeId }); dispatch({ type: "dismiss", nodeId }); };
  const available = !!companion?.available;

  return (
    <div className="hud" data-testid="hud">
      <div className="hud-head">
        <Sparkles size={15} /><b>Companheiro</b>
        {state.cards.length > 0 && <span className="hud-count">{state.cards.length}</span>}
        <span className="sp" />
        <button className="tb" title="Limpar tudo" disabled={!state.cards.length} onClick={() => dispatch({ type: "clear" })}><Trash2 size={14} /></button>
        <button className="tb" title="Fechar janela flutuante" onClick={() => void window.messai.hudToggle?.(false)}><X size={15} /></button>
      </div>
      <div className="hud-list">
        {state.cards.length === 0 && (
          <div className="hud-empty">
            <Sparkles size={22} />
            <div>Nenhum agente terminou um turno ainda.</div>
            <div className="hud-empty-sub">Quando um agente concluir, o cartão aparece aqui{available ? " com resumo e próximo passo" : ""}.</div>
          </div>
        )}
        {state.cards.map((c) => (
          <div key={c.nodeId} className={`hud-card ${c.summary ? "done" : ""}`} data-testid="hud-card">
            <div className="hud-card-head">
              <AgentIcon id={agentKind(c.agentType)} size={16} />
              <span className="t" title={c.title ?? c.nodeId}>{c.title ?? c.nodeId.slice(0, 8)}</span>
              {c.workspace && <span className="m">{c.workspace}</span>}
              <span className="m">{relTime(c.at, now)}</span>
            </div>
            {c.summary
              ? <p className="hud-sum">{c.summary}</p>
              : <pre className="hud-screen">{screenTail(c.screen) || "(sem saída visível)"}</pre>}
            {c.nextStep && <p className="hud-next"><ArrowRight size={13} /><span>{c.nextStep}</span></p>}
            {awaitingSummary(c, available, now) && <div className="hud-wait">resumindo com {companion?.model}…</div>}
            <div className="hud-actions">
              <button className="pri" onClick={() => go(c.workspaceId, c.nodeId)}>Ir ao terminal</button>
              <button onClick={() => dispatch({ type: "dismiss", nodeId: c.nodeId })}>Dispensar</button>
            </div>
          </div>
        ))}
      </div>
      <div className="hud-foot">
        <span className={`hud-dot ${available ? "on" : ""}`} />
        {companion === null ? "runtime indisponível"
          : !companion.enabled ? "resumos desligados (MESS_COMPANION=0)"
          : available ? `modelo local: ${companion.model}`
          : `sem modelo local (${companion.url}) — só a última tela`}
      </div>
    </div>
  );
}
