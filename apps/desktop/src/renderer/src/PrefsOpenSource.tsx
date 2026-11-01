import { useMemo, useState } from "react";
import { Copy, ExternalLink, Search } from "lucide-react";
import { THIRD_PARTY } from "./generated/third-party.js";
import { REPO_URL } from "./PrefsAbout.js";

/** #60 — Preferências → Código aberto: licença do projeto (Apache-2.0) e avisos de terceiros gerados automaticamente. */
const LICENSE_SUMMARY = "Você pode usar, estudar, modificar e redistribuir o MessAI, inclusive comercialmente, mantendo os avisos de copyright e a licença; contribuições vêm com concessão de patente. Não há trial, ativação nem telemetria.";
export function PrefsOpenSource() {
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState("");
  const term = q.trim().toLowerCase();
  const pkgs = useMemo(() => THIRD_PARTY.packages.filter((p) => !term || `${p.name} ${p.license} ${p.via.join(" ")}`.toLowerCase().includes(term)), [term]);
  const byLicense = useMemo(() => { const m = new Map<string, number>(); for (const p of THIRD_PARTY.packages) m.set(p.license, (m.get(p.license) ?? 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1]); }, []);
  const open = (url: string) => { if (url) void window.messai.openExternal?.(url); };
  const copyNotices = () => {
    const text = ["# Avisos de terceiros — MessAI", "", ...THIRD_PARTY.packages.map((p) => `${p.name}@${p.version} — ${p.license} — ${p.repository}`), "", ...THIRD_PARTY.system.map((s) => `${s.name} — ${s.license} — ${s.note}`)].join("\n");
    void navigator.clipboard.writeText(text).then(() => setMsg("copiado")).catch(() => setMsg("não foi possível copiar")); setTimeout(() => setMsg(""), 2000);
  };
  return (<>
    <section className="pf-section">
      <h3>Licença do projeto</h3>
      <div className="pf-field"><div className="pf-lbl"><span>MessAI é software livre — <b>Apache-2.0</b></span><small>{LICENSE_SUMMARY}</small></div>
        <div className="pf-ctl"><button onClick={() => open(`${REPO_URL}/blob/main/LICENSE`)}><ExternalLink size={14} /> Texto da licença</button><button onClick={() => open(REPO_URL)}><ExternalLink size={14} /> Código-fonte</button></div></div>
    </section>
    <section className="pf-section">
      <h3>Avisos de terceiros</h3>
      <div className="mut hint">Dependências de produção (transitivas) de todos os pacotes do monorepo, <b>geradas automaticamente</b> a partir dos <code>package.json</code> instalados (<code>npm run licenses</code>; o CI falha se a lista ficar desatualizada). {THIRD_PARTY.packages.length} pacotes em {THIRD_PARTY.generatedAt}.</div>
      <div className="os-counts" data-testid="os-counts">{byLicense.map(([l, n]) => <span key={l} className={`pa-chip ${l === "desconhecida" ? "none" : ""}`} title={l}>{l}: {n}</span>)}</div>
      <div className="row ks-top">
        <label className="roles-search"><Search size={13} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar pacote, licença ou quem depende…" data-testid="os-search" /></label>
        <button onClick={copyNotices}><Copy size={14} /> Copiar avisos</button><span className="mut">{msg}</span>
      </div>
      <div className="os-table" data-testid="os-table">
        {pkgs.map((p) => (
          <div key={`${p.name}@${p.version}`} className="os-row" data-testid="os-row">
            <span className="os-name"><b>{p.name}</b> <span className="mut">{p.version}</span><small className="mut">via {p.via.join(", ")}</small></span>
            <span className={`pa-chip ${p.license === "desconhecida" ? "none" : ""}`} title={p.license === "desconhecida" ? "O package.json não declara licença; confira no repositório." : ""}>{p.license}</span>
            <button className="tb" title={p.repository || "sem repositório declarado"} disabled={!p.repository} onClick={() => open(p.repository)}><ExternalLink size={13} /></button>
          </div>
        ))}
        {pkgs.length === 0 && <div className="mut">nenhum pacote casa com a busca</div>}
      </div>
    </section>
    <section className="pf-section">
      <h3>Componentes fora do npm</h3>
      {THIRD_PARTY.system.map((s) => (
        <div key={s.name} className="os-row" data-testid="os-system">
          <span className="os-name"><b>{s.name}</b><small className="mut">{s.note}</small></span>
          <span className="pa-chip">{s.license}</span>
          <button className="tb" title={s.repository} onClick={() => open(s.repository)}><ExternalLink size={13} /></button>
        </div>
      ))}
      {THIRD_PARTY.missing.length > 0 && <div className="err">Não resolvidos na geração: {THIRD_PARTY.missing.join(", ")}</div>}
    </section>
  </>);
}
