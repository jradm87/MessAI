// Companheiro de IA local (#66): quando um agente conclui um turno (#65), resume o que aconteceu e sugere o
// próximo passo usando um modelo LOCAL via Ollama. 100% on-device: nada sai da máquina. Sem Ollama → degrada
// em silêncio (nenhum resumo, nada quebra). As funções puras ficam exportadas para teste sem rede.
import type { TaskFinished, TaskSummary } from "@messai/contracts";

export type CompanionCfg = { enabled: boolean; ollamaUrl: string; ollamaModel: string | undefined };
export type CompanionStatus = { enabled: boolean; available: boolean; url: string; model: string | null; models: string[] };
export type SummaryParts = { summary: string; nextStep: string };

const SCREEN_TAIL_LINES = 60;
const SCREEN_MAX_CHARS = 6000;
const GENERATE_TIMEOUT_MS = 45_000;
const PROBE_TIMEOUT_MS = 2_000;

/** Recorta a tela: últimas linhas úteis, sem rabo infinito, para caber num modelo pequeno. */
export function screenTail(screen: string): string {
  const lines = screen.split("\n").map((l) => l.replace(/\s+$/, "")).filter((l, i, a) => !(l === "" && a[i - 1] === ""));
  const tail = lines.slice(-SCREEN_TAIL_LINES).join("\n");
  return tail.length > SCREEN_MAX_CHARS ? tail.slice(-SCREEN_MAX_CHARS) : tail;
}

/** Prompt curto e determinístico: pede JSON com duas frases em pt-BR. */
export function buildSummaryPrompt(ev: Pick<TaskFinished, "agentType" | "screen">): string {
  return [
    "Você acompanha agentes de programação que trabalham em terminais.",
    `Um agente (${ev.agentType}) acabou de concluir um turno. Abaixo está a última tela do terminal dele.`,
    "Responda SOMENTE um JSON com exatamente estas chaves:",
    '  "summary": uma frase curta em pt-BR dizendo o que o agente fez/concluiu;',
    '  "nextStep": uma frase curta em pt-BR sugerindo o próximo passo para a pessoa.',
    "Não invente detalhes que não estejam na tela. Sem markdown, sem texto fora do JSON.",
    "",
    "TELA:",
    screenTail(ev.screen),
  ].join("\n");
}

const clean = (s: unknown): string => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");

/**
 * Extrai {summary, nextStep} da resposta do modelo. Tolerante: JSON puro, JSON em cerca ```json, JSON com lixo
 * em volta; por último, duas primeiras linhas de texto. Devolve null se não houver nada aproveitável.
 */
export function parseSummary(text: string): SummaryParts | null {
  const raw = (text ?? "").trim();
  if (!raw) return null;
  const candidates: string[] = [];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw); if (fenced?.[1]) candidates.push(fenced[1]);
  candidates.push(raw);
  const first = raw.indexOf("{"), last = raw.lastIndexOf("}"); if (first >= 0 && last > first) candidates.push(raw.slice(first, last + 1));
  for (const c of candidates) {
    try {
      const j = JSON.parse(c) as Record<string, unknown>;
      const summary = clean(j["summary"] ?? j["resumo"]); const nextStep = clean(j["nextStep"] ?? j["next_step"] ?? j["proximoPasso"] ?? j["próximoPasso"]);
      if (summary) return { summary: summary.slice(0, 400), nextStep: nextStep.slice(0, 400) };
    } catch { /* tenta o próximo candidato */ }
  }
  const lines = raw.split("\n").map((l) => l.replace(/^[-*•\d.)\s]+/, "").trim()).filter(Boolean);
  if (!lines.length) return null;
  return { summary: lines[0]!.slice(0, 400), nextStep: (lines[1] ?? "").slice(0, 400) };
}

export class Companion {
  private resolvedModel: string | null = null;
  constructor(private readonly cfg: CompanionCfg) {}

  /** Ollama está de pé? Quais modelos? (chamada curta, nunca lança) */
  async probe(): Promise<CompanionStatus> {
    const base = { enabled: this.cfg.enabled, url: this.cfg.ollamaUrl, model: this.cfg.ollamaModel ?? this.resolvedModel, models: [] as string[] };
    if (!this.cfg.enabled) return { ...base, available: false };
    try {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
      const res = await fetch(`${this.cfg.ollamaUrl}/api/tags`, { signal: ctrl.signal }).catch(() => null);
      clearTimeout(t);
      if (!res?.ok) return { ...base, available: false };
      const j = (await res.json()) as { models?: { name?: string }[] };
      const models = (j.models ?? []).map((m) => m.name ?? "").filter(Boolean);
      if (!this.cfg.ollamaModel && !this.resolvedModel && models[0]) this.resolvedModel = models[0];
      const model = this.cfg.ollamaModel ?? this.resolvedModel;
      return { ...base, available: models.length > 0 && !!model, model, models };
    } catch { return { ...base, available: false }; }
  }

  /** Resume o turno. null quando desligado, sem Ollama, sem modelo, timeout ou resposta inútil. Nunca lança. */
  async summarize(ev: TaskFinished): Promise<TaskSummary | null> {
    if (!this.cfg.enabled) return null;
    const model = this.cfg.ollamaModel ?? this.resolvedModel ?? (await this.probe()).model;
    if (!model) return null;
    try {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), GENERATE_TIMEOUT_MS);
      const res = await fetch(`${this.cfg.ollamaUrl}/api/generate`, {
        method: "POST", signal: ctrl.signal, headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, prompt: buildSummaryPrompt(ev), stream: false, format: "json", options: { temperature: 0.2, num_predict: 160 } }),
      }).catch(() => null);
      clearTimeout(t);
      if (!res?.ok) return null;
      const j = (await res.json()) as { response?: string };
      const parts = parseSummary(j.response ?? "");
      if (!parts) return null;
      return { sessionId: ev.sessionId, nodeId: ev.nodeId, workspaceId: ev.workspaceId, at: new Date().toISOString(), model, ...parts };
    } catch { return null; }
  }
}
