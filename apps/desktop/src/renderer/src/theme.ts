// Tema do app (#54): Sistema (segue o SO) · Claro · Escuro.
// A preferência fica em localStorage (`mess.theme`); o tema EFETIVO vai em `data-theme` no <html>,
// e o CSS resolve tudo por tokens (`:root` = escuro, `:root[data-theme="light"]` = claro).
// Este módulo é puro onde importa (resolve/next/parse) para ser testável sem DOM.

export type ThemePref = "system" | "light" | "dark";
export type ThemeEffective = "light" | "dark";
export const THEME_KEY = "mess.theme";
const PREFS: readonly ThemePref[] = ["system", "light", "dark"];

/** Valida um valor vindo do storage; qualquer lixo vira "system". */
export function parseThemePref(v: unknown): ThemePref { return typeof v === "string" && (PREFS as readonly string[]).includes(v) ? (v as ThemePref) : "system"; }
/** Tema efetivo a partir da preferência e do que o SO pede. */
export function resolveTheme(pref: ThemePref, systemDark: boolean): ThemeEffective { return pref === "system" ? (systemDark ? "dark" : "light") : pref; }
/** Ciclo do botão: Sistema → Claro → Escuro → Sistema. */
export function nextTheme(pref: ThemePref): ThemePref { return PREFS[(PREFS.indexOf(pref) + 1) % PREFS.length]!; }
export const THEME_LABEL: Record<ThemePref, string> = { system: "Sistema", light: "Claro", dark: "Escuro" };

// ---- parte com DOM (não roda em teste) ----
const listeners = new Set<(t: ThemeEffective, pref: ThemePref) => void>();
let currentPref: ThemePref = "system";
const mq = () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null);
const systemDark = () => mq()?.matches ?? true;

export function getThemePref(): ThemePref { return currentPref; }
export function getEffectiveTheme(): ThemeEffective { return resolveTheme(currentPref, systemDark()); }

function paint() {
  const eff = getEffectiveTheme();
  document.documentElement.setAttribute("data-theme", eff);
  document.documentElement.style.colorScheme = eff;
  for (const l of listeners) l(eff, currentPref);
}

/** Lê a preferência salva e aplica ANTES do primeiro render; segue mudanças do SO no modo Sistema. */
export function initTheme(): void {
  try { currentPref = parseThemePref(localStorage.getItem(THEME_KEY)); } catch { currentPref = "system"; }
  paint();
  mq()?.addEventListener?.("change", () => { if (currentPref === "system") paint(); });
}

export function setThemePref(pref: ThemePref): void {
  currentPref = pref;
  try { localStorage.setItem(THEME_KEY, pref); } catch { /* sem storage: vale só nesta sessão */ }
  paint();
}

/** Assina mudanças do tema efetivo (ex.: xterm re-aplica o próprio tema). Devolve o unsubscribe. */
export function onTheme(fn: (t: ThemeEffective, pref: ThemePref) => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }

/** Lê um token CSS já resolvido para o tema atual (ex.: "--term-bg"). */
export function cssVar(name: string): string { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
