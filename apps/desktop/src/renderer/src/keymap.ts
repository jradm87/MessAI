/**
 * #58 — atalhos de teclado editáveis. Catálogo de ações com padrão; o usuário guarda só as diferenças (override)
 * em prefs `keymap` (JSON). Tudo puro e testável; o handler global do App pergunta `matchAction(e, keymap)`.
 */
export type Combo = { key: string; ctrl: boolean; shift: boolean; alt: boolean };
export type ActionDef = { id: string; label: string; group: string; combo: Combo | null; whileTyping?: boolean; note?: string };
export type Keymap = Record<string, Combo | null>; // id → combinação nova, ou null = atalho limpo

const C = (key: string, mods = ""): Combo => ({ key, ctrl: mods.includes("c"), shift: mods.includes("s"), alt: mods.includes("a") });
/** Ordem = ordem na tela. `whileTyping`: vale mesmo com foco num input/terminal (os demais são ignorados ao digitar). */
export const ACTIONS: ActionDef[] = [
  { id: "prefs.toggle", label: "Preferências", group: "Aplicativo", combo: C(",", "c"), whileTyping: true },
  { id: "sidebar.toggle", label: "Recolher/expandir barra lateral", group: "Aplicativo", combo: C("b", "c"), note: "No terminal, Ctrl+B é o prefixo do tmux" },
  { id: "minimap.toggle", label: "Minimapa", group: "Aplicativo", combo: C("m", "cs"), whileTyping: true },
  { id: "ws.new", label: "Novo espaço", group: "Espaços", combo: C("n", "cs"), whileTyping: true },
  { id: "ws.prev", label: "Espaço anterior", group: "Espaços", combo: C("arrowup", "c"), whileTyping: true, note: "Também Ctrl+[ fora de inputs" },
  { id: "ws.next", label: "Próximo espaço", group: "Espaços", combo: C("arrowdown", "c"), whileTyping: true, note: "Também Ctrl+] fora de inputs" },
  { id: "floors.overview", label: "Visão geral dos andares", group: "Espaços", combo: C("\\", "cs"), whileTyping: true },
  { id: "node.next", label: "Próximo elemento", group: "Navegação", combo: C("tab", "c"), whileTyping: true },
  { id: "node.prev", label: "Elemento anterior", group: "Navegação", combo: C("tab", "cs"), whileTyping: true },
  { id: "wire.next", label: "Próximo nó conectado", group: "Navegação", combo: C("arrowright", "ca"), whileTyping: true },
  { id: "wire.prev", label: "Nó conectado anterior", group: "Navegação", combo: C("arrowleft", "ca"), whileTyping: true },
  { id: "attention.select", label: "Ir ao terminal que precisa de atenção", group: "Navegação", combo: C("a", "cs"), whileTyping: true },
  { id: "attention.list", label: "Listar quem espera você", group: "Navegação", combo: C("a", "ca"), whileTyping: true },
  { id: "view.fit", label: "Enquadrar seleção / tudo", group: "Navegação", combo: C("\\", "c"), whileTyping: true },
  { id: "zoom.in", label: "Ampliar", group: "Navegação", combo: C("=", "c"), whileTyping: true },
  { id: "zoom.out", label: "Reduzir", group: "Navegação", combo: C("-", "c"), whileTyping: true },
  { id: "terminal.new", label: "Novo terminal", group: "Criar", combo: C("t", "c"), whileTyping: true },
  { id: "note.new", label: "Nova nota", group: "Criar", combo: C("d", "cs"), whileTyping: true },
  { id: "node.duplicate", label: "Duplicar selecionados", group: "Criar", combo: C("d", "c") },
  { id: "arrange.grid", label: "Arrumar em grade", group: "Criar", combo: C("t", "cs"), whileTyping: true },
  { id: "composer.toggle", label: "Compositor (mensagem ao terminal)", group: "Agentes", combo: C("p", "cs"), whileTyping: true },
  { id: "chat.toggle", label: "Chat do terminal", group: "Agentes", combo: C("j", "c"), whileTyping: true },
  { id: "link.start", label: "Conectar nó selecionado a…", group: "Agentes", combo: C("l", "c"), note: "No terminal, Ctrl+L limpa a tela" },
  { id: "history.undo", label: "Desfazer", group: "Edição", combo: C("z", "c"), note: "No terminal, Ctrl+Z é do shell (suspender)" },
  { id: "history.redo", label: "Refazer", group: "Edição", combo: C("z", "cs"), note: "Ctrl+Y também vale fora de inputs" },
  { id: "delete", label: "Excluir selecionados", group: "Edição", combo: C("w", "c"), note: "Delete/Backspace também valem fora de inputs" },
  { id: "drawings.group", label: "Agrupar desenhos", group: "Edição", combo: C("g", "c") },
  { id: "drawings.ungroup", label: "Desagrupar desenhos", group: "Edição", combo: C("g", "cs") },
  { id: "tool.select", label: "Ferramenta: selecionar", group: "Ferramentas", combo: C("v") },
  { id: "tool.terminal", label: "Ferramenta: terminal", group: "Ferramentas", combo: C("t") },
  { id: "tool.note", label: "Ferramenta: nota", group: "Ferramentas", combo: C("n") },
  { id: "tool.text", label: "Ferramenta: texto", group: "Ferramentas", combo: C("l") },
  { id: "tool.tree", label: "Ferramenta: árvore de arquivos", group: "Ferramentas", combo: C("f") },
  { id: "tool.draw", label: "Ferramenta: desenhar", group: "Ferramentas", combo: C("b") },
  { id: "tool.pan", label: "Ferramenta: mover a vista", group: "Ferramentas", combo: C("h") },
  { id: "draw.thinner", label: "Traço mais fino", group: "Ferramentas", combo: C("[") },
  { id: "draw.thicker", label: "Traço mais grosso", group: "Ferramentas", combo: C("]") },
];
export const ACTION_BY_ID = new Map(ACTIONS.map((a) => [a.id, a]));
export const GROUPS = [...new Set(ACTIONS.map((a) => a.group))];

