/** #47 — presença de agentes (barra inferior) e sinais de status (sidebar). Puro e testável. */
import type { AttentionItem } from "@messai/contracts";

export type WsSignal = { total: number; finished: number; unread: number; dead: number };
const ZERO: WsSignal = { total: 0, finished: 0, unread: 0, dead: 0 };
/** Atenção global por espaço; os andares somam no térreo (parentOf: andar → térreo). */
export function attentionByWorkspace(items: AttentionItem[], parentOf: Record<string, string | undefined> = {}): Record<string, WsSignal> {
  const out: Record<string, WsSignal> = {};
  const add = (id: string, it: AttentionItem) => {
    const s = (out[id] ??= { ...ZERO });
    s.total += 1;
    if (it.kind === "finished") s.finished += 1; else if (it.kind === "unread") s.unread += it.count ?? 1; else s.dead += 1;
  };
  for (const it of items) { add(it.workspaceId, it); const p = parentOf[it.workspaceId]; if (p) add(p, it); }
  return out;
}
export const signalTitle = (s: WsSignal): string => [s.finished ? `${s.finished} agente(s) concluiu` : "", s.unread ? `${s.unread} mensagem(ns) não lida(s)` : "", s.dead ? `${s.dead} terminal(is) encerrado(s)` : ""].filter(Boolean).join(" · ");

export type AgentState = "attention" | "running" | "idle" | "dead";
export type AgentPresence = { kind: string; count: number; state: AgentState; attention: number; running: number };
const RANK: Record<AgentState, number> = { attention: 3, dead: 2, running: 1, idle: 0 };
/** Agrupa os terminais do espaço por tipo de agente com o "pior" estado (atenção > encerrado > rodando > ocioso). */
export function agentPresence(nodes: { id: string; kind: string }[], session: Record<string, string>, attention: (id: string) => boolean): AgentPresence[] {
  const by = new Map<string, AgentPresence>();
  for (const n of nodes) {
    const st = session[n.id]; const att = attention(n.id);
    const state: AgentState = att && st !== "exited" && st !== "lost" ? "attention" : st === "exited" || st === "lost" ? "dead" : st === "running" ? "running" : "idle";
    const p = by.get(n.kind) ?? { kind: n.kind, count: 0, state: "idle" as AgentState, attention: 0, running: 0 };
    p.count += 1; if (state === "attention") p.attention += 1; if (state === "running" || state === "attention") p.running += 1;
    if (RANK[state] > RANK[p.state]) p.state = state;
    by.set(n.kind, p);
  }
  return [...by.values()];
}
export const presenceTitle = (p: AgentPresence): string => `${p.kind} ×${p.count}${p.running ? ` · ${p.running} rodando` : ""}${p.attention ? ` · ${p.attention} esperando você` : ""}${p.state === "dead" ? " · há encerrado(s)" : ""}`;
