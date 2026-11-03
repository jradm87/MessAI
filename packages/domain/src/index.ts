// Regras puras. Proibido importar fs, net, pty, banco (ADR-0009).
import type { ApiError, Connection, EnvVarEntry, ErrorCode, Geometry, GitHostEntry, GitHostKind, Node, Session, Workspace } from "@messai/contracts";

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

/** #82 Separa uma referência "Nome @ Espaço" no último `@` quando ambos os lados têm texto. */
export function parseCrossRef(ref: string): { nodeRef: string; workspaceRef?: string } {
  const idx = ref.lastIndexOf("@");
  if (idx > 0 && idx < ref.length - 1) {
    const nodeRef = ref.slice(0, idx).trim();
    const workspaceRef = ref.slice(idx + 1).trim();
    if (nodeRef && workspaceRef) return { nodeRef, workspaceRef };
  }
  return { nodeRef: ref.trim() };
}

/**
 * #82 Resolve um nó localmente ou entre andares/espaços.
 * - Com `@` ("Nome @ Espaço"): filtra pelos espaços/andares que casam com nome, slug, branch ou id e resolve o nó lá dentro.
 * - Sem `@`: tenta primeiro no próprio espaço, depois nos nós já conectados em outros espaços, e por fim em todos os espaços.
 */
export function resolveCrossNodeRef<
  N extends Pick<Node, "nodeId" | "title" | "workspaceId">,
  W extends Pick<Workspace, "workspaceId" | "name" | "branch">,
>(
  allNodes: N[],
  workspaces: W[],
  localWorkspaceId: string,
  connectedNodeIds: ReadonlySet<string>,
  ref: string,
): Result<N> {
  const { nodeRef, workspaceRef } = parseCrossRef(ref);
  if (workspaceRef) {
    const wr = workspaceRef.toLowerCase();
    const wrSlug = slugify(workspaceRef);
    const wsHits = workspaces.filter(
      (w) =>
        w.workspaceId.toLowerCase() === wr ||
        w.workspaceId.toLowerCase().startsWith(wr) ||
        w.name.toLowerCase() === wr ||
        slugify(w.name) === wrSlug ||
        (w.branch !== undefined && w.branch.toLowerCase() === wr),
    );
    if (wsHits.length === 0) return fail("NOT_FOUND", `nenhum espaço/andar corresponde a "${workspaceRef}"`);
    const wsIds = new Set(wsHits.map((w) => w.workspaceId));
    return resolveNodeRef(allNodes.filter((n) => wsIds.has(n.workspaceId)), nodeRef);
  }
  const local = resolveNodeRef(allNodes.filter((n) => n.workspaceId === localWorkspaceId), nodeRef);
  if (local.ok || local.error.code === "CONFLICT") return local;
  const connPeers = allNodes.filter((n) => connectedNodeIds.has(n.nodeId));
  const peerHit = resolveNodeRef(connPeers, nodeRef);
  if (peerHit.ok || peerHit.error.code === "CONFLICT") return peerHit;
  return resolveNodeRef(allNodes, nodeRef);
}


/** Texto do papel como o agente recebe. */
export const roleText = (role: { name: string; instructions: string }): string =>
  `Sua responsabilidade neste terminal: ${role.name}.\n${role.instructions.trim()}`;

/** #57 Texto das habilidades anexadas (vai para o system prompt do Claude Code e para MESS_SKILLS_TEXT). */
export const skillsText = (skills: { name: string; instructions: string }[]): string =>
  skills.length ? `Habilidades anexadas a este terminal:\n\n${skills.map((s) => `## ${s.name}\n${s.instructions.trim()}`).join("\n\n")}` : "";
