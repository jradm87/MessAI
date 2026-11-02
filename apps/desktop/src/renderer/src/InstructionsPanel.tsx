import { useEffect, useState } from "react";
import { ArrowLeftRight, Check, FileText, RefreshCw, Save } from "lucide-react";
import type { InstructionsStatus } from "@messai/contracts";
import type { Api } from "./api.js";

const STATUS_LABEL: Record<InstructionsStatus["status"], string> = {
  missing: "Nenhum arquivo na raiz do espaço",
  "only-claude": "Só CLAUDE.md existe",
  "only-agents": "Só AGENTS.md existe",
  synced: "Sincronizados (CLAUDE.md = AGENTS.md)",
  diverged: "Divergentes (CLAUDE.md ≠ AGENTS.md)",
};

/** #76 — Painel de arquivos de instrução do projeto (CLAUDE.md e AGENTS.md) na raiz do espaço. */
export function InstructionsPanel({ api, workspaceId, workspaceCwd }: { api: Api; workspaceId?: string; workspaceCwd?: string }) {
  const [data, setData] = useState<InstructionsStatus | null>(null);
  const [tab, setTab] = useState<"CLAUDE.md" | "AGENTS.md">("CLAUDE.md");
  const [text, setText] = useState("");
  const [msg, setMsg] = useState("");
  const say = (t: string) => { setMsg(t); setTimeout(() => setMsg(""), 3000); };
  const load = async (keepTab = tab) => {
    if (!workspaceId) return;
    try {
      const r = await api.instructions(workspaceId);
      setData(r);
      setText(keepTab === "CLAUDE.md" ? r.claude.text : r.agents.text);
    } catch (e) { say(String(e)); }
  };
  useEffect(() => { void load(tab); }, [workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!workspaceId) return <div className="mut">Nenhum espaço selecionado.</div>;
  const pickTab = (t: "CLAUDE.md" | "AGENTS.md") => {
    setTab(t);
    if (data) setText(t === "CLAUDE.md" ? data.claude.text : data.agents.text);
  };
  const save = async (target: "CLAUDE.md" | "AGENTS.md" | "both") => {
    try {
      const r = await api.putInstructions(workspaceId, { target, text });
      setData(r);
      say(target === "both" ? "salvo em CLAUDE.md e AGENTS.md" : `salvo em ${target}`);
    } catch (e) { say(String(e)); }
  };
  const sync = async (direction: "claude-to-agents" | "agents-to-claude") => {
    try {
      const r = await api.syncInstructions(workspaceId, { direction });
      setData(r);
      setText(tab === "CLAUDE.md" ? r.claude.text : r.agents.text);
      say("sincronizado");
    } catch (e) { say(String(e)); }
  };
  return (
    <div className="instr-panel" data-testid="instructions-panel">
      <div className="row">
        <span className={`pa-chip ${data?.status === "synced" ? "logged" : data?.status === "diverged" ? "warn" : ""}`} data-testid="instr-status">
          {data ? STATUS_LABEL[data.status] : "carregando…"}
        </span>
        {workspaceCwd && <small className="mut mono">{workspaceCwd}</small>}
        <span className="sp" />
        <button className="tb" title="Recarregar do disco" onClick={() => void load(tab)}><RefreshCw size={14} /></button>
      </div>
      <div className="row instr-bar">
        <div className="seg">
          {(["CLAUDE.md", "AGENTS.md"] as const).map((f) => {
            const exists = f === "CLAUDE.md" ? data?.claude.exists : data?.agents.exists;
            return (
              <button key={f} type="button" className={tab === f ? "on" : ""} data-testid={`instr-tab-${f}`} onClick={() => pickTab(f)}>
                <FileText size={13} /> {f} {exists ? <Check size={11} /> : <small className="mut">(ausente)</small>}
              </button>
            );
          })}
        </div>
        <span className="sp" />
        {data && (data.status === "diverged" || data.status === "only-claude" || data.status === "only-agents") && (
          <div className="row">
            {data.claude.exists && <button type="button" onClick={() => void sync("claude-to-agents")} data-testid="instr-sync-c2a" title="Copia CLAUDE.md para AGENTS.md"><ArrowLeftRight size={13} /> CLAUDE → AGENTS</button>}
            {data.agents.exists && <button type="button" onClick={() => void sync("agents-to-claude")} data-testid="instr-sync-a2c" title="Copia AGENTS.md para CLAUDE.md"><ArrowLeftRight size={13} /> AGENTS → CLAUDE</button>}
          </div>
        )}
      </div>
      <textarea className="role-instr instr-editor" value={text} onChange={(e) => setText(e.target.value)} placeholder={`Instruções em ${tab} na raiz do projeto…`} data-testid="instr-editor" />
      <div className="actions left">
        <button type="button" className="pri" onClick={() => void save(tab)} data-testid="instr-save"><Save size={14} /> Salvar {tab}</button>
        <button type="button" onClick={() => void save("both")} data-testid="instr-save-both"><ArrowLeftRight size={14} /> Salvar em ambos (sincronizar)</button>
        {msg && <span className="mut" data-testid="instr-msg">{msg}</span>}
      </div>
    </div>
  );
}
