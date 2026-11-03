import { useEffect, useState } from "react";
import { Play, Plus, Trash2, X, Clock } from "lucide-react";
import type { Routine, RoutineActionType, RoutineScheduleType } from "@messai/contracts";
import type { Api } from "./api.js";

export type RoutinesDialogProps = {
  api: Api;
  workspaceId: string;
  terminals: { nodeId: string; title: string }[];
  onClose: () => void;
};

/** #27 — Rotinas agendadas e recorrentes (prompts a terminais ou comandos shell, podendo acordar terminal descarregado). */
export function RoutinesDialog({ api, workspaceId, terminals, onClose }: RoutinesDialogProps) {
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [name, setName] = useState("");
  const [actionType, setActionType] = useState<RoutineActionType>("command");
  const [targetNodeId, setTargetNodeId] = useState<string>("");
  const [payload, setPayload] = useState("");
  const [scheduleType, setScheduleType] = useState<RoutineScheduleType>("interval");
  const [intervalSeconds, setIntervalSeconds] = useState(300);
  const [wakeIfUnloaded, setWakeIfUnloaded] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => {
    void api.routines(workspaceId).then(setRoutines).catch(() => {});
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [workspaceId]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, [onClose]);

  const create = async () => {
    if (!name.trim() || !payload.trim()) return;
    setMsg(null);
    try {
      await api.createRoutine(workspaceId, {
        name: name.trim(),
        actionType,
        ...(actionType === "prompt" && targetNodeId ? { targetNodeId } : {}),
        payload: payload.trim(),
        scheduleType,
        intervalSeconds: Math.max(1, Number(intervalSeconds) || 60),
        wakeIfUnloaded,
      });
      setName("");
      setPayload("");
      load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const runNow = async (r: Routine) => {
    try {
      const res = await api.runRoutine(r.routineId);
      setMsg(`[${res.status}] ${res.output || "executada"}`);
      load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const toggle = async (r: Routine) => {
    await api.patchRoutine(r.routineId, { enabled: !r.enabled }).catch(() => {});
    load();
  };

  const remove = async (r: Routine) => {
    await api.deleteRoutine(r.routineId).catch(() => {});
    load();
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" style={{ width: 640, maxWidth: "92vw" }} data-testid="routines-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="row" style={{ marginBottom: 10 }}>
          <Clock size={16} />
          <h3 style={{ margin: 0 }}>Rotinas agendadas (#27)</h3>
          <span className="sp" />
          <button className="tb" data-testid="routines-close" onClick={onClose}><X size={15} /></button>
        </div>
        <p className="mut" style={{ margin: "0 0 10px", fontSize: 12 }}>
          Comandos shell ou prompts recorrentes executados pelo runtime em segundo plano (mesmo com a janela fechada).
        </p>

        <div className="card" style={{ padding: 10, marginBottom: 12 }}>
          <div className="row" style={{ gap: 8, marginBottom: 8 }}>
            <input
              placeholder="Nome da rotina (ex.: Lint contínuo)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="routine-name-input"
              style={{ flex: 1 }}
            />
            <select value={actionType} onChange={(e) => setActionType(e.target.value as RoutineActionType)} data-testid="routine-type-select">
              <option value="command">Comando shell</option>
              <option value="prompt">Prompt em terminal</option>
            </select>
            {actionType === "prompt" && (
              <select value={targetNodeId} onChange={(e) => setTargetNodeId(e.target.value)} data-testid="routine-node-select">
                <option value="">Primeiro terminal do espaço</option>
                {terminals.map((t) => <option key={t.nodeId} value={t.nodeId}>{t.title}</option>)}
              </select>
            )}
          </div>
          <div className="row" style={{ gap: 8, marginBottom: 8 }}>
            <input
              placeholder={actionType === "prompt" ? "Prompt a enviar ao agente…" : "Comando shell a executar no cwd do espaço…"}
              value={payload}
              onChange={(e) => setPayload(e.target.value)}
              data-testid="routine-payload-input"
              style={{ flex: 1 }}
            />
          </div>
          <div className="row" style={{ gap: 8 }}>
            <select value={scheduleType} onChange={(e) => setScheduleType(e.target.value as RoutineScheduleType)} data-testid="routine-schedule-select">
              <option value="interval">Recorrente (a cada N seg)</option>
              <option value="once">Uma vez (após N seg)</option>
            </select>
            <input
              type="number"
              min={1}
              max={604800}
              value={intervalSeconds}
              onChange={(e) => setIntervalSeconds(Math.max(1, Number(e.target.value) || 60))}
              data-testid="routine-interval-input"
              style={{ width: 90 }}
            />
            <span className="mut" style={{ fontSize: 12 }}>seg</span>
            {actionType === "prompt" && (
              <label className="row" style={{ fontSize: 12, gap: 4 }}>
                <input type="checkbox" checked={wakeIfUnloaded} onChange={(e) => setWakeIfUnloaded(e.target.checked)} data-testid="routine-wake-checkbox" />
                Acordar se descarregado
              </label>
            )}
            <span className="sp" />
            <button className="pri" data-testid="routine-create-btn" disabled={!name.trim() || !payload.trim()} onClick={() => void create()}>
              <Plus size={14} /> Criar rotina
            </button>
          </div>
        </div>

        {msg && <div className="pf-status" data-testid="routine-status-msg" style={{ marginBottom: 8 }}>{msg}</div>}

        <div data-testid="routines-list" style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 280, overflowY: "auto" }}>
          {routines.length === 0 && <div className="mut">Nenhuma rotina cadastrada neste espaço.</div>}
          {routines.map((r) => (
            <div key={r.routineId} className="row card" data-testid="routine-row" style={{ padding: "8px 10px", gap: 8 }}>
              <div style={{ flex: 1 }}>
                <div>
                  <b>{r.name}</b>{" "}
                  <span className="mut" style={{ fontSize: 11 }}>
                    ({r.actionType === "prompt" ? "prompt" : "comando"} · {r.scheduleType === "once" ? "1x" : `a cada ${r.intervalSeconds}s`} · execuções: <span data-testid="routine-run-count">{r.runCount}</span>)
                  </span>
                </div>
                <div className="mono mut" style={{ fontSize: 11 }}>{r.payload}</div>
                {r.lastOutput && <div className="mut" data-testid="routine-last-output" style={{ fontSize: 11 }}>Última saída ({r.lastStatus}): {r.lastOutput}</div>}
              </div>
              <button className="tb" data-testid="routine-toggle-btn" onClick={() => void toggle(r)}>
                {r.enabled ? "Ativa" : "Pausada"}
              </button>
              <button className="tb" title="Executar agora" data-testid="routine-run-btn" onClick={() => void runNow(r)}>
                <Play size={13} />
              </button>
              <button className="tb danger" title="Remover rotina" data-testid="routine-delete-btn" onClick={() => void remove(r)}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