/** Injeta as habilidades na linha de comando como o papel (só Claude Code aceita system prompt); acumula no mesmo --append-system-prompt. */
export function applySkills(command: string, args: string[], skills: { name: string; instructions: string }[]): string[] {
  if (!skills.length) return args;
  if (command.split("/").pop() !== "claude") return args;
  const i = args.indexOf("--append-system-prompt");
  const text = skillsText(skills);
  if (i >= 0 && i + 1 < args.length) return args.map((a, j) => (j === i + 1 ? `${a}\n\n${text}` : a));
  return [...args, "--append-system-prompt", text];
}

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
/** #81 Pastas pesadas/geradas excluídas por padrão ao clonar um andar como cópia isolada. */
export const DEFAULT_FLOOR_EXCLUDES = ["node_modules", "target", "dist", "build", ".next", ".venv", "__pycache__", ".cache", ".turbo", "coverage"] as const;
export function normalizeFloorExcludes(list: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of list) {
    const clean = raw.trim().replace(/^[/\\]+|[/\\]+$/g, "");
    if (clean && clean !== ".git" && !clean.includes("..") && !out.includes(clean)) out.push(clean);
  }
  return out;
}
export function shouldExcludeFloorDir(relPath: string, name: string, excludes: ReadonlySet<string>): boolean {
  return excludes.has(name) || excludes.has(relPath);
}
// #31 — Pull request nos andares (+ hosts Git configuráveis)
export type ParsedGitRemote = { host: string; repoSlug: string; kind: GitHostKind; prUrlTemplate?: string };
export function parseGitRemote(remoteUrl: string, customHosts: readonly GitHostEntry[] = []): ParsedGitRemote | null {
  const u = remoteUrl.trim();
  if (!u || u.startsWith("/") || u.startsWith(".")) return null;
  let host = "";
  let repoSlug = "";
  const httpMatch = /^https?:\/\/(?:[^@]+@)?([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(u);
  const sshUrlMatch = /^ssh:\/\/(?:[^@]+@)?([^/:]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/.exec(u);
  const scpMatch = /^(?:[^@/]+@)?([^:/]+):(.+?)(?:\.git)?\/?$/.exec(u);
  if (httpMatch) {
    host = httpMatch[1]!.toLowerCase();
    repoSlug = httpMatch[2]!;
  } else if (sshUrlMatch) {
    host = sshUrlMatch[1]!.toLowerCase();
    repoSlug = sshUrlMatch[2]!;
  } else if (scpMatch) {
    host = scpMatch[1]!.toLowerCase();
    repoSlug = scpMatch[2]!;
  } else {
    return null;
  }
  const custom = customHosts.find((h) => h.host.toLowerCase() === host);
  if (custom) {
    return { host, repoSlug, kind: custom.kind, ...(custom.prUrlTemplate ? { prUrlTemplate: custom.prUrlTemplate } : {}) };
  }
  let kind: GitHostKind = "github";
  if (host.includes("gitlab")) kind = "gitlab";
  else if (host.includes("gitea") || host.includes("codeberg") || host.includes("forgejo")) kind = "gitea";
  return { host, repoSlug, kind };
}
export function buildPrCompareUrl(input: {
  host: string;
  repoSlug: string;
  kind: GitHostKind;
  baseBranch: string;
  headBranch: string;
  title?: string | undefined;
  body?: string | undefined;
  customTemplate?: string | undefined;
}): string {
  const { host, repoSlug, kind, baseBranch, headBranch, title, body, customTemplate } = input;
  const base = encodeURIComponent(baseBranch);
  const head = encodeURIComponent(headBranch);
  if (customTemplate && customTemplate.trim()) {
    return customTemplate
      .replace(/\{host\}/g, host)
      .replace(/\{repo\}/g, repoSlug)
      .replace(/\{base\}/g, base)
      .replace(/\{head\}/g, head)
      .replace(/\{title\}/g, encodeURIComponent(title ?? ""))
      .replace(/\{body\}/g, encodeURIComponent(body ?? ""));
  }
  if (kind === "gitlab") {
    const q = new URLSearchParams({ "merge_request[source_branch]": headBranch, "merge_request[target_branch]": baseBranch });
    if (title) q.set("merge_request[title]", title);
    if (body) q.set("merge_request[description]", body);
    return `https://${host}/${repoSlug}/-/merge_requests/new?${q.toString()}`;
  }
  if (kind === "gitea") {
    return `https://${host}/${repoSlug}/compare/${base}...${head}`;
  }
  const q = new URLSearchParams({ expand: "1" });
  if (title) q.set("title", title);
  if (body) q.set("body", body);
  return `https://${host}/${repoSlug}/compare/${base}...${head}?${q.toString()}`;
}


// ---------- árvore de arquivos ----------
/** Normaliza um caminho relativo e recusa qualquer tentativa de sair da raiz. */
export function safeRelPath(rel: string): Result<string> {
  if (rel.startsWith("/") || /^[A-Za-z]:[\\/]/.test(rel) || rel.includes("\0")) return fail("INVALID", "caminho precisa ser relativo ao espaço");
  const parts: string[] = [];
  for (const p of rel.split(/[\\/]+/)) { if (p === "" || p === ".") continue; if (p === "..") { if (!parts.length) return fail("INVALID", "caminho fora do espaço"); parts.pop(); continue; } parts.push(p); }
  return succeed(parts.join("/"));
}

/**
 * #86 [MESS-01] Verifica se `realTarget` está estritamente dentro de `realRoot` (ou é o próprio `realRoot`)
 * comparando por componentes de caminho (evita falso-positivo de `startsWith` como `/tmp/ws` vs `/tmp/ws2`).
 */
export function isWithinCanonicalRoot(realRoot: string, realTarget: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
  const r = norm(realRoot);
  const t = norm(realTarget);
  if (r === "/") return t.startsWith("/");
  if (t === r) return true;
  const rParts = r.split("/");
  const tParts = t.split("/");
  if (tParts.length < rParts.length) return false;
  for (let i = 0; i < rParts.length; i++) {
    if (rParts[i] !== tParts[i]) return false;
  }
  return true;
}
/** Conteúdo parece binário? (NUL nos primeiros bytes) */
export const looksBinary = (head: Uint8Array): boolean => head.subarray(0, 8000).includes(0);

// ---------- #78 grupos de nós + encaixe magnético ----------
/** Caixa que envolve as geometrias (com folga). */
export function groupBounds(geoms: Geometry[], pad = 16): Geometry | null {
  if (!geoms.length) return null;
  const x1 = Math.min(...geoms.map((g) => g.x)) - pad, y1 = Math.min(...geoms.map((g) => g.y)) - pad;
  const x2 = Math.max(...geoms.map((g) => g.x + g.w)) + pad, y2 = Math.max(...geoms.map((g) => g.y + g.h)) + pad;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}
export type SnapResult = { x: number; y: number; guides: { vertical: number[]; horizontal: number[] } };
/**
 * Encaixe magnético: aproxima a geometria em movimento das bordas/centros dos vizinhos e da grade quando a
 * distância for menor que `threshold` (em unidades do canvas). Devolve a posição ajustada e as linhas-guia.
 */
export function snapGeometry(moving: Geometry, others: Geometry[], opt: { threshold?: number; grid?: number } = {}): SnapResult {
  const th = opt.threshold ?? 8; const grid = opt.grid ?? 0;
  // Bordas encaixam em bordas e centros em centros (nunca centro em borda: seria surpreendente e disputa com o encaixe de borda).
  const ex: number[] = [], cx: number[] = [], ey: number[] = [], cy: number[] = [];
  for (const o of others) { ex.push(o.x, o.x + o.w); cx.push(o.x + o.w / 2); ey.push(o.y, o.y + o.h); cy.push(o.y + o.h / 2); }
  const best = (pairs: [own: number, targets: number[]][], gridAnchor: number): { delta: number; line: number } | null => {
    let b: { delta: number; line: number } | null = null;
    for (const [a, targets] of pairs) for (const t of targets) { const d = t - a; if (Math.abs(d) <= th && (!b || Math.abs(d) < Math.abs(b.delta))) b = { delta: d, line: t }; }
    if (!b && grid > 0) { const t = Math.round(gridAnchor / grid) * grid; const d = t - gridAnchor; if (Math.abs(d) <= th) b = { delta: d, line: t }; }
    return b;
  };
  const sx = best([[moving.x, ex], [moving.x + moving.w, ex], [moving.x + moving.w / 2, cx]], moving.x);
  const sy = best([[moving.y, ey], [moving.y + moving.h, ey], [moving.y + moving.h / 2, cy]], moving.y);
  return { x: moving.x + (sx?.delta ?? 0), y: moving.y + (sy?.delta ?? 0), guides: { vertical: sx ? [sx.line] : [], horizontal: sy ? [sy.line] : [] } };
}

// ---------- #71 partituras ----------
/** Move um arranjo para que o canto superior esquerdo fique em `at`, preservando posições relativas. */
export function placeGeometries(items: { key: string; geometry: Geometry }[], at: { x: number; y: number }): Map<string, Geometry> {
  const out = new Map<string, Geometry>(); if (!items.length) return out;
  const minX = Math.min(...items.map((i) => i.geometry.x)), minY = Math.min(...items.map((i) => i.geometry.y));
  for (const i of items) out.set(i.key, normalizeGeometry({ ...i.geometry, x: Math.round(at.x + i.geometry.x - minX), y: Math.round(at.y + i.geometry.y - minY) }));
  return out;
}
/** Conexões que ficam inteiras dentro do conjunto (as pontas precisam estar na partitura). */
export function connectionsWithin<T extends { sourceNodeId: string; targetNodeId: string }>(conns: T[], ids: Set<string>): T[] {
  return conns.filter((c) => ids.has(c.sourceNodeId) && ids.has(c.targetNodeId));
}

// ---------- #74 fichários: várias páginas (notas) num nó, com aba ativa e cor uniforme ----------
export type BinderPage = { id: string; title: string; content: string };
export type Binder = { pages: BinderPage[]; active: string; color: string };
export const emptyBinder = (): Binder => ({ pages: [{ id: "p1", title: "Página 1", content: "" }], active: "p1", color: "" });
/** Conteúdo salvo → fichário válido (sempre ≥1 página e `active` existente); lixo vira um fichário vazio. */
export function parseBinder(raw: string | null | undefined): Binder {
  try {
    const j = JSON.parse(raw ?? "") as Partial<Binder>;
    const pages = (Array.isArray(j.pages) ? j.pages : []).filter((p): p is BinderPage => !!p && typeof p.id === "string" && typeof p.title === "string" && typeof p.content === "string");
    if (!pages.length) return emptyBinder();
    return { pages, active: pages.some((p) => p.id === j.active) ? (j.active as string) : pages[0]!.id, color: typeof j.color === "string" ? j.color : "" };
  } catch { return emptyBinder(); }
}
export const serializeBinder = (b: Binder): string => JSON.stringify(b);
const nextPageId = (b: Binder): string => { let n = b.pages.length + 1; while (b.pages.some((p) => p.id === `p${n}`)) n++; return `p${n}`; };
export function binderAddPage(b: Binder, page?: { title?: string; content?: string }): Binder {
  const id = nextPageId(b);
  return { ...b, pages: [...b.pages, { id, title: page?.title?.trim() || `Página ${b.pages.length + 1}`, content: page?.content ?? "" }], active: id };
}
export function binderSetActive(b: Binder, id: string): Binder { return b.pages.some((p) => p.id === id) ? { ...b, active: id } : b; }
export function binderPatchPage(b: Binder, id: string, patch: Partial<Pick<BinderPage, "title" | "content">>): Binder { return { ...b, pages: b.pages.map((p) => (p.id === id ? { ...p, ...patch } : p)) }; }
/** Tira uma página (spill). Com 1 página só não dá (o fichário não fica vazio): devolve null. */
export function binderRemovePage(b: Binder, id: string): { binder: Binder; page: BinderPage } | null {
  const page = b.pages.find((p) => p.id === id); if (!page || b.pages.length <= 1) return null;
  const pages = b.pages.filter((p) => p.id !== id);
  return { binder: { ...b, pages, active: b.active === id ? pages[Math.min(b.pages.indexOf(page), pages.length - 1)]!.id : b.active }, page };
}
/** Move a página para frente (primeira posição) e a ativa. */
export function binderBringToFront(b: Binder, id: string): Binder { const p = b.pages.find((x) => x.id === id); return p ? { ...b, pages: [p, ...b.pages.filter((x) => x.id !== id)], active: id } : b; }

// ---------- #72 Ambientes: variáveis de ambiente por espaço/global ----------
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SECRET_KEY_RE = /SECRET|TOKEN|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY|AUTH|CREDENTIAL|BEARER/i;

export function isLikelySecretKey(key: string): boolean {
  return SECRET_KEY_RE.test(key);
}

/** Valida e normaliza a lista de variáveis de ambiente (rejeita chaves inválidas e prefixo reservado MESS_). */
export function normalizeEnvVars(vars: readonly EnvVarEntry[]): Result<EnvVarEntry[]> {
  const byKey = new Map<string, EnvVarEntry>();
  for (const item of vars) {
    const key = item.key.trim();
    if (!key) continue;
    if (!ENV_KEY_RE.test(key)) return fail("INVALID", `nome de variável inválido: "${key}" (use letras, números e _)`);
    if (/^MESS_/i.test(key)) return fail("INVALID", `variáveis iniciadas por MESS_ são reservadas pelo runtime: "${key}"`);
    const secret = item.secret ?? isLikelySecretKey(key);
    byKey.set(key, { key, value: item.value, ...(secret ? { secret: true } : {}) });
  }
  return succeed([...byKey.values()]);
}

/** Mescla camadas de variáveis de ambiente em ordem crescente de precedência (ex.: global -> térreo -> andar). */
export function mergeEnvLayers(...layers: (readonly EnvVarEntry[] | undefined)[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const layer of layers) {
    if (!layer) continue;
    for (const v of layer) {
      if (v.key && !/^MESS_/i.test(v.key)) out[v.key] = v.value;
    }
  }
  return out;
}

/** Extrai pares KEY=VALUE de texto estilo `.env` (ignora comentários `#` e `export `). */
export function parseDotEnv(raw: string): EnvVarEntry[] {
  const out: EnvVarEntry[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const body = t.startsWith("export ") ? t.slice(7).trim() : t;
    const eq = body.indexOf("=");
    if (eq <= 0) continue;
    const key = body.slice(0, eq).trim();
    if (!ENV_KEY_RE.test(key) || /^MESS_/i.test(key)) continue;
    let value = body.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out.push({ key, value, ...(isLikelySecretKey(key) ? { secret: true } : {}) });
  }
  return out;
}

// ---------- #93 [MESS-09] modo isolado: bubblewrap (namespaces + raiz vazia) ----------
export type NodeIsolationProfile = { network: "none" | "host"; ro?: string[] | undefined; rw?: string[] | undefined; memoryMaxMb?: number | undefined; tasksMax?: number | undefined };
export type IsolationContext = {
  cwd: string; home: string;
  /** Diretórios de sistema que existem na máquina e entram SOMENTE LEITURA (ex.: /usr /etc /opt). */
  systemDirs: string[];
  /** Links de nível raiz típicos de distros "usr-merged": [alvo, caminho] (ex.: ["usr/bin", "/bin"]). */
  systemLinks: [target: string, path: string][];
  /** Já resolvidos e existentes: somente leitura / gravável (inclui o necessário para achar o binário, o CLI `mess` e o socket). */
  roPaths: string[]; rwPaths: string[];
  /** Montados SOMENTE LEITURA por cima dos graváveis (ex.: .git/hooks e .git/config do projeto: onde um agente plantaria código que o usuário executaria fora do sandbox). */
  protect?: string[] | undefined;
  /** Arquivo real para /etc/resolv.conf quando a rede é do host (o link original aponta para /run, que não existe no sandbox). */
  resolvConf?: string | undefined;
  /** Onde montar o `resolvConf` dentro do sandbox: se /etc/resolv.conf é um link, o bwrap não monta SOBRE ele — monta no alvo do link (padrão: /etc/resolv.conf). */
  resolvDest?: string | undefined;
  /** Ambiente completo e JÁ LIMPO do processo; nada além disto existe lá dentro. */
  env: Record<string, string>;
  /** Há systemd de usuário com cgroups? Só então os limites duros são aplicados. */
  cgroupScope?: boolean | undefined;
  /** Variáveis que o processo EXTERNO precisa (systemd-run --user exige XDG_RUNTIME_DIR / DBUS_SESSION_BUS_ADDRESS); nunca entram no sandbox. */
  outerEnv?: Record<string, string> | undefined;
};
const uniq = (a: string[]) => [...new Set(a)];
/** Remove caminhos aninhados redundantes (bind do pai já cobre o filho, salvo se o filho for gravável dentro de pai somente leitura). */
export function isolationMounts(ctx: IsolationContext): { ro: string[]; rw: string[] } {
  const rw = uniq([ctx.cwd, ...ctx.rwPaths]);
  const ro = uniq(ctx.roPaths).filter((p) => !rw.includes(p));
  return { ro, rw };
}
/**
 * Embrulha o plano do terminal em `bwrap`. O sandbox começa VAZIO (tmpfs) e só recebe: sistema somente leitura, `ro`, `rw` (cwd + extras),
 * /proc, /dev, /tmp novo e um $HOME vazio. Sem rede por padrão do perfil escolhido; todas as capacidades Linux são descartadas.
 * Retorna um plano que pode ser embrulhado de novo em tmux (a ordem é tmux(bwrap(cmd))).
 */
export function bwrapPlan(plan: TerminalPlan, iso: NodeIsolationProfile, ctx: IsolationContext): TerminalPlan {
  const a: string[] = ["--die-with-parent", "--unshare-user", "--unshare-ipc", "--unshare-pid", "--unshare-uts", "--unshare-cgroup-try", "--cap-drop", "ALL"];
  if (iso.network === "none") a.push("--unshare-net");
  for (const [target, path] of ctx.systemLinks) a.push("--symlink", target, path);
  for (const d of ctx.systemDirs) a.push("--ro-bind", d, d);
  if (iso.network === "host" && ctx.resolvConf) a.push("--ro-bind", ctx.resolvConf, ctx.resolvDest ?? "/etc/resolv.conf");
  a.push("--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp", "--dir", ctx.home);
  const { ro, rw } = isolationMounts(ctx);
  for (const p of ro) a.push("--ro-bind", p, p);
  for (const p of rw) a.push("--bind", p, p);
  for (const p of ctx.protect ?? []) a.push("--ro-bind", p, p);
  a.push("--clearenv");
  for (const [k, v] of Object.entries({ ...ctx.env, HOME: ctx.home })) a.push("--setenv", k, v);
  a.push("--chdir", ctx.cwd, "--", plan.command, ...plan.args);
  const outerEnv: Record<string, string> = { PATH: ctx.env["PATH"] ?? "/usr/bin:/bin", HOME: ctx.home, TERM: plan.env["TERM"] ?? "xterm-256color", ...(ctx.outerEnv ?? {}) };
  if (iso.memoryMaxMb || iso.tasksMax) {
    if (!ctx.cgroupScope) return { ...plan, command: "bwrap", args: a, env: outerEnv };
    const lim = [...(iso.memoryMaxMb ? ["-p", `MemoryMax=${iso.memoryMaxMb}M`, "-p", "MemorySwapMax=0"] : []), ...(iso.tasksMax ? ["-p", `TasksMax=${iso.tasksMax}`] : [])];
    return { ...plan, command: "systemd-run", args: ["--user", "--scope", "--quiet", ...lim, "--", "bwrap", ...a], env: { ...outerEnv, ...(ctx.outerEnv ?? {}) } };
  }
  return { ...plan, command: "bwrap", args: a, env: outerEnv };
}
/** Perfil efetivo = o do nó + caminhos globais; normaliza `~` e remove duplicatas. */
export function expandHome(p: string, home: string): string { return p === "~" ? home : p.startsWith("~/") ? home + p.slice(1) : p; }
/** Ambiente mínimo de um terminal isolado: nada herdado do runtime além do estritamente seguro (sem chaves/tokens do shell do usuário). */
export const ISOLATED_ENV_ALLOW = ["PATH", "LANG", "LANGUAGE", "LC_ALL", "LC_CTYPE", "LC_MESSAGES", "TZ", "TERM", "COLORTERM", "TERMINFO", "TERMINFO_DIRS"] as const;
export function scrubEnv(base: Record<string, string>, inject: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ISOLATED_ENV_ALLOW) if (base[k] !== undefined) out[k] = base[k]!;
  return { ...out, ...inject, TERM: "xterm-256color" };
}

/**
 * Valida/normaliza um perfil de isolamento vindo do usuário: caminhos absolutos (ou ~), sem `..`, e NUNCA a raiz, o $HOME inteiro
 * nem um ancestral do $HOME (isso reexporia tudo o que o modo isolado existe para esconder).
 */
export function validateIsolation(iso: NodeIsolationProfile, home: string): Result<NodeIsolationProfile> {
  const norm = (list: string[] | undefined, what: string): Result<string[]> => {
    const out: string[] = [];
    for (const raw of list ?? []) {
      const p = expandHome(raw.trim(), home).replace(/\/+$/, "") || "/";
      if (!p.startsWith("/")) return fail("INVALID", `${what}: "${raw}" precisa ser caminho absoluto (ou começar com ~/)`);
      if (p.split("/").includes("..")) return fail("INVALID", `${what}: "${raw}" não pode conter ".."`);
      if (p === "/" || p === home || home.startsWith(p + "/")) return fail("INVALID", `${what}: "${raw}" exporia o sistema ou o home inteiro — escolha uma subpasta específica`);
      if (!out.includes(p)) out.push(p);
    }
    return succeed(out);
  };
  const ro = norm(iso.ro, "somente leitura"); if (!ro.ok) return ro;
  const rw = norm(iso.rw, "gravável"); if (!rw.ok) return rw;
  return succeed({ network: iso.network, ...(ro.value.length ? { ro: ro.value } : {}), ...(rw.value.length ? { rw: rw.value } : {}), ...(iso.memoryMaxMb ? { memoryMaxMb: iso.memoryMaxMb } : {}), ...(iso.tasksMax ? { tasksMax: iso.tasksMax } : {}) });
}
/** Capacidades de um agente ISOLADO por padrão: nada que execute código fora do sandbox (sem hooks/rotinas, sem terminais, sem Maestro). */
export const ISOLATED_DEFAULT_CAPS = ["files:read", "files:write", "chat:post", "nodes:read", "messages:send"] as const;
/** O que o usuário pode conceder a um agente isolado por pedido de aprovação — nunca o que viabiliza execução fora do sandbox. */
export const ISOLATED_APPROVABLE_CAPS = ["nodes:write", "messages:send", "nodes:read", "chat:post", "files:read", "files:write"] as const;

