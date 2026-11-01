import { useEffect, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import type { UpdateState } from "./api.js";
import { Toggle } from "./Preferences.js";
import { setPref, usePref } from "./prefs.js";

/** #61 — Preferências → Atualizações: versão atual, verificar automaticamente, verificar agora, estado do download/instalação. */
const STATUS_TEXT: Record<UpdateState["status"], string> = {
  unsupported: "Atualização automática só existe no app empacotado (AppImage/.deb). Em desenvolvimento, atualize pelo repositório.",
  idle: "Nenhuma verificação ainda nesta sessão.",
  checking: "Verificando…",
  available: "Atualização encontrada — baixando.",
  "not-available": "Você está na versão mais recente.",
  downloading: "Baixando…",
  downloaded: "Atualização baixada. Reinicie para instalar.",
  error: "Não foi possível verificar.",
};
export function PrefsUpdates({ appVersion, buildVersion }: { appVersion: string; buildVersion: number }) {
  const auto = usePref("updateAuto");
  const [st, setSt] = useState<UpdateState | null>(null);
  useEffect(() => {
    void window.messai.updateState?.().then(setSt);
    return window.messai.onUpdateState?.(setSt);
  }, []);
  const check = () => { void window.messai.updateCheck?.().then(setSt); };
  const busy = st?.status === "checking" || st?.status === "downloading";
  return (<>
    <section className="pf-section">
      <h3>Versão</h3>
      <div className="pf-field"><div className="pf-lbl"><span>MessAI {appVersion} <span className="mut">· build {buildVersion}</span></span><small data-testid="upd-status">{st ? STATUS_TEXT[st.status] : "…"}{st?.status === "error" && st.error ? ` ${st.error}` : ""}{st?.lastCheck ? ` (última verificação: ${new Date(st.lastCheck).toLocaleString()})` : ""}</small></div>
        <div className="pf-ctl">
          {st?.status === "downloaded" ? <button className="pri" onClick={() => void window.messai.updateInstall?.()} data-testid="upd-install"><Download size={14} /> Reiniciar e instalar {st.version}</button>
            : <button onClick={check} disabled={!st?.supported || busy} data-testid="upd-check" title={st?.supported ? "Consulta as releases do GitHub" : "Indisponível fora do app empacotado"}><RefreshCw size={14} /> Verificar agora</button>}
        </div></div>
      {st?.status === "downloading" && <div className="upd-bar" data-testid="upd-progress"><span style={{ width: `${st.percent ?? 0}%` }} /></div>}
    </section>
    <section className="pf-section">
      <h3>Automático</h3>
      <div className="pf-field"><div className="pf-lbl"><span>Verificar automaticamente</span><small>Ao abrir e a cada 6 horas, em segundo plano; baixa sozinho e avisa quando estiver pronto. Só vale no app empacotado.</small></div>
        <div className="pf-ctl"><Toggle on={auto} onChange={(v) => setPref("updateAuto", v)} testId="upd-auto" /></div></div>
      <div className="mut hint">As atualizações vêm das releases do GitHub (jradm87/MessAI). Uma release precisa publicar o manifesto <code>latest-linux.yml</code>; sem ele, a verificação diz que não há release — não é erro do app.</div>
    </section>
  </>);
}
