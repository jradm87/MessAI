// Regras puras. Proibido importar fs, net, pty, banco (ADR-0009).
import type { ApiError, Connection, ErrorCode, Geometry, Node, Session, Workspace } from "@messai/contracts";

export type Result<T> = { ok: true; value: T } | { ok: false; error: ApiError };

export const fail = (code: ErrorCode, message: string, revision?: number): Result<never> => ({
  ok: false,
  error: revision === undefined ? { code, message } : { code, message, revision },
});
export const succeed = <T>(value: T): Result<T> => ({ ok: true, value });

// ---------- Revisão otimista (ADR-0003) ----------
export function checkRevision(ws: Pick<Workspace, "revision">, expected: number): Result<number> {
  if (expected !== ws.revision) {
    return fail("CONFLICT", `revisão esperada ${expected}, atual ${ws.revision}`, ws.revision);
  }
  return succeed(ws.revision + 1);
}

// ---------- Geometria ----------
export const MIN_SIZE = 40;
export function normalizeGeometry(g: Geometry): Geometry {
  return {
    x: Math.round(g.x),
    y: Math.round(g.y),
    w: Math.max(MIN_SIZE, Math.round(g.w)),
    h: Math.max(MIN_SIZE, Math.round(g.h)),
  };
}

export type AlignMode = "left" | "right" | "hcenter" | "top" | "bottom" | "vcenter";
/** Alinha os itens por uma borda/eixo comum. Preserva tamanho; mexe só em x ou y. Retorna só os que mudaram. */
export function alignGeometries<T extends { id: string; geometry: Geometry }>(items: T[], mode: AlignMode): { id: string; geometry: Geometry }[] {
  if (items.length < 2) return [];
  const gs = items.map((i) => i.geometry);
  const minX = Math.min(...gs.map((g) => g.x)), maxX = Math.max(...gs.map((g) => g.x + g.w));
  const minY = Math.min(...gs.map((g) => g.y)), maxY = Math.max(...gs.map((g) => g.y + g.h));
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const out: { id: string; geometry: Geometry }[] = [];
  for (const it of items) {
    const g = it.geometry; let { x, y } = g;
    if (mode === "left") x = minX;
    else if (mode === "right") x = maxX - g.w;
    else if (mode === "hcenter") x = Math.round(cx - g.w / 2);
    else if (mode === "top") y = minY;
    else if (mode === "bottom") y = maxY - g.h;
    else if (mode === "vcenter") y = Math.round(cy - g.h / 2);
    if (x !== g.x || y !== g.y) out.push({ id: it.id, geometry: { ...g, x: Math.round(x), y: Math.round(y) } });
  }
  return out;
}

/** Organiza os itens numa grade regular a partir do canto superior-esquerdo do conjunto. Colunas ~ raiz quadrada; linhas por altura máxima. Retorna só os que mudaram. */
export function gridLayout<T extends { id: string; geometry: Geometry }>(items: T[], gap = 40): { id: string; geometry: Geometry }[] {
  if (items.length < 2) return [];
  const gs = items.map((i) => i.geometry);
  const originX = Math.min(...gs.map((g) => g.x)), originY = Math.min(...gs.map((g) => g.y));
  const cols = Math.max(1, Math.ceil(Math.sqrt(items.length)));
  const colW = Math.max(...gs.map((g) => g.w)) + gap;
  const rowH = Math.max(...gs.map((g) => g.h)) + gap;
  const out: { id: string; geometry: Geometry }[] = [];
  items.forEach((it, i) => {
    const x = Math.round(originX + (i % cols) * colW), y = Math.round(originY + Math.floor(i / cols) * rowH);
    if (x !== it.geometry.x || y !== it.geometry.y) out.push({ id: it.id, geometry: { ...it.geometry, x, y } });
  });
  return out;
}

// ---------- Lease de entrada ----------
export const LEASE_TTL_MS = 30_000;

export type LeaseDecision =
  | { kind: "granted"; expiresAt: string }
  | { kind: "denied"; holder: string; expiresAt: string };

export function decideLease(session: { lease?: Session["lease"] | undefined }, clientId: string, now: Date): LeaseDecision {
  const expiresAt = new Date(now.getTime() + LEASE_TTL_MS).toISOString();
  const lease = session.lease;
  if (!lease || lease.clientId === clientId || new Date(lease.expiresAt) <= now) {
    return { kind: "granted", expiresAt };
  }
  return { kind: "denied", holder: lease.clientId, expiresAt: lease.expiresAt };
}

