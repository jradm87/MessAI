import { Value } from "@sinclair/typebox/value";
import { PresetInput } from "@messai/contracts";
import { fail, succeed, type Result } from "@messai/domain";

/**
 * #56 — presets de "Início rápido" do terminal: editáveis e persistidos (tabela meta, chave `presets`).
 * Os padrões são a semente; "Restaurar padrões" volta a eles. Validação é a do contrato + ids únicos.
 */
export const AGENT_HINT = "Você está rodando dentro de um nó terminal do MessAI, um workspace visual para agentes. Outros nós (notas, terminais) podem estar conectados ao seu. Use o comando `mess context` para ver o espaço, seu nó e o conteúdo das notas conectadas; `mess note read <id|título>`, `mess note write <título> <texto>` (cria nota ligada a você), `mess connect <nodeId>`, `mess nodes`. Para falar com outro agente conectado: `mess peers` lista quem está ligado a você, `mess ask <nome> 'pergunta'` envia (chega como mensagem no terminal dele), `mess reply <id> 'texto'` responde, `mess inbox` mostra mensagens recebidas. Chat: quando uma mensagem do usuário vier marcada com [MessAI chat], responda também com `mess say 'sua resposta em Markdown'` (aparece em balões na tela); `mess chat` mostra o histórico do chat. Quando o usuário mencionar 'a nota conectada' ou 'a nota ligada', leia com `mess context`.";

export const PRESETS_META_KEY = "presets";
export const MAX_PRESETS = 20;
const base = { enabled: true, icon: "", color: "", maestro: false, target: "terminal" as const, theme: "system" as const };
export function defaultPresets(defaultShell: string): PresetInput[] {
  return [
    { ...base, id: "shell", label: "Shell", command: defaultShell, args: [] },
    { ...base, id: "claude", label: "Claude Code", command: "claude", args: ["--append-system-prompt", AGENT_HINT] },
    { ...base, id: "codex", label: "Codex", command: "codex", args: [] },
    { ...base, id: "opencode", label: "OpenCode", command: "opencode", args: [] },
    { ...base, id: "antigravity", label: "Antigravity", command: "agy", args: [] }, // o binário é `agy`
  ];
}
export const DEFAULT_PRESET_IDS = new Set(["shell", "claude", "codex", "opencode", "antigravity"]);

/** Regras além do schema: ids únicos e limite de quantidade. */
export function validatePresets(list: PresetInput[]): Result<void> {
  if (list.length > MAX_PRESETS) return fail("INVALID", `no máximo ${MAX_PRESETS} presets`);
  const seen = new Set<string>();
  for (const p of list) {
    if (seen.has(p.id)) return fail("INVALID", `preset duplicado: ${p.id}`);
    seen.add(p.id);
    if (p.command.trim() === "") return fail("INVALID", `preset ${p.id}: comando vazio`);
  }
  return succeed(undefined);
}

/** Lê o JSON salvo de forma tolerante: ausente/corrompido/inválido → padrões (nunca deixa o app sem presets por lixo no banco). */
export function parsePresets(raw: string | undefined, defaults: PresetInput[]): PresetInput[] {
  if (!raw) return defaults;
  try {
    const j: unknown = JSON.parse(raw);
    if (!Array.isArray(j)) return defaults;
    const list = j.filter((p) => Value.Check(PresetInput, p)) as PresetInput[];
    if (list.length !== j.length) return defaults; // item inválido: não arrisca uma lista pela metade
    return validatePresets(list).ok ? list : defaults;
  } catch { return defaults; }
}
