// Regras puras. Proibido importar fs, net, pty, banco (ADR-0009).
import type { ApiError, Connection, ErrorCode, Geometry, Node, Session, Workspace } from "@messyai/contracts";

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
  return linked ? succeed(undefined) : fail("FORBIDDEN", "os nós não estão conectados; ligue-os no canvas ou use `messy connect`");
}

/** Texto entregue no terminal de destino. Uma linha de cabeçalho e o corpo; termina com Enter. */
export function formatDelivery(m: { messageId: string; fromTitle: string; text: string; replyTo?: string | undefined }): string {
  const head = m.replyTo
    ? `[MessyAI] Resposta de "${m.fromTitle}" (${m.messageId.slice(0, 8)}):`
    : `[MessyAI] Mensagem de "${m.fromTitle}" (${m.messageId.slice(0, 8)}). Para responder: messy reply ${m.messageId.slice(0, 8)} "texto"`;
  return `${head}\n${m.text.replace(/\r?\n/g, " ")}\r`;
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
export const tmuxSessionName = (sessionId: string): string => `messy-${sessionId.slice(0, 12)}`;
/** Aspas simples POSIX para montar o comando que o tmux executa. */
export const shellQuote = (a: string): string => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`);
/** Plano equivalente rodando dentro do tmux: cria (ou reanexa, -A) a sessão com o comando e o ambiente injetado; o status bar fica desligado. */
export function wrapInTmux(plan: TerminalPlan, name: string, inject: Record<string, string>, socket = "messy"): TerminalPlan {
  const cmd = [plan.command, ...plan.args].map(shellQuote).join(" ");
  const envFlags = Object.entries(inject).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
  return { ...plan, command: "tmux", args: ["-L", socket, "new-session", "-A", "-s", name, "-c", plan.cwd, ...envFlags, cmd, ";", "set-option", "-t", name, "status", "off"] };
}
export const tmuxAttachPlan = (plan: TerminalPlan, name: string, socket = "messy"): TerminalPlan => ({ ...plan, command: "tmux", args: ["-L", socket, "attach-session", "-t", name] });


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
