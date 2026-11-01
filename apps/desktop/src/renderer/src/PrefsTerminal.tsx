import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import type { Preset, PresetInput, PresetTarget, TermTheme } from "@messai/contracts";
import type { Api } from "./api.js";
import { getPrefs, setPref, usePref } from "./prefs.js";
import { WS_COLORS, WS_ICONS, WsIcon } from "./wsicons.js";
import { AgentIcon, agentKind } from "./agentIcons.js";
import { Toggle } from "./Preferences.js";
import { cssVar } from "./theme.js";
import { clampFontSize, clampPad, clampScrollback, DEFAULT_CUSTOM, FONT_MAX, FONT_MIN, FONT_OPTIONS, fontStack, PAD_MAX, PALETTE_KEYS, parseCustomPalette, resolveTermTheme, SCROLLBACK_MAX, SCROLLBACK_MIN, type Palette } from "./term-theme.js";

/** #56 — Preferências → Terminal: Início rápido (presets editáveis), Aparência global do xterm e Avançado. */
const THEMES: { id: TermTheme; label: string }[] = [{ id: "system", label: "Sistema" }, { id: "dark", label: "Escuro" }, { id: "light", label: "Claro" }, { id: "custom", label: "Custom" }];
const systemPalette = (): Palette => ({ background: cssVar("--term-bg") || "#0a0a0b", foreground: cssVar("--term-fg") || "#e4e4e7", cursor: cssVar("--acc") || "#4a9eff", selectionBackground: cssVar("--term-sel") || "rgba(74,158,255,.35)" });
const hasHint = (p: PresetInput) => p.args.some((a) => a.includes("MessAI"));
/** Comando como texto editável; args com a dica do MessAI não aparecem (são mantidos ao salvar se o comando não mudar). */
const cmdText = (p: PresetInput) => (hasHint(p) ? p.command : [p.command, ...p.args].join(" "));
const newId = () => `preset-${Date.now().toString(36)}`;

/** Prévia do terminal com a paleta/fonte/padding escolhidos. */
export function TermPreview({ theme, font, size, padX, padY }: { theme: TermTheme | string; font?: string; size?: number; padX?: number; padY?: number }) {
  const custom = parseCustomPalette(getPrefs().termCustom);
  const p = resolveTermTheme(theme, getPrefs().termTheme, custom, systemPalette()) as Required<Palette>;
  const style = { background: p.background, color: p.foreground, fontFamily: fontStack(font ?? getPrefs().termFont), fontSize: size ?? getPrefs().termFontSize, padding: `${padY ?? getPrefs().termPadY}px ${padX ?? getPrefs().termPadX}px` };
  return (
    <pre className="term-preview" style={style} data-testid="term-preview">
      <span style={{ color: p.green ?? p.cursor }}>❯</span> ls -la <span style={{ color: p.blue ?? p.cursor }}>src/</span>{"\n"}
      <span style={{ color: p.yellow ?? p.foreground }}>index.ts</span>  <span style={{ color: p.red ?? p.foreground }}>erro.log</span>  README.md{"\n"}
      <span style={{ background: p.selectionBackground }}>texto selecionado</span> <span className="cur" style={{ background: p.cursor }}> </span>
    </pre>
  );
}

