/** #57 — prompts salvos (conveniência pessoal, localStorage `mess.prompts`), compartilhados entre o compositor e Preferências → Agentes. */
export type SavedPrompt = { title: string; text: string };
export const PROMPTS_KEY = "mess.prompts";
export const PROMPTS_MAX = 50;
const listeners = new Set<() => void>();
let cache: SavedPrompt[] | null = null;

export function parsePrompts(raw: string | null | undefined): SavedPrompt[] {
  if (!raw) return [];
  try {
    const j = JSON.parse(raw) as unknown;
    if (!Array.isArray(j)) return [];
    return j.filter((p): p is SavedPrompt => !!p && typeof p === "object" && typeof (p as SavedPrompt).title === "string" && typeof (p as SavedPrompt).text === "string" && (p as SavedPrompt).text.trim().length > 0).slice(0, PROMPTS_MAX);
  } catch { return []; }
}
export function loadPrompts(): SavedPrompt[] { if (!cache) { let raw: string | null = null; try { raw = localStorage.getItem(PROMPTS_KEY); } catch { /* sem storage */ } cache = parsePrompts(raw); } return cache; }
export function savePrompts(list: SavedPrompt[]): void {
  cache = list.slice(0, PROMPTS_MAX);
  try { localStorage.setItem(PROMPTS_KEY, JSON.stringify(cache)); } catch { /* sem storage: vale só nesta sessão */ }
  for (const l of listeners) l();
}
export function onPrompts(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }
/** Título automático = primeira linha, até 48 caracteres. */
export const promptTitle = (text: string): string => (text.trim().split("\n")[0] ?? text).slice(0, 48);
/** Salva no topo, sem duplicar o mesmo texto. */
export function upsertPrompt(list: SavedPrompt[], p: SavedPrompt): SavedPrompt[] { return [p, ...list.filter((x) => x.text !== p.text)].slice(0, PROMPTS_MAX); }
export function _resetPromptsForTests(): void { cache = null; }
