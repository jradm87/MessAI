import { useEffect, useState } from "react";
import { Bug, Copy, ExternalLink, FileDown, Scale } from "lucide-react";
import type { Api } from "./api.js";
import { Toggle } from "./Preferences.js";
import { setPref } from "./prefs.js";
import { buildReport, type AppInfo, type ReportOptions, type ReportParts } from "./diagnostics.js";

export const REPO_URL = "https://github.com/jradm87/MessAI";
export const ISSUES_URL = `${REPO_URL}/issues/new`;
export const CONTACT = "jradm87@gmail.com";

/** #63 — Preferências → Sobre: nome/versão/slogan, contato, reportar problema (relatório opcional), agradecimentos, onboarding. */
export function PrefsAbout({ api, appInfo }: { api: Api; appInfo: AppInfo | null }) {
  const [runtime, setRuntime] = useState<{ ok: boolean; buildVersion?: number; protocolVersion?: number } | null>(null);
  const [desc, setDesc] = useState("");
  const [opt, setOpt] = useState<ReportOptions>({ runtime: true, providers: true, counts: true, log: false });
  const [report, setReport] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  useEffect(() => { api.health().then((h) => setRuntime({ ok: h.ok, buildVersion: h.buildVersion, protocolVersion: h.protocolVersion })).catch(() => setRuntime(null)); }, [api]);
  const say = (t: string) => { setMsg(t); setTimeout(() => setMsg(""), 2500); };
  const generate = async () => {
    if (!appInfo) return;
    const parts: ReportParts = { app: appInfo, runtime, description: desc };
    try {
      if (opt.providers) parts.providers = (await api.providers()).providers.map((p) => ({ id: p.id, path: p.path }));
      if (opt.counts) { const ws = await api.listWorkspaces(); let nodes = 0, terminals = 0; for (const w of ws) { const s = await api.snapshot(w.workspaceId); nodes += s.nodes.length; terminals += s.nodes.filter((n) => n.kind === "terminal").length; } parts.counts = { workspaces: ws.length, nodes, terminals }; }
      if (opt.log) parts.logTail = (await window.messai.runtimeLogTail?.(200)) ?? "";
    } catch (e) { say(`parte do relatório falhou: ${String(e).slice(0, 80)}`); }
    setReport(buildReport(parts, opt));
  };
  const copy = () => { if (report) void navigator.clipboard.writeText(report).then(() => say("copiado")).catch(() => say("não foi possível copiar")); };
  const save = () => { if (report) void window.messai.saveText?.(`messai-relatorio-${new Date().toISOString().slice(0, 10)}.md`, report).then((p) => say(p ? `salvo em ${p}` : "cancelado")); };
  const open = (url: string) => void window.messai.openExternal?.(url);
  return (<>
    <section className="pf-section about-head">
      <div className="about-logo">MessAI</div>
      <div className="mut">Many agents. One organized mess.</div>
      <div data-testid="about-version">versão <b>{appInfo?.version ?? "…"}</b> · build <b>{appInfo?.buildVersion ?? "…"}</b> · runtime {runtime ? `build ${runtime.buildVersion ?? "?"}` : "indisponível"} · {appInfo ? `${appInfo.packaged ? "empacotado" : "desenvolvimento"} · Electron ${appInfo.electron}` : ""}</div>
      <div className="row">
        <button onClick={() => open(REPO_URL)}><ExternalLink size={14} /> Repositório</button>
        <button onClick={() => open(`mailto:${CONTACT}?subject=MessAI`)} title={CONTACT}><ExternalLink size={14} /> Contato</button>
        <button onClick={() => setPref("prefsTab", "opensource")} data-testid="about-ack"><Scale size={14} /> Código aberto e agradecimentos</button>
      </div>
    </section>
    <section className="pf-section">
      <h3>Reportar problema</h3>
      <div className="mut hint">Gera um relatório em Markdown com dados de diagnóstico que você escolhe. Nada é enviado sozinho: copie ou salve e anexe na issue. Tokens e identidades nunca entram; o log é redigido.</div>
      <textarea className="role-instr about-desc" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="O que aconteceu? O que você esperava?" data-testid="about-desc" />
      <div className="about-opts">
        {([["runtime", "estado do runtime"], ["providers", "provedores encontrados"], ["counts", "tamanho do workspace (contagens)"], ["log", "últimas 200 linhas do runtime.log (redigido)"]] as const).map(([k, l]) => <label key={k} className="switch-row"><span>{l}</span><Toggle on={opt[k]} onChange={(v) => setOpt({ ...opt, [k]: v })} testId={`about-opt-${k}`} /></label>)}
      </div>
      <div className="row">
        <button className="pri" onClick={() => void generate()} disabled={!appInfo} data-testid="about-generate"><Bug size={14} /> Gerar relatório</button>
        <button onClick={copy} disabled={!report}><Copy size={14} /> Copiar</button>
        <button onClick={save} disabled={!report}><FileDown size={14} /> Salvar…</button>
        <button onClick={() => open(ISSUES_URL)}><ExternalLink size={14} /> Abrir issue no GitHub</button>
        <span className="mut">{msg}</span>
      </div>
      {report && <pre className="about-report" data-testid="about-report">{report}</pre>}
    </section>
    <section className="pf-section">
      <h3>Boas-vindas</h3>
      <div className="pf-field"><div className="pf-lbl"><span>Rever onboarding</span><small>O MessAI ainda não tem um passo-a-passo de boas-vindas; quando existir, ele reaparece por aqui.</small></div><div className="pf-ctl"><button disabled>Indisponível</button></div></div>
    </section>
  </>);
}
