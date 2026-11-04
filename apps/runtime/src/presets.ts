import { Value } from "@sinclair/typebox/value";
import { PresetInput } from "@messai/contracts";
import { fail, succeed, type Result } from "@messai/domain";

/**
 * #56 — presets de "Início rápido" do terminal: editáveis e persistidos (tabela meta, chave `presets`).
 * Os padrões são a semente; "Restaurar padrões" volta a eles. Validação é a do contrato + ids únicos.
 */
export const AGENT_HINT = "Você está rodando dentro de um nó terminal do MessAI, um workspace visual para agentes. Outros nós (notas, terminais) podem estar conectados ao seu. Use o comando `mess context` para ver o espaço, seu nó e o conteúdo das notas conectadas; `mess note read <id|título>`, `mess note write <título> <texto>` (cria nota ligada a você), `mess connect <nodeId>`, `mess nodes`. Para falar com outro agente conectado: `mess peers` lista quem está ligado a você, `mess ask <nome> 'pergunta'` envia (chega como mensagem no terminal dele), `mess reply <id> 'texto'` responde, `mess inbox` mostra mensagens recebidas. Portais (navegador) e dispositivos Android JÁ EXISTEM aqui: para abrir/mostrar um site, crie um portal com `mess portal create <url>` (NÃO crie uma nota); depois `mess portal <portal> snapshot|open <url>|click <ref>|type <ref> <texto>`. Android: `mess device list`, `mess device <nó> ui|tap <x> <y>|launch <pacote>`. ATENÇÃO: as skills `maestri-*` (CLI `maestri`) são de OUTRO app e NÃO funcionam aqui — o comando é sempre `mess` (ex.: `mess portal create`, não `maestri portal create`). Se `mess` não estiver no PATH (acontece no Codex), use o caminho absoluto em $MESS_CLI — ex.: `$MESS_CLI portal create <url>`. Chat: quando uma mensagem do usuário vier marcada com [MessAI chat], responda também com `mess say 'sua resposta em Markdown'` (aparece em balões na tela); `mess chat` mostra o histórico do chat. Quando o usuário mencionar 'a nota conectada' ou 'a nota ligada', leia com `mess context`.";

export const PRESETS_META_KEY = "presets";
export const MAX_PRESETS = 20;
const base = { enabled: true, icon: "", color: "", maestro: false, target: "terminal" as const, theme: "system" as const };
export function defaultPresets(defaultShell: string): PresetInput[] {
  return [
    { ...base, id: "shell", label: "Shell", command: defaultShell, args: [] },
    { ...base, id: "claude", label: "Claude Code", command: "claude", args: ["--append-system-prompt", AGENT_HINT] },
    // Codex herda só um conjunto mínimo de env nos comandos (shell snapshots) e descartava MESS_SOCKET/MESS_TOKEN → `mess` falhava. inherit=all repassa tudo.
    // Codex: herda o ambiente nos comandos (senão perde MESS_*) e roda autônomo dentro do MessAI — sem a aprovação/sandbox internos do Codex
    // (o isolamento é do MessAI, modo isolado #93; igual ao Claude Code rodando aqui).
    { ...base, id: "codex", label: "Codex", command: "codex", args: ["--dangerously-bypass-approvals-and-sandbox", "-c", "shell_environment_policy.inherit=all", "-c", "shell_environment_policy.ignore_default_excludes=true"] },
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