/** Normaliza a tecla do evento: letras minúsculas, variantes com Shift ("+" → "=", "|" → "\\", "{" → "[", "}" → "]"), nomes especiais em minúsculo. */
export function normalizeKey(key: string): string {
  const k = key.length === 1 ? key.toLowerCase() : key.toLowerCase();
  const alias: Record<string, string> = { "+": "=", "|": "\\", "{": "[", "}": "]", "<": ",", ">": ".", "?": "/", ":": ";", "\"": "'", "~": "`", "!": "1", "@": "2", "#": "3", "$": "4", "%": "5", "^": "6", "&": "7", "*": "8", "(": "9", ")": "0", "_": "-", " ": "space", "esc": "escape" };
  return alias[k] ?? k;
}
const MODIFIER_KEYS = new Set(["control", "shift", "alt", "meta", "altgraph", "capslock", "os"]);
export const isModifierKey = (key: string) => MODIFIER_KEYS.has(key.toLowerCase());
export function comboFromEvent(e: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }): Combo {
  return { key: normalizeKey(e.key), ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, alt: e.altKey };
}
export const sameCombo = (a: Combo | null | undefined, b: Combo | null | undefined): boolean => !!a && !!b && a.key === b.key && a.ctrl === b.ctrl && a.shift === b.shift && a.alt === b.alt;

const KEY_LABEL: Record<string, string> = { arrowup: "↑", arrowdown: "↓", arrowleft: "←", arrowright: "→", tab: "Tab", escape: "Esc", space: "Espaço", delete: "Delete", backspace: "Backspace", enter: "Enter", "\\": "\\", ",": ",", "=": "=", "-": "-" };
export function formatCombo(c: Combo | null | undefined): string {
  if (!c) return "";
  const k = KEY_LABEL[c.key] ?? (c.key.length === 1 ? c.key.toUpperCase() : c.key[0]!.toUpperCase() + c.key.slice(1));
  return [c.ctrl ? "Ctrl" : "", c.shift ? "Shift" : "", c.alt ? "Alt" : "", k].filter(Boolean).join("+");
}
/** "Ctrl+Shift+P" → combo; aceita ↑/↓/←/→ e Esc. Inválido → null. */
export function parseCombo(s: string): Combo | null {
  const parts = s.split("+").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  const c: Combo = { key: "", ctrl: false, shift: false, alt: false };
  const rev: Record<string, string> = { "↑": "arrowup", "↓": "arrowdown", "←": "arrowleft", "→": "arrowright", esc: "escape", espaço: "space" };
  for (const p of parts) {
    const l = p.toLowerCase();
    if (l === "ctrl" || l === "control" || l === "cmd" || l === "meta") c.ctrl = true;
    else if (l === "shift") c.shift = true;
    else if (l === "alt" || l === "option") c.alt = true;
    else if (c.key) return null; else c.key = normalizeKey(rev[l] ?? p);
  }
  return c.key ? c : null;
}

const isCombo = (v: unknown): v is Combo => !!v && typeof v === "object" && typeof (v as Combo).key === "string" && (v as Combo).key.length > 0 && typeof (v as Combo).ctrl === "boolean" && typeof (v as Combo).shift === "boolean" && typeof (v as Combo).alt === "boolean";
/** JSON salvo → keymap; só ids conhecidos; valores inválidos caem fora. */
export function parseKeymap(raw: string | null | undefined): Keymap {
  if (!raw) return {};
  try {
    const j = JSON.parse(raw) as unknown;
    if (!j || typeof j !== "object" || Array.isArray(j)) return {};
    const out: Keymap = {};
    for (const [id, v] of Object.entries(j as Record<string, unknown>)) { if (!ACTION_BY_ID.has(id)) continue; if (v === null) out[id] = null; else if (isCombo(v)) out[id] = { key: normalizeKey(v.key), ctrl: v.ctrl, shift: v.shift, alt: v.alt }; }
    return out;
  } catch { return {}; }
}
export const effectiveCombo = (id: string, keymap: Keymap): Combo | null => (id in keymap ? keymap[id]! : ACTION_BY_ID.get(id)?.combo ?? null);
/** Ação que casa com o evento (primeira do catálogo). `typing` = foco em input/terminal: só ações `whileTyping`. */
export function matchAction(e: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }, keymap: Keymap, typing: boolean): string | null {
  if (isModifierKey(e.key)) return null;
  const c = comboFromEvent(e);
  for (const a of ACTIONS) { if (typing && !a.whileTyping) continue; if (sameCombo(effectiveCombo(a.id, keymap), c)) return a.id; }
  return null;
}
/** id → ids que dividem a mesma combinação efetiva (conflito). */
export function conflicts(keymap: Keymap): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const a of ACTIONS) {
    const c = effectiveCombo(a.id, keymap); if (!c) continue;
    const others = ACTIONS.filter((b) => b.id !== a.id && sameCombo(effectiveCombo(b.id, keymap), c)).map((b) => b.id);
    if (others.length) out[a.id] = others;
  }
  return out;
}
