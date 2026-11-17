/** Retângulo de tela em pixels lógicos (DIP), como o Electron usa em `workArea` e `getBounds`. */
export type Rect = { x: number; y: number; width: number; height: number };

/** Menor retângulo que cobre todas as áreas (ex.: a área útil de cada monitor). `null` se a lista for vazia. */
export function unionRect(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  return { x, y, width: right - x, height: bottom - y };
}

/** Iguais dentro de uma tolerância: o Windows arredonda posição e tamanho ao converter escalas de DPI. */
export function nearRect(a: Rect, b: Rect, tolerance = 16): boolean {
  return Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance
    && Math.abs(a.width - b.width) <= tolerance && Math.abs(a.height - b.height) <= tolerance;
}

/** Área (px²) da união que não cai em nenhum monitor: > 0 quando os monitores estão desalinhados ou têm alturas diferentes. */
export function uncoveredArea(rects: readonly Rect[]): number {
  const u = unionRect(rects);
  if (!u) return 0;
  const covered = rects.reduce((s, r) => s + r.width * r.height, 0); // monitores não se sobrepõem
  return Math.max(0, u.width * u.height - covered);
}
