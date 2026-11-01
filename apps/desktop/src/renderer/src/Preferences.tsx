import { useEffect, useState, type ComponentType } from "react";
import { Bot, Database, Download, Info, Keyboard, Monitor, Moon, Radio, Scale, Sliders, Sun, Terminal, X } from "lucide-react";
import { getThemePref, onTheme, setThemePref, THEME_LABEL, type ThemePref } from "./theme.js";
import { setPref, usePref } from "./prefs.js";
import type { Api, UiPrefsState } from "./api.js";
import { PrefsTerminal } from "./PrefsTerminal.js";

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

export function Toggle({ on, onChange, testId, disabled }: { on: boolean; onChange: (v: boolean) => void; testId?: string; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={on} disabled={disabled} className={`switch ${on ? "on" : ""}`} data-testid={testId} onClick={() => onChange(!on)}><span className="knob" /></button>;
}
function Section({ title, children }: { title: string; children: React.ReactNode }) { return <section className="pf-section"><h3>{title}</h3>{children}</section>; }
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <div className="pf-field"><div className="pf-lbl"><span>{label}</span>{hint && <small>{hint}</small>}</div><div className="pf-ctl">{children}</div></div>;
}
function Soon({ issue, what }: { issue: number; what: string }) {
  return <div className="pf-soon" data-testid="prefs-soon">Esta aba ainda não foi construída — {what}. Acompanhe a issue <b>#{issue}</b> do MessAI.</div>;
}

const POWER: { id: string; label: string }[] = [{ id: "never", label: "Nunca" }, { id: "agents", label: "Enquanto agentes trabalham" }, { id: "always", label: "Sempre" }];

/** #55 — Geral: sistema, energia e saída do app. */
function GeneralTab({ api }: { api: Api }) {
  const webCursor = usePref("webCursor"); const powerMode = usePref("powerMode"); const confirmExit = usePref("confirmExit"); const closeToTray = usePref("closeToTray");
  const [main, setMain] = useState<UiPrefsState | null>(null); // estado real no processo principal (inibidor ativo?)
  const [restore, setRestore] = useState<boolean | null | "erro">(null); // config do runtime
  useEffect(() => {
    const load = () => window.messai.uiPrefsState?.().then(setMain).catch(() => {});
    void load(); const t = setInterval(() => void load(), 3000); return () => clearInterval(t);
  }, [powerMode]);
  useEffect(() => { api.settings().then((s) => setRestore(s.restoreSessions)).catch(() => setRestore("erro")); }, [api]);
  const setRestoreSessions = (v: boolean) => { setRestore(v); api.patchSettings({ restoreSessions: v }).then((s) => setRestore(s.restoreSessions)).catch(() => setRestore("erro")); };
  return (<>
    <Section title="Sistema">
      <Field label="Idioma" hint="A tradução da interface chega com a issue #51; até lá o app é em pt-BR.">
        <select disabled value="system" data-testid="pref-language" onChange={() => {}}><option value="system">Padrão do sistema</option></select>
      </Field>
      <Field label="Tema" hint="Sistema segue o modo claro/escuro do SO."><ThemePicker /></Field>
      <Field label="Cursor estilo web ao passar o mouse" hint="Mão em botões e menus; desligado usa a seta nativa."><Toggle on={webCursor} onChange={(v) => setPref("webCursor", v)} testId="pref-cursor" /></Field>
    </Section>
    <Section title="Energia">
      <Field label="Evitar suspensão" hint="Impede o sistema de dormir para os agentes seguirem rodando; a tela pode apagar normalmente.">
        <div className="seg" role="radiogroup" data-testid="pref-power">
          {POWER.map((o) => <button key={o.id} role="radio" aria-checked={powerMode === o.id} className={powerMode === o.id ? "on" : ""} data-testid={`power-${o.id}`} onClick={() => setPref("powerMode", o.id)}>{o.label}</button>)}
        </div>
      </Field>
      <div className="pf-status" data-testid="power-status">{main ? (main.powerBlocking ? "Inibidor de suspensão ativo agora." : "Inibidor de suspensão inativo.") : ""}</div>
    </Section>
    <Section title="Saída do app">
      <Field label="Pedir confirmação ao sair" hint="Mostra a tela de encerramento ao fechar a janela (evita parar agentes sem querer). Desligado: fecha e deixa tudo rodando."><Toggle on={confirmExit} onChange={(v) => setPref("confirmExit", v)} testId="pref-confirm-exit" /></Field>
      <Field label="Tentar restaurar sessões de agentes" hint={restore === "erro" ? "Runtime indisponível — não foi possível ler a configuração." : "Após reboot, re-abre os terminais persistentes e retoma a conversa do agente (ADR-0010). Configuração do runtime."}>
        <Toggle on={restore === true} disabled={restore === null || restore === "erro"} onChange={setRestoreSessions} testId="pref-restore" />
      </Field>
      <Field label="Fechar para a bandeja" hint="Fechar a janela esconde o app num ícone na bandeja; runtime e agentes continuam."><Toggle on={closeToTray} onChange={(v) => setPref("closeToTray", v)} testId="pref-tray" /></Field>
    </Section>
    <div className="pf-soon">Canvas, Notificações, Environments e Git são subseções com issues próprias (#85 notificações, #72 ambientes) e entram quando elas forem feitas.</div>
  </>);
}

export function Preferences({ api, onClose, onPresetsChanged }: { api: Api; onClose: () => void; onPresetsChanged?: () => void }) {
  const saved = usePref("prefsTab");
  const tab: PrefTabId = isTab(saved) ? saved : "general";
  const pick = (id: PrefTabId) => setPref("prefsTab", id);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }; window.addEventListener("keydown", k, true); return () => window.removeEventListener("keydown", k, true); }, [onClose]);
  const cur = PREF_TABS.find((t) => t.id === tab)!;
  const body = tab === "general" ? <GeneralTab api={api} />
    : tab === "terminal" ? <PrefsTerminal api={api} onPresetsChanged={onPresetsChanged ?? (() => {})} />
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
