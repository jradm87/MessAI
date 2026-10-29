import { useEffect, useState } from "react";
import { X, RefreshCw, Activity } from "lucide-react";
import type { Api } from "./api.js";

type Agent = { id: string; label: string; available: boolean; note?: string; metrics: { label: string; value: string }[]; models: { name: string; input: number; output: number }[] };
const ICON: Record<string, string> = { claude: "#d97757", codex: "#10a37f", gemini: "#4a9eff", opencode: "#a66bff" };
const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));

/** Painel "Agent Usage": atividade real de cada agente (sessões, mensagens, tokens). Cotas de plano não existem localmente. */
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
          const maxOut = Math.max(1, ...a.models.map((m) => m.output));
          return (
            <div key={a.id} className={`au-agent ${a.available ? "" : "off"}`}>
              <div className="au-agent-head"><span className="au-ring" style={{ background: ICON[a.id] ?? "#888" }} /><div><div className="au-name">{a.label}</div>{a.note && <div className="au-note mut">{a.note}</div>}</div></div>
              {a.available && (<>
                <div className="au-metrics">{a.metrics.map((m) => <div key={m.label} className="au-metric"><div className="au-val">{m.value}</div><div className="au-lbl mut">{m.label}</div></div>)}</div>
                {a.models.length > 0 && <div className="au-models">
                  {a.models.map((m) => <div key={m.name} className="au-model"><span className="au-m-name" title={m.name}>{m.name}</span><span className="au-bar"><span style={{ width: `${(m.output / maxOut) * 100}%` }} /></span><span className="au-m-tok mut">{fmt(m.output)}</span></div>)}
                  <div className="au-models-cap mut">tokens de saída por modelo</div>
                </div>}
              </>)}
            </div>
          );
        })}
        {!loading && agents.length === 0 && <div className="mut au-empty">sem dados</div>}
      </div>
    </div>
  );
}