function PresetEditor({ initial, isNew, onSave, onCancel }: { initial: PresetInput; isNew: boolean; onSave: (p: PresetInput) => void; onCancel: () => void }) {
  const [p, setP] = useState<PresetInput>(initial);
  const [cmd, setCmd] = useState(cmdText(initial));
  const [tab, setTab] = useState<"details" | "appearance">("details");
  const up = (patch: Partial<PresetInput>) => setP((x) => ({ ...x, ...patch }));
  const save = () => {
    const parts = cmd.trim().split(/\s+/).filter(Boolean);
    if (!parts.length || !p.label.trim()) return;
    const keepArgs = hasHint(initial) && parts.length === 1 && parts[0] === initial.command; // comando intacto: mantém a dica
    onSave({ ...p, label: p.label.trim(), command: parts[0]!, args: keepArgs ? initial.args : parts.slice(1) });
  };
  return (
    <div className="pt-editor" data-testid="preset-editor">
      <div className="tabs">{(["details", "appearance"] as const).map((t) => <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t === "details" ? "Detalhes" : "Aparência"}</button>)}</div>
      {tab === "details" ? (
        <div className="form">
          <label>Nome <input value={p.label} onChange={(e) => up({ label: e.target.value })} data-testid="preset-label" autoFocus /></label>
          <label>Comando <input value={cmd} onChange={(e) => setCmd(e.target.value)} placeholder="ex.: claude --model opus" data-testid="preset-command" /></label>
          {hasHint(initial) && <div className="mut hint">Este preset injeta a dica do MessAI para o agente (argumentos ocultos). Mantendo o comando igual, ela continua.</div>}
          <label className="switch-row"><span>Maestro <small className="mut">— guardado para o modo Maestro (#29); ainda sem efeito</small></span><Toggle on={p.maestro} onChange={(v) => up({ maestro: v })} /></label>
        </div>
      ) : (
        <div className="form">
          <div className="lbl">Ícone <span className="mut">(vazio = ícone do agente pelo comando)</span></div>
          <div className="icon-grid">
            <button type="button" className={`ig ${p.icon === "" ? "on" : ""}`} title="automático" onClick={() => up({ icon: "" })}><AgentIcon id={agentKind(cmd)} size={18} /></button>
            {Object.entries(WS_ICONS).map(([k, I]) => <button key={k} type="button" className={`ig ${p.icon === k ? "on" : ""}`} title={k} onClick={() => up({ icon: k })}><I size={18} /></button>)}
          </div>
          <div className="lbl">Cor</div>
          <div className="color-row">
            <button type="button" className={`sw lg ${p.color === "" ? "on" : ""}`} style={{ background: "var(--surface-2)" }} title="sem cor" onClick={() => up({ color: "" })} />
            {WS_COLORS.map((c) => <button key={c} type="button" className={`sw lg ${p.color === c ? "on" : ""}`} style={{ background: c }} title={c} onClick={() => up({ color: c })} />)}
          </div>
          <div className="lbl">Abrir como</div>
          <div className="seg">{(["terminal", "chat"] as PresetTarget[]).map((t) => <button key={t} className={p.target === t ? "on" : ""} onClick={() => up({ target: t })}>{t === "terminal" ? "Terminal" : "Terminal + chat"}</button>)}</div>
          <div className="lbl">Tema do terminal</div>
          <div className="seg" data-testid="preset-theme">{THEMES.map((t) => <button key={t.id} className={p.theme === t.id ? "on" : ""} onClick={() => up({ theme: t.id })}>{t.label}</button>)}</div>
          <TermPreview theme={p.theme} />
        </div>
      )}
      <div className="actions"><button onClick={onCancel}>Cancelar</button><button className="pri" onClick={save} data-testid="preset-save" disabled={!p.label.trim() || !cmd.trim()}>{isNew ? "Adicionar" : "Salvar"}</button></div>
    </div>
  );
}

