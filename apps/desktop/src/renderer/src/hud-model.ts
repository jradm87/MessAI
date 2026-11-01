import type { TaskFinished, TaskSummary } from "@messai/contracts";

/**
 * #67 — modelo puro da janela flutuante do companheiro.
 * Um cartão por nó (o turno mais recente substitui o anterior), mais novo primeiro, limitado a HUD_MAX.
 * Sem React/DOM aqui: tudo testável em unidade.
 */
export type HudCard = {
  nodeId: string; workspaceId: string; agentType: string; at: string; screen: string;
  summary?: string; nextStep?: string; model?: string;
  title?: string; workspace?: string;
};
export type HudState = { cards: HudCard[] };
export const HUD_MAX = 50;
export const EMPTY_HUD: HudState = { cards: [] };

export type HudEvent =
  | { type: "finished"; event: TaskFinished }
  | { type: "summary"; summary: TaskSummary }
  | { type: "label"; nodeId: string; title?: string; workspace?: string }
  | { type: "dismiss"; nodeId: string }
  | { type: "workspaceGone"; workspaceId: string }
  | { type: "clear" };

export function hudReduce(state: HudState, ev: HudEvent): HudState {
  switch (ev.type) {
    case "finished": {
      const prev = state.cards.find((c) => c.nodeId === ev.event.nodeId);
      const card: HudCard = { nodeId: ev.event.nodeId, workspaceId: ev.event.workspaceId, agentType: ev.event.agentType, at: ev.event.at, screen: ev.event.screen };
      if (prev?.title) card.title = prev.title;
      if (prev?.workspace) card.workspace = prev.workspace;
      return { cards: [card, ...state.cards.filter((c) => c.nodeId !== ev.event.nodeId)].slice(0, HUD_MAX) };
    }
    case "summary": {
      // Resumo só enriquece um cartão vivo; se o usuário já dispensou, não ressuscita.
      if (!state.cards.some((c) => c.nodeId === ev.summary.nodeId)) return state;
      return { cards: state.cards.map((c) => (c.nodeId === ev.summary.nodeId ? { ...c, summary: ev.summary.summary, nextStep: ev.summary.nextStep, model: ev.summary.model } : c)) };
    }
    case "label": {
      if (!state.cards.some((c) => c.nodeId === ev.nodeId)) return state;
      return { cards: state.cards.map((c) => (c.nodeId === ev.nodeId ? { ...c, ...(ev.title ? { title: ev.title } : {}), ...(ev.workspace ? { workspace: ev.workspace } : {}) } : c)) };
    }
    case "dismiss": {
      if (!state.cards.some((c) => c.nodeId === ev.nodeId)) return state;
      return { cards: state.cards.filter((c) => c.nodeId !== ev.nodeId) };
    }
    case "workspaceGone": {
      if (!state.cards.some((c) => c.workspaceId === ev.workspaceId)) return state;
      return { cards: state.cards.filter((c) => c.workspaceId !== ev.workspaceId) };
    }
    case "clear": return state.cards.length ? EMPTY_HUD : state;
  }
}

/** Últimas `n` linhas não vazias da tela — o que o agente deixou visível ao assentar. */
export function screenTail(screen: string, n = 6): string {
  const lines = screen.replace(/\r/g, "").split("\n").map((l) => l.trimEnd()).filter((l) => l.trim().length > 0);
  return lines.slice(-n).join("\n");
}

/** "agora", "há 3 min", "há 2 h" — relativo a `now` (ms). */
export function relTime(atIso: string, now: number): string {
  const d = Math.max(0, now - Date.parse(atIso));
  if (!Number.isFinite(d)) return "";
  const s = Math.round(d / 1000);
  if (s < 45) return "agora";
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.round(h / 24)} d`;
}

/** Ainda vale esperar resumo? Só se o companheiro está disponível e o turno é recente (evita "resumindo…" eterno). */
export function awaitingSummary(card: HudCard, companionAvailable: boolean, now: number, windowMs = 90_000): boolean {
  return companionAvailable && !card.summary && now - Date.parse(card.at) < windowMs;
}