export function canWrite(session: Pick<Session, "lease" | "state">, clientId: string, now: Date): Result<void> {
  if (session.state !== "running") return fail("SESSION_NOT_RUNNING", `sessão está ${session.state}`);
  const lease = session.lease;
  if (!lease || new Date(lease.expiresAt) <= now) return fail("LEASE_HELD", "adquira o lease antes de escrever");
  if (lease.clientId !== clientId) return fail("LEASE_HELD", `controlado por outro cliente até ${lease.expiresAt}`);
  return succeed(undefined);
}

// ---------- Validações de nó ----------
export function validateNewNode(input: { kind: Node["kind"]; command?: string | undefined }): Result<void> {
  if (input.kind === "terminal" && input.command !== undefined && input.command.trim() === "") {
    return fail("INVALID", "command vazio");
  }
  return succeed(undefined);
}

// ---------- Plano de terminal (adaptador local) ----------
export type TerminalPlan = { command: string; args: string[]; cwd: string; env: Record<string, string> };

export function planLocalTerminal(input: {
  command?: string | undefined;
  args?: string[] | undefined;
  cwd: string;
  defaultShell: string;
  baseEnv: Record<string, string>;
  inject: Record<string, string>;
}): TerminalPlan {
  return {
    command: input.command ?? input.defaultShell,
    args: input.args ?? [],
    cwd: input.cwd,
    env: { ...input.baseEnv, ...input.inject, TERM: "xterm-256color" },
  };
}

// ---------- Buffer limitado ----------
export const MAX_BUFFER_BYTES = 512 * 1024;
export function trimBuffer(chunks: string[], totalBytes: number): { chunks: string[]; totalBytes: number } {
  let total = totalBytes;
  const out = [...chunks];
  while (total > MAX_BUFFER_BYTES && out.length > 1) {
    const dropped = out.shift()!;
    total -= Buffer.byteLength(dropped);
  }
  return { chunks: out, totalBytes: total };
}

// ---------- Mensagens entre agentes ----------
/** Um nó só fala com outro se existe conexão direta entre eles, em qualquer sentido. */
export function canMessage(connections: Pick<Connection, "sourceNodeId" | "targetNodeId">[], from: string, to: string): Result<void> {
  if (from === to) return fail("INVALID", "um nó não envia mensagem para si mesmo");
  const linked = connections.some((c) => (c.sourceNodeId === from && c.targetNodeId === to) || (c.sourceNodeId === to && c.targetNodeId === from));
  return linked ? succeed(undefined) : fail("FORBIDDEN", "os nós não estão conectados; ligue-os no canvas ou use `mess connect`");
}

/**
 * Texto entregue no terminal de destino: cabeçalho + corpo, termina com Enter.
 * O cabeçalho vai como COMENTÁRIO (`# …`): um shell comum (fish/bash) ignora a linha
 * inteira — inclusive o `(id)`, que o fish senão trataria como command substitution e
 * cuspiria "Unknown command". Agentes de IA recebem como paste multilinha e leem igual.
 */
export function formatDelivery(m: { messageId: string; fromTitle: string; text: string; replyTo?: string | undefined }): string {
  const head = m.replyTo
    ? `# [MessAI] Resposta de "${m.fromTitle}" (${m.messageId.slice(0, 8)}):`
    : `# [MessAI] Mensagem de "${m.fromTitle}" (${m.messageId.slice(0, 8)}). Para responder: mess reply ${m.messageId.slice(0, 8)} "texto"`;
  return `${head}\n${m.text.replace(/\r?\n/g, " ")}\r`;
}

/**
 * Identidade do terminal: é um CLI de IA ou um shell cru? (paridade com o Maestri, que
 * carrega isAgent/agentType por terminal). Derivado do comando ORIGINAL da sessão — robusto
 * porque o wrap do tmux e o cwd não entram no command/args salvos.
 * Importa para a resposta implícita do `ask`: shell assenta rápido (prompt volta); agente
 * costuma animar enquanto pensa, então a quiescência é mais longa.
 */
