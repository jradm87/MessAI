import { useEffect, useState, type ComponentType } from "react";
import { Bot, Database, Download, Eye, EyeOff, Info, Keyboard, Lock, Monitor, Moon, Plus, Radio, Scale, Sliders, Sun, Terminal, Trash2, Unlock, X } from "lucide-react";
import { getThemePref, onTheme, setThemePref, THEME_LABEL, type ThemePref } from "./theme.js";
import { setPref, usePref } from "./prefs.js";
import type { Api, UiPrefsState } from "./api.js";
import type { EnvVarEntry, Workspace } from "@messai/contracts";
import { isLikelySecretKey, parseDotEnv } from "@messai/domain";
import { PrefsTerminal } from "./PrefsTerminal.js";
import { PrefsAgents, type OpenTerminal } from "./PrefsAgents.js";
import { PrefsShortcuts } from "./PrefsShortcuts.js";
import { PrefsUpdates } from "./PrefsUpdates.js";
import { PrefsAbout } from "./PrefsAbout.js";
import { PrefsOpenSource } from "./PrefsOpenSource.js";
import { PrefsData } from "./PrefsData.js";
import type { AppInfo } from "./diagnostics.js";

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

/** #72 — Editor de variáveis de ambiente (Global e por espaço) com mascaramento de segredos. */
function EnvironmentsEditor({ api, workspaceId }: { api: Api; workspaceId?: string | undefined }) {
  const [scope, setScope] = useState<string>("global");
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [vars, setVars] = useState<EnvVarEntry[]>([]);
  const [revealed, setRevealed] = useState<Record<number, boolean>>({});
  const [status, setStatus] = useState<string>("");
  const [err, setErr] = useState<string>("");
  const [pasteBox, setPasteBox] = useState(false);
  const [pasteRaw, setPasteRaw] = useState("");

  useEffect(() => {
    api.listWorkspaces().then(setWorkspaces).catch(() => {});
  }, [api]);

  useEffect(() => {
    setErr("");
    setStatus("");
    setRevealed({});
    const load = scope === "global" ? api.globalEnv() : api.workspaceEnv(scope);
    load.then(setVars).catch((e) => setErr(String(e instanceof Error ? e.message : e)));
  }, [api, scope]);

  const addVar = () => {
    setVars((cur) => [...cur, { key: "", value: "", secret: false }]);
    setStatus("");
  };

  const updateRow = (idx: number, patch: Partial<EnvVarEntry>) => {
    setVars((cur) =>
      cur.map((row, i) => {
        if (i !== idx) return row;
        const next = { ...row, ...patch };
        if (patch.key !== undefined && row.secret === undefined) {
          next.secret = isLikelySecretKey(patch.key);
        } else if (patch.key !== undefined && !row.key && isLikelySecretKey(patch.key)) {
          next.secret = true;
        }
        return next;
      }),
    );
    setStatus("");
  };

  const removeRow = (idx: number) => {
    setVars((cur) => cur.filter((_, i) => i !== idx));
    setStatus("");
  };

  const importDotEnv = () => {
    const parsed = parseDotEnv(pasteRaw);
    if (parsed.length > 0) {
      setVars((cur) => {
        const byKey = new Map<string, EnvVarEntry>();
        for (const r of cur) if (r.key.trim()) byKey.set(r.key.trim(), r);
        for (const p of parsed) byKey.set(p.key, p);
        return [...byKey.values()];
      });
    }
    setPasteRaw("");
    setPasteBox(false);
    setStatus("");
  };

  const save = async () => {
    setErr("");
    setStatus("");
    const cleaned = vars.filter((v) => v.key.trim().length > 0);
    try {
      const saved = scope === "global" ? await api.putGlobalEnv(cleaned) : await api.putWorkspaceEnv(scope, cleaned);
      setVars(saved);
      setStatus("Salvo — vale a partir do próximo terminal criado ou reiniciado.");
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    }
  };

  return (
    <Section title="Ambientes (Variáveis de ambiente)">
      <Field label="Escopo" hint="Variáveis globais valem em todos os espaços; variáveis do espaço sobrescrevem as globais.">
        <select value={scope} data-testid="env-scope" onChange={(e) => setScope(e.target.value)}>
          <option value="global">Global (todos os espaços)</option>
          {workspaces.map((w) => (
            <option key={w.workspaceId} value={w.workspaceId}>
              Espaço: {w.name}{w.workspaceId === workspaceId ? " (atual)" : ""}
            </option>
          ))}
        </select>
      </Field>
      <div className="pf-env-list" data-testid="env-list" style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
        {vars.length === 0 && (
          <div className="pf-status" data-testid="env-empty">
            Nenhuma variável configurada neste escopo.
          </div>
        )}
        {vars.map((row, idx) => {
          const isSecret = !!row.secret;
          const isShown = !!revealed[idx];
          return (
            <div key={idx} className="pf-env-row" data-testid={`env-row-${idx}`} style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="text"
                placeholder="NOME_DA_VARIAVEL"
                value={row.key}
                data-testid={`env-key-${idx}`}
                onChange={(e) => updateRow(idx, { key: e.target.value })}
                style={{ flex: "0 0 180px", fontFamily: "var(--mono)" }}
              />
              <input
                type={isSecret && !isShown ? "password" : "text"}
                placeholder="valor"
                value={row.value}
                data-testid={`env-val-${idx}`}
                onChange={(e) => updateRow(idx, { value: e.target.value })}
                style={{ flex: 1, fontFamily: "var(--mono)" }}
              />
              <button
                type="button"
                className={`tb ${isSecret ? "on" : ""}`}
                title={isSecret ? "Marcada como sensível (mascarada)" : "Marcar como sensível"}
                data-testid={`env-secret-${idx}`}
                onClick={() => updateRow(idx, { secret: !isSecret })}
              >
                {isSecret ? <Lock size={13} /> : <Unlock size={13} />}
              </button>
              {isSecret && (
                <button
                  type="button"
                  className="tb"
                  title={isShown ? "Ocultar valor" : "Mostrar valor"}
                  data-testid={`env-reveal-${idx}`}
                  onClick={() => setRevealed((r) => ({ ...r, [idx]: !isShown }))}
                >
                  {isShown ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              )}
              <button
                type="button"
                className="tb"
                title="Remover variável"
                data-testid={`env-del-${idx}`}
                onClick={() => removeRow(idx)}
              >
                <Trash2 size={13} />
              </button>
            </div>
          );
        })}
      </div>
      {pasteBox && (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          <textarea
            rows={4}
            placeholder={"API_KEY=segredo\nNODE_ENV=development"}
            value={pasteRaw}
            data-testid="env-paste-input"
            onChange={(e) => setPasteRaw(e.target.value)}
            style={{ fontFamily: "var(--mono)", fontSize: 12 }}
          />
          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" className="btn primary" data-testid="env-paste-apply" onClick={importDotEnv}>Importar linhas</button>
            <button type="button" className="btn" onClick={() => setPasteBox(false)}>Cancelar</button>
          </div>
        </div>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
        <button type="button" className="btn" data-testid="env-add" onClick={addVar}><Plus size={13} /> Variável</button>
        <button type="button" className="btn" data-testid="env-paste-toggle" onClick={() => setPasteBox((v) => !v)}>Colar .env</button>
        <button type="button" className="btn primary" data-testid="env-save" onClick={() => void save()}>Salvar ambiente</button>
        {status && <span className="pf-status" data-testid="env-status">{status}</span>}
        {err && <span className="pf-status" data-testid="env-error" style={{ color: "var(--danger, #ff6b6b)" }}>{err}</span>}
      </div>
    </Section>
  );
}

/** #55 — Geral: sistema, energia, ambientes (#72) e saída do app. */
function GeneralTab({ api, workspaceId }: { api: Api; workspaceId?: string | undefined }) {
  const webCursor = usePref("webCursor"); const powerMode = usePref("powerMode"); const confirmExit = usePref("confirmExit"); const closeToTray = usePref("closeToTray");
  const [main, setMain] = useState<UiPrefsState | null>(null); // estado real no processo principal (inibidor ativo?)
  const [restore, setRestore] = useState<boolean | null | "erro">(null); // config do runtime
  const [reloadOnSelect, setReloadOnSelectState] = useState<boolean>(true);
  const [autoUnloadMin, setAutoUnloadMin] = useState<number>(0);
  useEffect(() => {
    const load = () => window.messai.uiPrefsState?.().then(setMain).catch(() => {});
    void load(); const t = setInterval(() => void load(), 3000); return () => clearInterval(t);
  }, [powerMode]);
  useEffect(() => {
    api.settings().then((s) => {
      setRestore(s.restoreSessions);
      setReloadOnSelectState(s.reloadOnSelect ?? true);
      setAutoUnloadMin(s.autoUnloadMinutes ?? 0);
    }).catch(() => setRestore("erro"));
  }, [api]);
  const setRestoreSessions = (v: boolean) => { setRestore(v); api.patchSettings({ restoreSessions: v }).then((s) => setRestore(s.restoreSessions)).catch(() => setRestore("erro")); };
  const setReloadOnSelect = (v: boolean) => { setReloadOnSelectState(v); api.patchSettings({ reloadOnSelect: v }).then((s) => setReloadOnSelectState(s.reloadOnSelect ?? true)).catch(() => {}); };
  const setAutoUnload = (v: number) => { const n = Math.max(0, Math.round(v)); setAutoUnloadMin(n); api.patchSettings({ autoUnloadMinutes: n }).then((s) => setAutoUnloadMin(s.autoUnloadMinutes ?? 0)).catch(() => {}); };
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
      <Field label="Recarregar espaço automaticamente ao abrir" hint="Ao selecionar um espaço descarregado na barra lateral, religa seus terminais automaticamente.">
        <Toggle on={reloadOnSelect} onChange={setReloadOnSelect} testId="pref-reload-on-select" />
      </Field>
      <Field label="Descarregar espaços inativos após (min)" hint="0 = nunca descarregar automaticamente. Espaços sem atividade nos terminais são descarregados para poupar RAM.">
        <input type="number" min={0} max={1440} step={5} style={{ width: 80 }} value={autoUnloadMin} data-testid="pref-auto-unload" onChange={(e) => setAutoUnload(Number(e.target.value) || 0)} />
      </Field>
    </Section>
    <EnvironmentsEditor api={api} workspaceId={workspaceId} />
    <Section title="Saída do app">
      <Field label="Pedir confirmação ao sair" hint="Mostra a tela de encerramento ao fechar a janela (evita parar agentes sem querer). Desligado: fecha e deixa tudo rodando."><Toggle on={confirmExit} onChange={(v) => setPref("confirmExit", v)} testId="pref-confirm-exit" /></Field>
      <Field label="Tentar restaurar sessões de agentes" hint={restore === "erro" ? "Runtime indisponível — não foi possível ler a configuração." : "Após reboot, re-abre os terminais persistentes e retoma a conversa do agente (ADR-0010). Configuração do runtime."}>
        <Toggle on={restore === true} disabled={restore === null || restore === "erro"} onChange={setRestoreSessions} testId="pref-restore" />
      </Field>
      <Field label="Fechar para a bandeja" hint="Fechar a janela esconde o app num ícone na bandeja; runtime e agentes continuam."><Toggle on={closeToTray} onChange={(v) => setPref("closeToTray", v)} testId="pref-tray" /></Field>
    </Section>
    <div className="pf-soon">Canvas, Notificações e Git são subseções com issues próprias (#85 notificações) e entram quando elas forem feitas.</div>
  </>);
}

export type PreferencesProps = {
  api: Api; onClose: () => void; onPresetsChanged?: () => void;
  // #57 Agentes
  workspaceId?: string; workspaceCwd?: string; onRolesChanged?: () => void; onOpenTerminal?: OpenTerminal; onOpenUsage?: () => void;
};
export function Preferences({ api, onClose, onPresetsChanged, workspaceId, workspaceCwd, onRolesChanged, onOpenTerminal, onOpenUsage }: PreferencesProps) {
  const saved = usePref("prefsTab");
  const tab: PrefTabId = isTab(saved) ? saved : "general";
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null); // #61/#63
  useEffect(() => { void window.messai.appInfo?.().then(setAppInfo).catch(() => {}); }, []);
  const pick = (id: PrefTabId) => setPref("prefsTab", id);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }; window.addEventListener("keydown", k, true); return () => window.removeEventListener("keydown", k, true); }, [onClose]);
  const cur = PREF_TABS.find((t) => t.id === tab)!;
  const body = tab === "general" ? <GeneralTab api={api} workspaceId={workspaceId} />
    : tab === "terminal" ? <PrefsTerminal api={api} onPresetsChanged={onPresetsChanged ?? (() => {})} />
    : tab === "agents" ? <PrefsAgents api={api} {...(workspaceId ? { workspaceId } : {})} workspaceCwd={workspaceCwd ?? ""} onRolesChanged={onRolesChanged ?? (() => {})} onOpenTerminal={onOpenTerminal ?? (() => {})} onOpenUsage={onOpenUsage ?? (() => {})} />
    : tab === "shortcuts" ? <PrefsShortcuts />
    : tab === "remote" ? <Soon issue={59} what="controle remoto e pareamento (depende do hub #28)" />
    : tab === "updates" ? <PrefsUpdates appVersion={appInfo?.version ?? "…"} buildVersion={appInfo?.buildVersion ?? 0} />
    : tab === "data" ? <PrefsData api={api} />
    : tab === "opensource" ? <PrefsOpenSource />
    : <PrefsAbout api={api} appInfo={appInfo} />;
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
