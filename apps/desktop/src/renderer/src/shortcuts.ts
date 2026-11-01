import { useMemo } from "react";
import { usePref } from "./prefs.js";
import { effectiveCombo, formatCombo, parseKeymap, type Keymap } from "./keymap.js";

/** #58 — keymap efetivo (padrões + overrides do usuário) como hook; e o texto do atalho para tooltips. */
export function useKeymap(): Keymap { const raw = usePref("keymap"); return useMemo(() => parseKeymap(raw), [raw]); }
export function useHint(id: string): string { const km = useKeymap(); const c = effectiveCombo(id, km); return c ? ` (${formatCombo(c)})` : ""; }
