/** #61 — estado do auto-update como máquina pura (o electron-updater só emite eventos; aqui fica o que a UI mostra). */
export type UpdateStatus = "unsupported" | "idle" | "checking" | "available" | "not-available" | "downloading" | "downloaded" | "error";
export type UpdateState = { supported: boolean; status: UpdateStatus; version?: string; percent?: number; error?: string; lastCheck?: string; current: string };
export type UpdateEvent =
  | { type: "checking" }
  | { type: "available"; version: string }
  | { type: "not-available"; at: string }
  | { type: "progress"; percent: number }
  | { type: "downloaded"; version: string; at: string }
  | { type: "error"; message: string; at: string };

export const initialUpdateState = (current: string, supported: boolean): UpdateState => ({ supported, status: supported ? "idle" : "unsupported", current });

export function applyUpdateEvent(s: UpdateState, ev: UpdateEvent): UpdateState {
  if (!s.supported) return s; // modo dev / não empacotado: nada muda
  switch (ev.type) {
    case "checking": return { ...s, status: "checking", error: undefined };
    case "available": return { ...s, status: "available", version: ev.version, percent: 0 };
    case "not-available": return { ...s, status: "not-available", version: undefined, percent: undefined, lastCheck: ev.at };
    case "progress": return { ...s, status: "downloading", percent: Math.max(0, Math.min(100, Math.round(ev.percent))) };
    case "downloaded": return { ...s, status: "downloaded", version: ev.version, percent: 100, lastCheck: ev.at };
    case "error": return { ...s, status: "error", error: ev.message, lastCheck: ev.at };
  }
}
/** Mensagens de rede/sem release viram texto curto e honesto, sem stack. */
export function friendlyUpdateError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("406") || m.includes("latest-linux.yml") || m.includes("cannot find latest")) return "Nenhuma release publicada com manifesto de atualização ainda.";
  if (m.includes("enotfound") || m.includes("econnrefused") || m.includes("network") || m.includes("getaddrinfo")) return "Sem conexão com o GitHub.";
  return message.split("\n")[0]!.slice(0, 160);
}
