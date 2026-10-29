/** Ícones e cores por agente, no estilo do alvo (arcos do Claude, anel do Codex, alvo do Antigravity). */
export const AGENT_COLORS: Record<string, string> = {
  claude: "#d97757", codex: "#10a37f", gemini: "#4a9eff", opencode: "#a66bff", antigravity: "#5b8def", gpt: "#10a37f", shell: "#8a8a90",
};

/** Deduz o agente pelo nome/comando do terminal. */
export function agentKind(s: string): string {
  const t = s.toLowerCase();
  if (t.includes("claude")) return "claude";
  if (t.includes("codex")) return "codex";
  if (t.includes("gemini")) return "gemini";
  if (t.includes("opencode")) return "opencode";
  if (t.includes("antigravity") || /\bagy\b/.test(t)) return "antigravity";
  return "shell";
}

export function AgentIcon({ id, size = 20 }: { id: string; size?: number }) {
  const c = AGENT_COLORS[id] ?? "#8a8a90";
  const p = { width: size, height: size, viewBox: "0 0 24 24", fill: "none" as const };
  if (id === "claude")
    return (
      <svg {...p}>
        <circle cx="6" cy="18" r="2.3" fill={c} />
        <path d="M6 12.6 A5.4 5.4 0 0 1 11.4 18" stroke={c} strokeWidth="2.1" strokeLinecap="round" />
        <path d="M6 8.2 A9.8 9.8 0 0 1 15.8 18" stroke={c} strokeWidth="2.1" strokeLinecap="round" opacity="0.78" />
        <path d="M6 3.8 A14.2 14.2 0 0 1 20.2 18" stroke={c} strokeWidth="2.1" strokeLinecap="round" opacity="0.55" />
      </svg>
    );
  if (id === "codex" || id === "gpt")
    return (
      <svg {...p}>
        <circle cx="12" cy="12" r="7.5" stroke={c} strokeWidth="2.6" strokeLinecap="round" strokeDasharray="34 13" transform="rotate(-90 12 12)" />
      </svg>
    );
  if (id === "antigravity")
    return (
      <svg {...p}>
        <circle cx="12" cy="12" r="2.4" fill={c} />
        <circle cx="12" cy="12" r="6" stroke={c} strokeWidth="1.8" opacity="0.8" />
        <circle cx="12" cy="12" r="9.6" stroke={c} strokeWidth="1.8" opacity="0.5" />
      </svg>
    );
  if (id === "gemini")
    return (
      <svg {...p}>
        <path d="M12 3 C12 8 16 12 21 12 C16 12 12 16 12 21 C12 16 8 12 3 12 C8 12 12 8 12 3 Z" fill={c} opacity="0.9" />
      </svg>
    );
  if (id === "opencode")
    return (
      <svg {...p}>
        <rect x="4" y="4" width="16" height="16" rx="5" stroke={c} strokeWidth="2.2" />
        <circle cx="12" cy="12" r="2.4" fill={c} />
      </svg>
    );
  return (
    <svg {...p}><circle cx="12" cy="12" r="8" stroke={c} strokeWidth="2.2" /></svg>
  );
}
