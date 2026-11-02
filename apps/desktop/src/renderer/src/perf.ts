/** #42 — contagem de renders por nó, exposta em window.__messRenders (diagnóstico de fluidez e teste e2e do render incremental). */
const counts: Record<string, number> = {};
if (typeof window !== "undefined") (window as unknown as { __messRenders: Record<string, number> }).__messRenders = counts;
export const countRender = (id: string): void => { counts[id] = (counts[id] ?? 0) + 1; };
