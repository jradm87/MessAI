/**
 * #56 — tema/fonte/padding do xterm, fora do React para ser testável.
 * Tema por terminal (nó) vence o global; "system" segue o tema do app (tokens CSS --term-*).
 */
export type Palette = {
  background: string; foreground: string; cursor: string; selectionBackground: string;
  black?: string; red?: string; green?: string; yellow?: string; blue?: string; magenta?: string; cyan?: string; white?: string;
};
export const DARK_PALETTE: Palette = { background: "#0A0A0B", foreground: "#E4E4E7", cursor: "#4A9EFF", selectionBackground: "rgba(74,158,255,.35)" };
export const LIGHT_PALETTE: Palette = { background: "#FFFFFF", foreground: "#1B1F27", cursor: "#2F7DF6", selectionBackground: "rgba(47,125,246,.25)" };
export const DEFAULT_CUSTOM: Required<Palette> = {
  background: "#101418", foreground: "#D8DEE9", cursor: "#88C0D0", selectionBackground: "#4C566A",
  black: "#3B4252", red: "#BF616A", green: "#A3BE8C", yellow: "#EBCB8B", blue: "#81A1C1", magenta: "#B48EAD", cyan: "#88C0D0", white: "#E5E9F0",
};
export const PALETTE_KEYS = Object.keys(DEFAULT_CUSTOM) as (keyof Required<Palette>)[];
const COLOR_RE = /^(#[0-9a-f]{6}([0-9a-f]{2})?|rgba?\([^)]*\))$/i;

/** Paleta custom salva (JSON) → paleta válida; chave ausente/inválida cai no padrão da custom. */
export function parseCustomPalette(raw: string | null | undefined): Required<Palette> {
  const out: Required<Palette> = { ...DEFAULT_CUSTOM };
  if (!raw) return out;
  try {
    const j = JSON.parse(raw) as unknown;
    if (!j || typeof j !== "object" || Array.isArray(j)) return out;
    for (const k of PALETTE_KEYS) { const v = (j as Record<string, unknown>)[k]; if (typeof v === "string" && COLOR_RE.test(v.trim())) out[k] = v.trim(); }
  } catch { /* lixo: padrão */ }
  return out;
}

/** Paleta efetiva de um terminal. `system` = tokens do app (passados em `system`). */
export function resolveTermTheme(nodeTheme: string | undefined, prefTheme: string, custom: Palette, system: Palette): Palette {
  const t = nodeTheme && nodeTheme !== "system" ? nodeTheme : prefTheme;
  const p = t === "dark" ? DARK_PALETTE : t === "light" ? LIGHT_PALETTE : t === "custom" ? custom : system;
  // xterm: as "bright" seguem as normais quando a paleta custom não as define — mantém legível.
  if (t === "custom") return { ...p, brightBlack: p.black, brightRed: p.red, brightGreen: p.green, brightYellow: p.yellow, brightBlue: p.blue, brightMagenta: p.magenta, brightCyan: p.cyan, brightWhite: p.white } as Palette;
  return p;
}

export const DEFAULT_FONT_STACK = '"JetBrainsMono Nerd Font", "MesloLGS NF", "FiraCode Nerd Font", "JetBrains Mono", "Cascadia Code", Menlo, Consolas, "DejaVu Sans Mono", ui-monospace, monospace';
export const FONT_OPTIONS = ["JetBrainsMono Nerd Font", "MesloLGS NF", "FiraCode Nerd Font", "JetBrains Mono", "Fira Code", "Cascadia Code", "Hack", "Ubuntu Mono", "DejaVu Sans Mono", "Source Code Pro", "Menlo", "Consolas"] as const;
/** Família escolhida vai na frente da pilha padrão (fallback garantido). "" = pilha padrão. */
export function fontStack(pref: string): string { const f = pref.trim(); return f ? `"${f.replace(/"/g, "")}", ${DEFAULT_FONT_STACK}` : DEFAULT_FONT_STACK; }

export const FONT_MIN = 9, FONT_MAX = 28, PAD_MAX = 32, SCROLLBACK_MIN = 200, SCROLLBACK_MAX = 100_000, SCROLLBACK_UNLIMITED = 100_000;
const clamp = (n: number, lo: number, hi: number, dflt: number) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : dflt);
export const clampFontSize = (n: number) => clamp(n, FONT_MIN, FONT_MAX, 14);
export const clampPad = (n: number) => clamp(n, 0, PAD_MAX, 0);
export const clampScrollback = (n: number) => clamp(n, SCROLLBACK_MIN, SCROLLBACK_MAX, 2000);
/** Linhas de histórico efetivas: com o limite desligado, o teto generoso (memória do xterm cresce com isso). */
export const effectiveScrollback = (memLimit: boolean, scrollback: number) => (memLimit ? clampScrollback(scrollback) : SCROLLBACK_UNLIMITED);