export type AgentKind = { isAgent: boolean; agentType: string; label: string };
const AGENT_BINS: { re: RegExp; type: string; label: string }[] = [
  { re: /(^|[\s/])claude([\s/-]|$)/, type: "claudeCode", label: "claude" },
  { re: /(^|[\s/])codex([\s/-]|$)/, type: "codex", label: "codex" },
  { re: /(^|[\s/])opencode([\s/-]|$)/, type: "openCode", label: "opencode" },
  { re: /(^|[\s/])(antigravity|agy)([\s/-]|$)/, type: "antigravityCLI", label: "antigravity" }, // binário: agy
  { re: /(^|[\s/])aider([\s/-]|$)/, type: "aider", label: "aider" },
];
export function agentKind(command: string, args: string[] = []): AgentKind {
  const hay = [command, ...args].join(" ");
  for (const a of AGENT_BINS) if (a.re.test(hay)) return { isAgent: true, agentType: a.type, label: a.label };
  return { isAgent: false, agentType: "genericShell", label: "shell" };
}

/**
 * Receita de retomada por tipo de agente (para o workspace à prova de reboot).
 * - `startArgs(uuid)`: argumentos a injetar no PRIMEIRO start, quando o CLI deixa FIXAR o id (só claude).
 * - `resume(id, baseArgs)`: comando/args para RETOMAR no restore. Claude com id → retomada determinística
 *   (`--resume <uuid>`); sem id (ou CLIs que não deixam fixar id) → "continuar a última conversa" do CLI,
 *   que no restore é a sessão que acabou de cair. Retorna null quando não dá → reabre limpo.
 *
 * Nota: a captura do id pelo store de cada CLI foi abandonada no v1 — frágil (layout/tempo variam por
 * CLI e versão). O "continuar a última" é robusto; o porém é colisão se houver VÁRIOS agentes do mesmo
 * tipo na MESMA pasta (pega a última). Para um de cada por pasta — o caso comum — resolve.
 */
export type ResumeRecipe = {
  startArgs?: (uuid: string) => string[];
  resume?: (id: string | null, baseArgs: string[]) => { command: string; args: string[] } | null;
};
export function agentResume(agentType: string): ResumeRecipe {
  switch (agentType) {
    case "claudeCode": // id fixado no start → retoma determinístico; sem id (ex.: criado numa versão antiga) → --continue da pasta
      return {
        startArgs: (uuid) => ["--session-id", uuid],
        resume: (id, base) => ({ command: "claude", args: [...stripFlag(base, "--session-id"), ...(id ? ["--resume", id] : ["--continue"])] }),
      };
    case "codex":
      return { resume: () => ({ command: "codex", args: ["resume", "--last"] }) };
    case "openCode":
      return { resume: (_id, base) => ({ command: "opencode", args: ["--continue", ...base] }) };
    case "antigravityCLI":
      return { resume: (_id, base) => ({ command: "agy", args: ["--continue", ...base] }) };
    default:
      return {};
  }
}
/** Remove um flag `--x <valor>` de uma lista de argumentos (para trocar --session-id por --resume). */
function stripFlag(args: string[], flag: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) { if (args[i] === flag) { i++; continue; } out.push(args[i]!); }
  return out;
}

/** Remove sequências de escape ANSI/CSI/OSC — para devolver a "tela" do terminal como texto limpo. */
export function stripAnsi(s: string): string {
  return s
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "") // OSC (ex.: título da janela)
    .replace(/\x1b[@-Z\\-_]/g, "") // escapes de 1 byte
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "") // CSI (cores, cursor)
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ""); // controles (mantém \t \n \r)
}

/** Resolve "to" por id, prefixo de id ou título (sem diferenciar maiúsculas). */
export function resolveNodeRef<T extends Pick<Node, "nodeId" | "title">>(nodes: T[], ref: string): Result<T> {
  const r = ref.trim().toLowerCase();
  const hits = nodes.filter((n) => n.nodeId === r || n.nodeId.startsWith(r) || n.title.toLowerCase() === r);
  if (hits.length === 1) return succeed(hits[0]!);
  if (hits.length === 0) return fail("NOT_FOUND", `nenhum nó corresponde a "${ref}"`);
  return fail("CONFLICT", `"${ref}" é ambíguo: ${hits.map((h) => `${h.title} [${h.nodeId.slice(0, 8)}]`).join(", ")}`);
}


