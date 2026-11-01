import { useEffect, useState, type ComponentType } from "react";
import { Bot, Database, Download, Info, Keyboard, Monitor, Moon, Radio, Scale, Sliders, Sun, Terminal, X } from "lucide-react";
import { getThemePref, onTheme, setThemePref, THEME_LABEL, type ThemePref } from "./theme.js";
import { setPref, usePref } from "./prefs.js";

/**
 * #64 — janela de Preferências em abas (engrenagem da barra lateral / Ctrl+,).
 * Cada aba é uma issue própria; as que ainda não existem dizem isso claramente em vez de fingir conteúdo.
 */
export type PrefTabId = "general" | "terminal" | "agents" | "shortcuts" | "remote" | "updates" | "data" | "opensource" | "about";
export const PREF_TABS: { id: PrefTabId; label: string; icon: ComponentType<{ size?: number }>; issue: number }[] = [
  { id: "general", label: "Geral", icon: Sliders, issue: 55 },
  { id: "terminal", label: "Terminal", icon: Terminal, issue: 56 },
  { id: "agents", label: "Agentes", icon: Bot, issue: 57 },
  { id: "shortcuts", label: "Atalhos", icon: Keyboard, issue: 58 },
  { id: "remote", label: "Controle remoto", icon: Radio, issue: 59 },
  { id: "updates", label: "Atualizações", icon: Download, issue: 61 },
  { id: "data", label: "Dados", icon: Database, issue: 62 },
  { id: "opensource", label: "Código aberto", icon: Scale, issue: 60 },
  { id: "about", label: "Sobre", icon: Info, issue: 63 },
];
const isTab = (v: string): v is PrefTabId => PREF_TABS.some((t) => t.id === v);

/** Seletor de tema (Sistema/Claro/Escuro) — a mesma preferência do botão da barra inferior (#54). */
export function ThemePicker() {
  const [pref, setP] = useState<ThemePref>(getThemePref());
  useEffect(() => onTheme((_t, p) => setP(p)), []);
  const opts: { id: ThemePref; icon: ComponentType<{ size?: number }> }[] = [{ id: "system", icon: Monitor }, { id: "light", icon: Sun }, { id: "dark", icon: Moon }];
  return (
    <div className="seg" role="radiogroup" aria-label="Tema" data-testid="theme-picker">
      {opts.map((o) => <button key={o.id} role="radio" aria-checked={pref === o.id} className={pref === o.id ? "on" : ""} data-testid={`theme-${o.id}`} onClick={() => setThemePref(o.id)}><o.icon size={14} /> {THEME_LABEL[o.id]}</button>)}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) { return <section className="pf-section"><h3>{title}</h3>{children}</section>; }
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <div className="pf-field"><div className="pf-lbl"><span>{label}</span>{hint && <small>{hint}</small>}</div><div className="pf-ctl">{children}</div></div>;
}
function Soon({ issue, what }: { issue: number; what: string }) {
  return <div className="pf-soon" data-testid="prefs-soon">Esta aba ainda não foi construída — {what}. Acompanhe a issue <b>#{issue}</b> do MessAI.</div>;
}

function GeneralTab() {
  return (<>
    <Section title="Aparência">
      <Field label="Tema" hint="Sistema segue o modo claro/escuro do SO."><ThemePicker /></Field>
    </Section>
    <Soon issue={55} what="idioma, cursor, energia (evitar suspensão) e saída do app chegam na aba Geral completa" />
  </>);
}

export function Preferences({ onClose }: { onClose: () => void }) {
  const saved = usePref("prefsTab");
  const tab: PrefTabId = isTab(saved) ? saved : "general";
  const pick = (id: PrefTabId) => setPref("prefsTab", id);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }; window.addEventListener("keydown", k, true); return () => window.removeEventListener("keydown", k, true); }, [onClose]);
  const cur = PREF_TABS.find((t) => t.id === tab)!;
  const body = tab === "general" ? <GeneralTab />
    : tab === "terminal" ? <Soon issue={56} what="presets de início rápido editáveis, aparência e avançado do terminal" />
    : tab === "agents" ? <Soon issue={57} what="papéis, skills, contas e uso dos agentes" />
    : tab === "shortcuts" ? <Soon issue={58} what="atalhos de teclado personalizáveis" />
    : tab === "remote" ? <Soon issue={59} what="controle remoto e pareamento (depende do hub #28)" />
    : tab === "updates" ? <Soon issue={61} what="canal e verificação de atualizações" />
    : tab === "data" ? <Soon issue={62} what="local dos dados, uso, backups e apagar" />
    : tab === "opensource" ? <Soon issue={60} what="avisos de terceiros e licenças" />
    : <Soon issue={63} what="versão, diagnóstico, reportar problema e créditos" />;
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal prefs-modal" data-testid="prefs" onMouseDown={(e) => e.stopPropagation()}>
        <div className="prefs-head"><h2 className="left">Preferências</h2><span className="sp" /><button className="tb" title="Fechar (Esc)" data-testid="prefs-close" onClick={onClose}><X size={15} /></button></div>
        <div className="prefs-body">
          <nav className="prefs-nav" aria-label="Abas das preferências">
            {PREF_TABS.map((t) => <div key={t.id} className={`mi ${t.id === tab ? "on" : ""}`} role="tab" aria-selected={t.id === tab} data-testid={`prefs-tab-${t.id}`} onClick={() => pick(t.id)}><t.icon size={15} /><span>{t.label}</span></div>)}
          </nav>
          <div className="prefs-pane" data-testid={`prefs-pane-${cur.id}`}>
            <h4 className="prefs-title">{cur.label}</h4>
            {body}
          </div>
        </div>
      </div>
    </div>
  );
}
