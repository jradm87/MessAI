import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, RotateCcw, Search, X } from "lucide-react";
import { ACTIONS, ACTION_BY_ID, comboFromEvent, conflicts, effectiveCombo, formatCombo, GROUPS, isModifierKey, sameCombo, type Combo, type Keymap } from "./keymap.js";
import { setPref } from "./prefs.js";
import { useKeymap } from "./shortcuts.js";

/** #58 — Preferências → Atalhos: catálogo agrupado, remapear (capturar tecla), limpar, conflitos, restaurar padrões. */
export function PrefsShortcuts() {
  const keymap = useKeymap();
  const [q, setQ] = useState("");
  const [capturing, setCapturing] = useState<string | null>(null); // id em captura
  const conf = useMemo(() => conflicts(keymap), [keymap]);
  const write = (next: Keymap) => setPref("keymap", Object.keys(next).length ? JSON.stringify(next) : "");
  const setCombo = (id: string, c: Combo | null) => {
    const def = ACTION_BY_ID.get(id)!.combo;
    const next = { ...keymap };
    if (sameCombo(c, def) || (c === null && def === null)) delete next[id]; else next[id] = c; // igual ao padrão: não guarda override
    write(next);
  };
  const resetOne = (id: string) => { const next = { ...keymap }; delete next[id]; write(next); };
  // Captura: próxima tecla não-modificadora vira o atalho; Esc cancela (na fase de captura, antes do handler global do App).
  useEffect(() => {
    if (!capturing) return;
    const k = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation();
      if (e.key === "Escape") { setCapturing(null); return; }
      if (isModifierKey(e.key)) return;
      setCombo(capturing, comboFromEvent(e)); setCapturing(null);
    };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, [capturing, keymap]); // eslint-disable-line react-hooks/exhaustive-deps
  const term = q.trim().toLowerCase();
  const shown = ACTIONS.filter((a) => !term || `${a.label} ${a.group} ${formatCombo(effectiveCombo(a.id, keymap))}`.toLowerCase().includes(term));
  const overridden = Object.keys(keymap).length;
  return (<>
    <div className="row ks-top">
      <label className="roles-search"><Search size={13} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar ação ou atalho…" data-testid="ks-search" /></label>
      <button onClick={() => { if (overridden && confirm("Restaurar todos os atalhos padrão?")) write({}); }} disabled={!overridden} data-testid="ks-reset-all"><RotateCcw size={14} /> Restaurar padrões{overridden ? ` (${overridden})` : ""}</button>
    </div>
    <div className="mut hint">Clique no atalho para gravar outro; × limpa; ↺ volta ao padrão. Atalhos marcados ⌨ também valem com o foco num terminal/input.</div>
    {Object.keys(conf).length > 0 && <div className="err"><AlertTriangle size={13} /> Há atalhos em conflito: a primeira ação do catálogo vence. Mude um deles.</div>}
    {GROUPS.map((g) => {
      const rows = shown.filter((a) => a.group === g); if (!rows.length) return null;
      return (
        <section key={g} className="pf-section">
          <h3>{g}</h3>
          {rows.map((a) => {
            const c = effectiveCombo(a.id, keymap); const over = a.id in keymap; const isConf = !!conf[a.id];
            return (
              <div key={a.id} className={`ks-row ${isConf ? "conf" : ""}`} data-testid={`ks-${a.id}`}>
                <div className="pf-lbl"><span>{a.label}{a.whileTyping && <span className="ks-typing" title="Vale mesmo digitando num terminal/input">⌨</span>}</span>{(a.note || isConf) && <small>{isConf ? `Conflito com: ${conf[a.id]!.map((id) => ACTION_BY_ID.get(id)!.label).join(", ")}` : a.note}</small>}</div>
                <div className="pf-ctl">
                  <button className={`ks-combo ${capturing === a.id ? "cap" : ""} ${over ? "over" : ""}`} data-testid={`ks-combo-${a.id}`} title="Clique e pressione a nova combinação (Esc cancela)" onClick={() => setCapturing(capturing === a.id ? null : a.id)}>
                    {capturing === a.id ? "pressione…" : c ? formatCombo(c) : <span className="mut">sem atalho</span>}
                  </button>
                  <button className="tb" title="Limpar atalho" data-testid={`ks-clear-${a.id}`} disabled={!c} onClick={() => setCombo(a.id, null)}><X size={13} /></button>
                  <button className="tb" title="Voltar ao padrão" data-testid={`ks-reset-${a.id}`} disabled={!over} onClick={() => resetOne(a.id)}><RotateCcw size={13} /></button>
                </div>
              </div>
            );
          })}
        </section>
      );
    })}
    {shown.length === 0 && <div className="mut">nenhuma ação casa com a busca</div>}
  </>);
}
