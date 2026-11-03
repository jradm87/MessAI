// #87 [MESS-02] — Autorização por capacidade para credenciais de agente.
// O token mestre (desktop) faz tudo; o token de agente só o que a rota exige e o escopo permite.
import type { AgentCapability } from "@messai/contracts";

/**
 * Escopo do `:id` da rota para um agente:
 * - `ws`: espaço do mesmo térreo (térreo + andares) que o agente
 * - `node`: nó de um espaço desse térreo
 * - `self`: o próprio nó do agente (falar/conduzir em nome de outro nó é proibido)
 * - `session`: sessão de um nó desse térreo
 * - `floor`: só andares (nunca o térreo) desse térreo
 */
export type AgentScope = "ws" | "node" | "self" | "session" | "floor";
export type RouteAccess = { desktopOnly: true } | { desktopOnly?: false; cap: AgentCapability; scope?: AgentScope };

type Rule = [method: string, url: string, access: RouteAccess];
const D: RouteAccess = { desktopOnly: true };
const r = (cap: AgentCapability, scope?: AgentScope): RouteAccess => (scope ? { cap, scope } : { cap });

const RULES: Rule[] = [
  // ---- só o desktop (administração da máquina e segredos globais) ----
  ["*", "/v1/shutdown", D],
  ["*", "/v1/data", D], ["*", "/v1/data/backup", D], ["*", "/v1/data/backups/:name", D], ["*", "/v1/data/restore", D], ["*", "/v1/data/move", D], ["*", "/v1/data/reset", D],
  ["*", "/v1/settings", D],
  ["*", "/v1/environments", D], ["*", "/v1/environments/global", D],
  ["PUT", "/v1/git-hosts", D],
  ["PUT", "/v1/presets", D], ["POST", "/v1/presets/reset", D],
  ["*", "/v1/nodes/:id/token", D],
  ["GET", "/v1/approvals", D], ["POST", "/v1/approvals/:id/decide", D], // #93 só o humano lista e decide pedidos
  ["*", "/v1/ws", D], // WebSocket digita em QUALQUER terminal: só o cliente
  ["POST", "/v1/workspaces/import", D],
  ["POST", "/v1/workspaces/import/preview", { cap: "nodes:read" }],
  ["POST", "/v1/roles/discover", D], ["POST", "/v1/roles/:id/export", D], // leem/escrevem pastas arbitrárias

  // ---- arquivos ----
  ["GET", "/v1/workspaces/:id/tree", r("files:read", "ws")],
  ["GET", "/v1/workspaces/:id/file", r("files:read", "ws")],
  ["GET", "/v1/workspaces/:id/search", r("files:read", "ws")],
  ["GET", "/v1/workspaces/:id/instructions", r("files:read", "ws")],
  ["GET", "/v1/nodes/:id/files", r("files:read", "node")],
  ["GET", "/v1/chat-attachments/:id/raw", r("files:read")],
  ["POST", "/v1/workspaces/:id/fs", r("files:write", "ws")],
  ["PUT", "/v1/workspaces/:id/instructions", r("files:write", "ws")],
  ["POST", "/v1/workspaces/:id/instructions/sync", r("files:write", "ws")],
  ["POST", "/v1/workspaces/:id/attachments", r("files:write", "ws")],
  ["POST", "/v1/chat-attachments/:id/export", r("files:write")],
  ["DELETE", "/v1/chat-attachments/:id", r("files:write")],

  // ---- #93 o agente PEDE uma capacidade (e acompanha o próprio pedido) ----
  ["POST", "/v1/approvals", r("nodes:read")],
  ["GET", "/v1/approvals/:id", r("nodes:read")],

  // ---- chat do próprio terminal ----
  ["POST", "/v1/nodes/:id/chat", r("chat:post", "self")],
  ["DELETE", "/v1/nodes/:id/chat", r("chat:post", "self")],

  // ---- mensagens entre agentes (sempre em nome de si mesmo) ----
  ["POST", "/v1/nodes/:id/messages", r("messages:send", "self")],
  ["POST", "/v1/nodes/:id/ask", r("messages:send", "self")],
  ["GET", "/v1/nodes/:id/check", r("messages:send", "self")],
  ["GET", "/v1/nodes/:id/inbox", r("nodes:read", "self")],
  ["POST", "/v1/bands/:id/ask", r("messages:send")],
  ["POST", "/v1/bands/:id/broadcast", r("messages:send")],
  ["POST", "/v1/notify", r("messages:send")],

  // ---- controle de terminais ----
  ["POST", "/v1/sessions/:id/stop", r("terminal:control", "session")],
  ["POST", "/v1/sessions/:id/procs/kill", r("terminal:control", "session")],
  ["POST", "/v1/nodes/:id/restart", r("terminal:control", "node")],
  ["POST", "/v1/nodes/:id/unload", r("terminal:control", "node")],
  ["POST", "/v1/nodes/:id/reload", r("terminal:control", "node")],
  ["POST", "/v1/workspaces/:id/unload", r("terminal:control", "ws")],
  ["POST", "/v1/workspaces/:id/reload", r("terminal:control", "ws")],

  // ---- Modo Maestro ----
  ["POST", "/v1/nodes/:id/maestro/recruit", r("maestro:conduct", "self")],
  ["POST", "/v1/nodes/:id/maestro/dismiss", r("maestro:conduct", "self")],
  ["POST", "/v1/nodes/:id/maestro/assign", r("maestro:conduct", "self")],

  // ---- canvas (nós, conexões, desenhos, grupos, bandas, partituras) ----
  ["POST", "/v1/workspaces/:id/nodes", r("nodes:write", "ws")],
  ["PATCH", "/v1/nodes/:id", r("nodes:write", "node")],
  ["DELETE", "/v1/nodes/:id", r("nodes:write", "node")],
  ["POST", "/v1/nodes/:id/duplicate", r("nodes:write", "node")],
  ["POST", "/v1/nodes/:id/seen", r("nodes:write", "node")],
  ["POST", "/v1/workspaces/:id/layout", r("nodes:write", "ws")],
  ["POST", "/v1/workspaces/:id/drawings", r("nodes:write", "ws")],
  ["POST", "/v1/workspaces/:id/drawings/group", r("nodes:write", "ws")],
  ["PATCH", "/v1/drawings/:id", r("nodes:write")],
  ["DELETE", "/v1/drawings/:id", r("nodes:write")],
  ["POST", "/v1/workspaces/:id/connections", r("nodes:write", "ws")],
  ["PATCH", "/v1/connections/:id", r("nodes:write")],
  ["DELETE", "/v1/connections/:id", r("nodes:write")],
  ["POST", "/v1/workspaces/:id/groups", r("nodes:write", "ws")],
  ["PATCH", "/v1/groups/:id", r("nodes:write")],
  ["DELETE", "/v1/groups/:id", r("nodes:write")],
  ["POST", "/v1/workspaces/:id/bands", r("nodes:write", "ws")],
  ["PATCH", "/v1/bands/:id", r("nodes:write")],
  ["DELETE", "/v1/bands/:id", r("nodes:write")],
  ["POST", "/v1/workspaces/:id/scores", r("nodes:write", "ws")],
  ["POST", "/v1/workspaces/:id/scores/:scoreId/place", r("nodes:write", "ws")],
  ["PATCH", "/v1/scores/:id", r("nodes:write")],
  ["DELETE", "/v1/scores/:id", r("nodes:write")],

  // ---- gestão do espaço/andares ----
  ["POST", "/v1/workspaces", r("workspace:manage")],
  ["PATCH", "/v1/workspaces/:id", r("workspace:manage", "ws")],
  ["DELETE", "/v1/workspaces/:id", r("workspace:manage", "floor")], // apagar o térreo é só do desktop
  ["POST", "/v1/workspaces/:id/duplicate", r("workspace:manage", "ws")],
  ["POST", "/v1/workspaces/:id/floors", r("workspace:manage", "ws")],
  ["POST", "/v1/workspaces/:id/floors/cancel", r("workspace:manage", "ws")],
  ["PUT", "/v1/workspaces/:id/floor-copy-info", r("workspace:manage", "ws")],
  ["POST", "/v1/workspaces/:id/land", r("workspace:manage", "floor")],
  ["PUT", "/v1/workspaces/:id/hooks", r("workspace:manage", "ws")],
  ["POST", "/v1/workspaces/:id/hooks/run", r("workspace:manage", "ws")],
  ["POST", "/v1/workspaces/:id/hooks/stop", r("workspace:manage", "ws")],
  ["POST", "/v1/workspaces/:id/pr", r("workspace:manage", "ws")],
  ["PATCH", "/v1/workspaces/:id/pr", r("workspace:manage", "ws")],
  ["PUT", "/v1/workspaces/:id/env", r("workspace:manage", "ws")],
  ["GET", "/v1/workspaces/:id/env", r("workspace:manage", "ws")],
  ["POST", "/v1/workspaces/:id/routines", r("workspace:manage", "ws")],
  ["PATCH", "/v1/routines/:id", r("workspace:manage")],
  ["DELETE", "/v1/routines/:id", r("workspace:manage")],
  ["POST", "/v1/routines/:id/run", r("workspace:manage")],
  ["POST", "/v1/folders", r("workspace:manage")],
  ["PATCH", "/v1/folders/:id", r("workspace:manage")],
  ["DELETE", "/v1/folders/:id", r("workspace:manage")],
  ["POST", "/v1/roles", r("workspace:manage")],
  ["PATCH", "/v1/roles/:id", r("workspace:manage")],
  ["DELETE", "/v1/roles/:id", r("workspace:manage")],
  ["POST", "/v1/skills", r("workspace:manage")],
  ["PATCH", "/v1/skills/:id", r("workspace:manage")],
  ["DELETE", "/v1/skills/:id", r("workspace:manage")],
  ["POST", "/v1/companion/summarize", r("nodes:read")],

  // ---- leituras com escopo ----
  ["GET", "/v1/workspaces/:id", r("nodes:read", "ws")],
  ["GET", "/v1/workspaces/:id/export", r("nodes:read", "ws")],
  ["GET", "/v1/sessions/:id", r("nodes:read", "session")],
  ["GET", "/v1/sessions/:id/procs", r("nodes:read", "session")],
];

const INDEX = new Map<string, RouteAccess>();
for (const [m, u, a] of RULES) INDEX.set(`${m} ${u}`, a);

/** Exigência de uma rota (pelo padrão registrado no Fastify). Leituras sem regra pedem `nodes:read`; escritas sem regra são só do desktop. */
export function routeAccess(method: string, routeUrl: string | undefined): RouteAccess {
  if (!routeUrl) return D;
  const m = method.toUpperCase();
  const hit = INDEX.get(`${m} ${routeUrl}`) ?? INDEX.get(`* ${routeUrl}`);
  if (hit) return hit;
  return m === "GET" || m === "HEAD" ? { cap: "nodes:read" } : D;
}
