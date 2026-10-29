import { useEffect, useState } from "react";
import { X, RefreshCw, Activity } from "lucide-react";
import type { Api } from "./api.js";
import { AgentIcon, AGENT_COLORS } from "./agentIcons.js";

type Limit = { label: string; pct: number; resets: string };
type Agent = { id: string; label: string; available: boolean; note?: string; plan?: string; limits?: Limit[]; metrics: { label: string; value: string }[]; models: { name: string; input: number; output: number }[] };
const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));

/** Barra em tracinhos, como no Maestri. */
function Ticks({ pct, color }: { pct: number; color: string }) {
  const N = 34, on = Math.round((pct / 100) * N);
  return <div className="au-ticks">{Array.from({ length: N }).map((_, i) => <span key={i} style={i < on ? { background: color } : undefined} />)}</div>;
}
function resetsLabel(resets: string): string {
  if (!resets) return "";
  const t = /^\d+$/.test(resets) ? Number(resets) * (resets.length <= 10 ? 1000 : 1) : Date.parse(resets);
  if (!Number.isFinite(t)) return "";
  const ms = t - Date.now(); if (ms <= 0) return "a qualquer momento";
  const h = Math.round(ms / 3.6e6);
  if (h < 24) return `Reseta em ${h}h`;
  return `Reseta em ${Math.round(h / 24)}d`;
}

/** Painel "Agent Usage" no estilo Maestri: plano, limites de sessão/semanal em tracinhos, e atividade. */
export function AgentUsage({ api, onClose }: { api: Api; onClose: () => void }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const load = () => { setLoading(true); api.agentUsage().then((r) => setAgents(r.agents)).catch(() => setAgents([])).finally(() => setLoading(false)); };
  useEffect(() => { load(); const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="au" data-testid="agent-usage">
      <div className="au-head"><Activity size={15} /> <b>Agent Usage</b><span className="sp" /><button className="tb" title="Atualizar" onClick={load}><RefreshCw size={14} /></button><button className="tb" title="Fechar (Esc)" onClick={onClose}><X size={15} /></button></div>
      <div className="au-body">
        {loading && <div className="mut au-empty">carregando…</div>}
        {!loading && agents.map((a) => {
          const color = AGENT_COLORS[a.id] ?? "#888";
          const maxOut = Math.max(1, ...a.models.map((m) => m.output));
          const hasLimits = (a.limits?.length ?? 0) > 0;
          return (
            <div key={a.id} className={`au-agent ${a.available ? "" : "off"}`}>
              <div className="au-agent-head"><span className="au-icon"><AgentIcon id={a.id} size={38} /></span><div className="au-id"><div className="au-name">{a.label}</div><div className="au-plan mut">{a.plan ?? (a.available ? "" : a.note)}</div></div></div>
              {a.available && (<>
                {hasLimits ? (<div className="au-limits">
                  <div className="au-sec">Plan limits</div>
                  {a.limits!.map((l) => (
                    <div key={l.label} className="au-limit">
                      <div className="au-limit-top"><span>{l.label}</span><span className="sp" /><span className="au-pct">{l.pct}%</span></div>
                      <Ticks pct={l.pct} color={color} />
                      <div className="au-reset mut">{resetsLabel(l.resets)}</div>
                    </div>
                  ))}
                </div>) : a.note ? <div className="au-note mut">{a.note}</div> : null}
                <div className="au-metrics">{a.metrics.map((m) => <div key={m.label} className="au-metric"><div className="au-val">{m.value}</div><div className="au-lbl mut">{m.label}</div></div>)}</div>
                {a.models.length > 0 && <div className="au-models">
                  {a.models.map((m) => <div key={m.name} className="au-model"><span className="au-m-name" title={m.name}>{m.name}</span><span className="au-bar"><span style={{ width: `${(m.output / maxOut) * 100}%`, background: color }} /></span><span className="au-m-tok mut">{fmt(m.output)}</span></div>)}
                  <div className="au-models-cap mut">tokens de saída por modelo</div>
                </div>}
              </>)}
              {!a.available && a.note && <div className="au-note mut">{a.note}</div>}
            </div>
          );
        })}
        {!loading && agents.length === 0 && <div className="mut au-empty">sem dados</div>}
      </div>
    </div>
  );
}
