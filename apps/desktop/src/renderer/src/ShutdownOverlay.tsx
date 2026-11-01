import { useEffect, useState } from "react";
import type { RunningEntry } from "./api.js";

/**
 * Tela de encerramento: ao fechar o app, o main intercepta e manda "mess:shutdown-prompt" com o que
 * está rodando. O usuário escolhe deixar em 2º plano (agentes seguem vivos), encerrar tudo, ou cancelar.
 * Se não há nada rodando, fecha sozinho em seguida.
 */
export function ShutdownOverlay() {
  const [running, setRunning] = useState<RunningEntry[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { window.messai.onShutdownPrompt?.((d) => setRunning(d.running)); }, []);

  const decide = (action: "background" | "all" | "cancel") => {
    if (action === "all") setBusy(true);
    if (action === "cancel") setRunning(null);
    void window.messai.shutdownDecision?.(action);
  };

  // Nada rodando: não trava o usuário, fecha em 2º plano logo.
  useEffect(() => { if (running && running.length === 0) { const t = setTimeout(() => decide("background"), 500); return () => clearTimeout(t); } }, [running]);
  // Esc = cancelar
  useEffect(() => {
    if (!running) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) { e.preventDefault(); decide("cancel"); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [running, busy]);

  if (!running) return null;
  const agents = running.filter((r) => r.isAgent).length;
  return (
    <div className="shutdown-ov" role="dialog" aria-modal="true">
      <div className="shutdown-box">
        <div className="sh-title">Encerrando MessAI</div>
        {running.length === 0 ? (
          <div className="sh-sub">Nada rodando. Fechando…</div>
        ) : (
          <>
            <div className="sh-sub">{running.length} terminal{running.length > 1 ? "is" : ""} rodando{agents ? ` · ${agents} agente${agents > 1 ? "s" : ""}` : ""}</div>
            <ul className="sh-list">
              {running.map((r, i) => (
                <li key={i}><span className="sh-ic">{r.isAgent ? "🤖" : "›"}</span>{r.title}{r.agentType && r.agentType !== "genericShell" ? <span className="sh-tag">{r.agentType}</span> : null}{r.workspace ? <span className="sh-ws">{r.workspace}</span> : null}</li>
              ))}
            </ul>
            <div className="sh-row">
              <button className="sh-pri" disabled={busy} onClick={() => decide("background")} autoFocus>Deixar em 2º plano</button>
              <button className="sh-danger" disabled={busy} onClick={() => decide("all")}>{busy ? "Encerrando…" : "Encerrar tudo"}</button>
              <button disabled={busy} onClick={() => decide("cancel")}>Cancelar</button>
            </div>
            <div className="sh-hint">Em 2º plano o runtime e os agentes seguem vivos — você retoma ao reabrir. "Encerrar tudo" fecha o runtime e mata os agentes.</div>
          </>
        )}
      </div>
    </div>
  );
}
