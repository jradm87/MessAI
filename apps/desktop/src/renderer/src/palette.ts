/**
 * #69 — paleta global: itens de qualquer tipo (espaço, andar, nó, conteúdo, atenção, ação) ranqueados por uma busca
 * tolerante (sem acento/caixa; prefixo > início de palavra > substring > subsequência). Puro e testável.
 */
export type PaletteKind = "attention" | "workspace" | "floor" | "node" | "content" | "action";
export type PaletteItem = {
  id: string; kind: PaletteKind; label: string; detail?: string; keywords?: string; // keywords: texto extra que conta na busca
  workspaceId?: string; nodeId?: string; chatThread?: number; action?: string;
  /** peso-base para empates (atenção > ação > nó atual > espaço > conteúdo) */
  boost?: number;
};
export const fold = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Pontuação de um texto para a consulta já normalizada; 0 = não casa. */
export function scoreText(text: string, q: string): number {
  if (!q) return 1;
  const t = fold(text); const i = t.indexOf(q);
  if (i === 0) return 100;
  if (i > 0) return t[i - 1] === " " || t[i - 1] === "/" || t[i - 1] === "-" || t[i - 1] === "_" ? 80 : 50;
  // subsequência (ex.: "nt" acha "Novo terminal") — só vale para consultas curtas, senão vira ruído
  if (q.length <= 4) { let k = 0; for (const ch of t) { if (ch === q[k]) k++; if (k === q.length) return 20; } }
  return 0;
}
export function scoreItem(item: PaletteItem, q: string): number {
  const base = Math.max(scoreText(item.label, q), item.detail ? scoreText(item.detail, q) - 10 : 0, item.keywords ? scoreText(item.keywords, q) - 20 : 0);
  return base > 0 ? base + (item.boost ?? 0) : 0;
}
const ORDER: PaletteKind[] = ["attention", "action", "node", "workspace", "floor", "content"];
/** Ranqueia: sem consulta devolve tudo na ordem natural (limitado); com consulta, por pontuação e desempate por tipo. */
export function rankItems(items: PaletteItem[], query: string, limit = 40): PaletteItem[] {
  const q = fold(query.trim());
  if (!q) return items.slice(0, limit);
  return items.map((it) => ({ it, s: scoreItem(it, q) })).filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || ORDER.indexOf(a.it.kind) - ORDER.indexOf(b.it.kind) || a.it.label.localeCompare(b.it.label))
    .slice(0, limit).map((x) => x.it);
}
/** Agrupa mantendo a ordem relativa para a renderização por seções. */
export function groupItems(items: PaletteItem[]): { kind: PaletteKind; title: string; items: PaletteItem[] }[] {
  const titles: Record<PaletteKind, string> = { attention: "Esperando você", action: "Ações", node: "Nós", workspace: "Espaços", floor: "Andares", content: "Conteúdo (notas e chats)" };
  const out: { kind: PaletteKind; title: string; items: PaletteItem[] }[] = [];
  for (const it of items) { let g = out.find((x) => x.kind === it.kind); if (!g) { g = { kind: it.kind, title: titles[it.kind], items: [] }; out.push(g); } g.items.push(it); }
  return out;
}
