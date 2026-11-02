import type { Band } from "@messai/contracts";

/** #70 — cor de uma banda: a escolhida, ou uma da paleta pela posição (estável enquanto a ordem de criação não muda). */
export const BAND_COLORS = ["#4a9eff", "#e5a23a", "#4cc38a", "#c77dff", "#ff6b6b", "#2ec4b6", "#f4a261", "#8d99ae"];
export const bandColor = (b: Pick<Band, "color">, index: number): string => b.color || BAND_COLORS[index % BAND_COLORS.length]!;

export type NodeBand = { id: string; name: string; color: string; asking: boolean };
/** Bandas a que um nó pertence, já com cor resolvida e se há pergunta em andamento nele. */
export function bandsOfNode(bands: Band[] | undefined, nodeId: string): NodeBand[] {
  return (bands ?? []).flatMap((b, i) => (b.nodeIds.includes(nodeId) ? [{ id: b.bandId, name: b.name, color: bandColor(b, i), asking: b.asking.includes(nodeId) }] : []));
}
