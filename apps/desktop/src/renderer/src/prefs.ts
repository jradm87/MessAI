import { useSyncExternalStore } from "react";

/**
 * #64 — preferências de UI por usuário, num único JSON em localStorage (`mess.prefs`).
 * Tipadas pelos DEFAULTS: chave desconhecida é descartada, tipo errado volta ao padrão.
 * O que precisa valer entre sessões/máquinas (config do runtime) NÃO mora aqui.
 */
export const PREFS_KEY = "mess.prefs";
export const DEFAULTS = {
  prefsTab: "general", // última aba aberta na janela de Preferências
  // #55 Geral
  webCursor: true, // mão em botões/menus (web) vs seta nativa
  powerMode: "never", // evitar suspensão: never | agents | always
  confirmExit: true, // tela de encerramento ao fechar a janela
  closeToTray: false, // fechar a janela esconde na bandeja (runtime e agentes seguem)
  // #56 Terminal (aparência global do xterm; o tema por nó, quando definido, vence)
  termTheme: "system", // system | dark | light | custom
  termCustom: "", // JSON da paleta custom (ver term-theme.ts)
  termFont: "", // família na frente da pilha padrão; "" = padrão
  termFontSize: 14,
  termPadX: 6, // igual ao padding histórico do .term
  termPadY: 6,
  termMemLimit: true, // limitar histórico (scrollback) por terminal
  termScrollback: 2000,
  termCopyOnSelect: false,
  // #57/#38 Agentes
  agentsSub: "roles", // sub-aba lembrada
  usageEnabled: true, // Agent Usage (ícones na barra + painel)
  usageDisabled: "", // ids de provedores escondidos do uso, separados por vírgula
  // #58 Atalhos: JSON { acaoId: combo | null } só com o que difere do padrão (ver keymap.ts)
  keymap: "",
  // #61 Atualizações
  updateAuto: true, // verificar ao abrir e a cada 6 h (só no app empacotado)
} as const;
export type Prefs = { -readonly [K in keyof typeof DEFAULTS]: (typeof DEFAULTS)[K] extends string ? string : (typeof DEFAULTS)[K] extends number ? number : boolean };
export type PrefKey = keyof Prefs;

/** Faz o parse tolerante do JSON salvo: mescla com os padrões, ignora lixo. */
export function parsePrefs(raw: string | null | undefined): Prefs {
  const out: Record<string, unknown> = { ...DEFAULTS };
  if (!raw) return out as Prefs;
  let j: unknown;
  try { j = JSON.parse(raw); } catch { return out as Prefs; }
  if (!j || typeof j !== "object" || Array.isArray(j)) return out as Prefs;
  for (const [k, v] of Object.entries(j as Record<string, unknown>)) {
    if (!(k in DEFAULTS)) continue; // chave que não existe mais (ou nunca existiu)
    if (typeof v !== typeof (DEFAULTS as Record<string, unknown>)[k]) continue; // tipo errado: fica o padrão
    out[k] = v;
  }
  return out as Prefs;
}

let current: Prefs | null = null;
const listeners = new Set<() => void>();
const read = (): Prefs => { if (!current) { let raw: string | null = null; try { raw = localStorage.getItem(PREFS_KEY); } catch { /* sem storage */ } current = parsePrefs(raw); } return current; };

export function getPrefs(): Prefs { return read(); }
export function getPref<K extends PrefKey>(k: K): Prefs[K] { return read()[k]; }
export function setPref<K extends PrefKey>(k: K, v: Prefs[K]): void {
  const next = { ...read(), [k]: v };
  current = next;
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* sem storage: vale só nesta sessão */ }
  for (const l of listeners) l();
}
export function onPrefs(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }
/** Hook: re-renderiza quando a chave muda (em qualquer lugar do app). */
export function usePref<K extends PrefKey>(k: K): Prefs[K] { return useSyncExternalStore(onPrefs, () => read()[k], () => DEFAULTS[k] as Prefs[K]); }
/** Só para testes: esquece o cache em memória. */
export function _resetPrefsForTests(): void { current = null; }