/** Texto do papel como o agente recebe. */
export const roleText = (role: { name: string; instructions: string }): string =>
  `Sua responsabilidade neste terminal: ${role.name}.\n${role.instructions.trim()}`;

/** Injeta o papel na linha de comando quando a CLI aceita system prompt (Claude Code). Outras CLIs recebem só por variável de ambiente. */
export function applyRole(command: string, args: string[], role: { name: string; instructions: string } | undefined): string[] {
  if (!role) return args;
  const bin = command.split("/").pop();
  if (bin !== "claude") return args;
  const i = args.indexOf("--append-system-prompt");
  const text = roleText(role);
  if (i >= 0 && i + 1 < args.length) return args.map((a, j) => (j === i + 1 ? `${a}\n\n${text}` : a));
  return [...args, "--append-system-prompt", text];
}


/** Nome automático da nota: primeira linha não vazia, sem marcadores Markdown, até 48 caracteres. */
export function deriveNoteTitle(content: string): string | undefined {
  const line = content.split(/\r?\n/).map((l) => l.replace(/^[\s#>*\-\d.]+/, "").trim()).find((l) => l.length > 0);
  if (!line) return undefined;
  return line.length > 48 ? `${line.slice(0, 47)}…` : line;
}
/** Nome de arquivo seguro para a nota. */
export const noteFileName = (title: string): string => `${(title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").trim().slice(0, 80) || "nota")}.md`;


// ---------- tmux (sessão persistente) ----------
export const tmuxSessionName = (sessionId: string): string => `mess-${sessionId.slice(0, 12)}`;
/** Aspas simples POSIX para montar o comando que o tmux executa. */
export const shellQuote = (a: string): string => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`);
/** Plano equivalente rodando dentro do tmux: cria (ou reanexa, -A) a sessão com o comando e o ambiente injetado; o status bar fica desligado. */
export function wrapInTmux(plan: TerminalPlan, name: string, inject: Record<string, string>, socket = "mess"): TerminalPlan {
  const cmd = [plan.command, ...plan.args].map(shellQuote).join(" ");
  const envFlags = Object.entries(inject).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
  return { ...plan, command: "tmux", args: ["-L", socket, "new-session", "-A", "-s", name, "-c", plan.cwd, ...envFlags, cmd, ";", "set-option", "-t", name, "status", "off"] };
}
export const tmuxAttachPlan = (plan: TerminalPlan, name: string, socket = "mess"): TerminalPlan => ({ ...plan, command: "tmux", args: ["-L", socket, "attach-session", "-t", name] });


// ---------- andares (floors) ----------
export const slugify = (name: string): string => name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "andar";
/** Comandos git para criar o worktree do andar. `base` só vale para branch nova. */
export function floorGitPlan(input: { groundCwd: string; path: string; branch: string; newBranch: boolean; base?: string | undefined }): string[][] {
  const args = ["-C", input.groundCwd, "worktree", "add"];
  if (input.newBranch) return [[...args, "-b", input.branch, input.path, ...(input.base ? [input.base] : [])]];
  return [[...args, input.path, input.branch]];
}
/** Extrai arquivos em conflito da saída do git merge. */
export function parseMergeConflicts(output: string): string[] {
  const out = new Set<string>();
  for (const m of output.matchAll(/CONFLICT \([^)]*\): (?:Merge conflict in|.*?) ?([^\n]+?)(?: deleted in.*)?$/gm)) { const f = m[1]?.trim(); if (f) out.add(f.replace(/^Merge conflict in /, "")); }
  return [...out];
}


// ---------- árvore de arquivos ----------
/** Normaliza um caminho relativo e recusa qualquer tentativa de sair da raiz. */
export function safeRelPath(rel: string): Result<string> {
  if (rel.startsWith("/") || /^[A-Za-z]:[\\/]/.test(rel) || rel.includes("\0")) return fail("INVALID", "caminho precisa ser relativo ao espaço");
  const parts: string[] = [];
  for (const p of rel.split(/[\\/]+/)) { if (p === "" || p === ".") continue; if (p === "..") { if (!parts.length) return fail("INVALID", "caminho fora do espaço"); parts.pop(); continue; } parts.push(p); }
  return succeed(parts.join("/"));
}
/** Conteúdo parece binário? (NUL nos primeiros bytes) */
export const looksBinary = (head: Uint8Array): boolean => head.subarray(0, 8000).includes(0);
