/** #55 — "Evitar suspensão": decisão pura de quando segurar o inibidor de sleep do SO. */
export type PowerMode = "never" | "agents" | "always";
export const parsePowerMode = (v: unknown): PowerMode => (v === "agents" || v === "always" ? v : "never");
/** Sempre → segura; Enquanto agentes trabalham → só com agente rodando; Nunca → nunca. A tela pode dormir normalmente. */
export function shouldBlock(mode: PowerMode, agentsRunning: boolean): boolean {
  return mode === "always" || (mode === "agents" && agentsRunning);
}