export function PrefsTerminal({ api, onPresetsChanged }: { api: Api; onPresetsChanged: () => void }) {
  const [presets, setPresets] = useState<Preset[] | null>(null);
  const [err, setErr] = useState("");
  const [edit, setEdit] = useState<{ p: PresetInput; isNew: boolean; index: number } | null>(null);
  useEffect(() => { api.presets().then(setPresets).catch((e) => setErr(String(e))); }, [api]);
  const strip = (p: Preset): PresetInput => { const { available: _a, builtin: _b, ...rest } = p; return rest; };
  const save = (list: PresetInput[]) => api.putPresets(list).then((r) => { setPresets(r); setErr(""); onPresetsChanged(); }).catch((e) => setErr(String(e)));
  const list = presets ?? [];
  const move = (i: number, d: -1 | 1) => { const j = i + d; if (j < 0 || j >= list.length) return; const n = list.map(strip); [n[i], n[j]] = [n[j]!, n[i]!]; void save(n); };
  const toggle = (i: number) => { const n = list.map(strip); n[i] = { ...n[i]!, enabled: !n[i]!.enabled }; void save(n); };
  const remove = (i: number) => { if (!confirm(`Excluir o preset "${list[i]!.label}"?`)) return; void save(list.map(strip).filter((_, k) => k !== i)); };
  const onSaveEdit = (p: PresetInput) => {
    const n = list.map(strip);
    if (edit!.isNew) { if (n.some((x) => x.id === p.id)) p = { ...p, id: newId() }; n.push(p); } else n[edit!.index] = p;
    setEdit(null); void save(n);
  };
  const reset = () => { if (!confirm("Restaurar os presets padrão? Os seus presets personalizados serão removidos.")) return; api.resetPresets().then((r) => { setPresets(r); onPresetsChanged(); }).catch((e) => setErr(String(e))); };

  // Aparência global + avançado (prefs de UI)
  const termTheme = usePref("termTheme"); const termCustom = usePref("termCustom"); const termFont = usePref("termFont"); const fontSize = usePref("termFontSize");
  const padX = usePref("termPadX"); const padY = usePref("termPadY"); const memLimit = usePref("termMemLimit"); const scrollback = usePref("termScrollback"); const copyOnSelect = usePref("termCopyOnSelect");
  const custom = useMemo(() => parseCustomPalette(termCustom), [termCustom]);
  const setCustom = (k: keyof Required<Palette>, v: string) => setPref("termCustom", JSON.stringify({ ...custom, [k]: v }));
  const fontAvail = (f: string) => { try { return document.fonts.check(`12px "${f}"`); } catch { return true; } };

  return (<>
    <section className="pf-section">
      <h3>Início rápido</h3>
      <div className="mut hint">Até 10 presets ativos aparecem ao criar um terminal. Reordene, ative/desative, edite ou exclua; "Restaurar padrões" volta à lista original.</div>
      {err && <div className="err">{err}</div>}
      <div className="pt-list" data-testid="preset-list">
        {presets === null && !err && <div className="mut">carregando…</div>}
        {list.map((p, i) => (
          <div key={p.id} className={`pt-row ${p.enabled ? "" : "off"}`} data-testid="preset-row">
            <span className="pt-ic" style={p.color ? { color: p.color } : undefined}>{p.icon ? <WsIcon icon={p.icon} color={p.color || "var(--fg)"} size={16} /> : <AgentIcon id={agentKind(p.command)} size={16} />}</span>
            <span className="pt-name" title={[p.command, ...p.args.filter((a) => !a.includes("MessAI"))].join(" ")}>{p.label}<small>{p.command}{p.available ? "" : " · não encontrado no PATH"}{p.builtin ? "" : " · seu"}</small></span>
            <Toggle on={p.enabled} onChange={() => toggle(i)} testId={`preset-enabled-${p.id}`} />
            <button className="tb" title="Subir" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={14} /></button>
            <button className="tb" title="Descer" disabled={i === list.length - 1} onClick={() => move(i, 1)}><ArrowDown size={14} /></button>
            <button className="tb" title="Editar" data-testid={`preset-edit-${p.id}`} onClick={() => setEdit({ p: strip(p), isNew: false, index: i })}><Pencil size={14} /></button>
            <button className="tb danger" title="Excluir" onClick={() => remove(i)}><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
      <div className="row">
        <button onClick={() => setEdit({ p: { id: newId(), label: "", command: "", args: [], enabled: true, icon: "", color: "", maestro: false, target: "terminal", theme: "system" }, isNew: true, index: -1 })} data-testid="preset-add"><Plus size={14} /> Adicionar preset</button>
        <button onClick={reset} data-testid="preset-reset"><RotateCcw size={14} /> Restaurar padrões</button>
      </div>
      {edit && <PresetEditor key={edit.p.id} initial={edit.p} isNew={edit.isNew} onSave={onSaveEdit} onCancel={() => setEdit(null)} />}
    </section>

    <section className="pf-section">
      <h3>Aparência</h3>
      <div className="pf-field"><div className="pf-lbl"><span>Tema</span><small>Vale para todos os terminais; um preset/terminal com tema próprio vence.</small></div>
        <div className="pf-ctl"><div className="seg" data-testid="term-theme">{THEMES.map((t) => <button key={t.id} className={termTheme === t.id ? "on" : ""} data-testid={`term-theme-${t.id}`} onClick={() => setPref("termTheme", t.id)}>{t.label}</button>)}</div></div></div>
      {termTheme === "custom" && (
        <div className="pt-palette" data-testid="term-palette">
          {PALETTE_KEYS.map((k) => <label key={k} className="pt-color"><input type="color" value={/^#[0-9a-f]{6}$/i.test(custom[k]) ? custom[k] : "#000000"} onChange={(e) => setCustom(k, e.target.value)} /><span>{k}</span></label>)}
          <button onClick={() => setPref("termCustom", JSON.stringify(DEFAULT_CUSTOM))}>Paleta padrão</button>
        </div>
      )}
      <TermPreview theme={termTheme} font={termFont} size={fontSize} padX={padX} padY={padY} />
      <div className="pf-field"><div className="pf-lbl"><span>Fonte</span><small>Família na frente da pilha padrão (com fallback). Marcadas com ✓ as instaladas.</small></div>
        <div className="pf-ctl">
          <select value={termFont} onChange={(e) => setPref("termFont", e.target.value)} data-testid="term-font">
            <option value="">Padrão</option>
            {FONT_OPTIONS.map((f) => <option key={f} value={f}>{f}{fontAvail(f) ? " ✓" : ""}</option>)}
          </select>
          <button className="tb" title="Diminuir" onClick={() => setPref("termFontSize", clampFontSize(fontSize - 1))} disabled={fontSize <= FONT_MIN}>−</button>
          <span className="pt-num" data-testid="term-font-size">{fontSize}px</span>
          <button className="tb" title="Aumentar" data-testid="term-font-plus" onClick={() => setPref("termFontSize", clampFontSize(fontSize + 1))} disabled={fontSize >= FONT_MAX}>+</button>
        </div></div>
      <div className="pf-field"><div className="pf-lbl"><span>Padding</span><small>Espaço interno do terminal (horizontal × vertical).</small></div>
        <div className="pf-ctl">
          <button className="tb" onClick={() => setPref("termPadX", clampPad(padX - 2))} disabled={padX <= 0}>−</button><span className="pt-num" data-testid="term-pad-x">{padX}px</span><button className="tb" data-testid="term-pad-x-plus" onClick={() => setPref("termPadX", clampPad(padX + 2))} disabled={padX >= PAD_MAX}>+</button>
          <span className="mut">×</span>
          <button className="tb" onClick={() => setPref("termPadY", clampPad(padY - 2))} disabled={padY <= 0}>−</button><span className="pt-num" data-testid="term-pad-y">{padY}px</span><button className="tb" onClick={() => setPref("termPadY", clampPad(padY + 2))} disabled={padY >= PAD_MAX}>+</button>
        </div></div>
    </section>

    <section className="pf-section">
      <h3>Avançado</h3>
      <div className="pf-field"><div className="pf-lbl"><span>Limitar memória por terminal</span><small>Mantém só as últimas N linhas de histórico (scrollback). Desligado, guarda até 100 mil linhas.</small></div>
        <div className="pf-ctl">
          {memLimit && <><input type="number" className="pt-input" min={SCROLLBACK_MIN} max={SCROLLBACK_MAX} step={500} value={scrollback} onChange={(e) => setPref("termScrollback", clampScrollback(Number(e.target.value)))} data-testid="term-scrollback" /><span className="mut">linhas</span></>}
          <Toggle on={memLimit} onChange={(v) => setPref("termMemLimit", v)} testId="term-memlimit" />
        </div></div>
      <div className="pf-field"><div className="pf-lbl"><span>Copiar texto ao selecionar</span><small>Selecionar no terminal já copia para a área de transferência.</small></div>
        <div className="pf-ctl"><Toggle on={copyOnSelect} onChange={(v) => setPref("termCopyOnSelect", v)} testId="term-copy" /></div></div>
    </section>
  </>);
}
