import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import websocket from "@fastify/websocket";
import { Value } from "@sinclair/typebox/value";
import type { WebSocket } from "ws";
import {
  BUILD_VERSION, PROTOCOL_VERSION, SendMessage, Ask, CreateConnection, CreateDrawing, CreateNode, CreateWorkspace, DeleteNode, PatchNode, PatchWorkspace, ApplyLayout, WsClientMessage,
  type Capabilities, type WsServerMessage, type ApiError,
 CreateFolder, PatchFolder, CreateAttachment, SendChat, CreateRole, PatchRole, PatchConnection, PatchDrawing, GroupDrawings, CreateFloor, LandFloor, FsOp } from "@messai/contracts";
import type { Result } from "@messai/domain";
import { newId, type Config } from "./config.js";
import { accessSync, constants } from "node:fs";
import { delimiter, join as joinPath } from "node:path";
import type { WorkspaceService } from "./service.js";
import { SessionManager } from "./sessions.js";

const STATUS: Record<ApiError["code"], number> = {
  UNAUTHORIZED: 401, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409, INVALID: 400,
  UNSUPPORTED: 501, LEASE_HELD: 423, SESSION_NOT_RUNNING: 409, INTERNAL: 500,
};

function send<T>(reply: FastifyReply, r: Result<T>, okStatus = 200) {
  if (r.ok) return reply.status(okStatus).send(r.value);
  return reply.status(STATUS[r.error.code]).send({ error: r.error });
}

export function buildServer(cfg: Config, svc: WorkspaceService, opts: { unix: boolean; onShutdown?: (killAgents: boolean) => void }): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 40 * 1024 * 1024 });

  // Autenticação: token Bearer (ou ?token= para o WS do navegador). Origem só loopback/file.
  app.addHook("onRequest", async (req, reply) => {
    const origin = req.headers.origin;
    if (origin && !/^(https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?|file:\/\/|null)$/.test(origin) && !origin.startsWith("app://")) {
      return reply.status(403).send({ error: { code: "FORBIDDEN", message: "origem não permitida" } });
    }
    const auth = req.headers.authorization;
    const q = (req.query as Record<string, string | undefined>)["token"];
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : q;
    if (token !== cfg.token) return reply.status(401).send({ error: { code: "UNAUTHORIZED", message: "token inválido" } });
  });

  app.get("/v1/health", async () => ({ ok: true, protocolVersion: PROTOCOL_VERSION, buildVersion: BUILD_VERSION, machineId: cfg.machineId }));
  // Tela de encerramento do app: o que está rodando agora (terminais/agentes).
  app.get("/v1/running", async () => ({ sessions: svc.sessions.runningList() }));
  // Encerrar o runtime. killAgents=true mata também as sessões tmux (agentes); false mantém (reanexa no próximo boot).
  app.post<{ Body?: { killAgents?: boolean } }>("/v1/shutdown", async (req, reply) => {
    if (!opts.onShutdown) return reply.status(400).send({ error: { code: "INVALID", message: "shutdown indisponível neste servidor" } });
    const killAgents = !!(req.body && req.body.killAgents);
    reply.status(202).send({ ok: true, killAgents });
    setTimeout(() => opts.onShutdown!(killAgents), 50); // responde antes de sair
  });
  app.get("/v1/capabilities", async (): Promise<Capabilities> => ({
    protocolVersion: PROTOCOL_VERSION, machineId: cfg.machineId,
    features: ["workspaces", "folders", "sidebar", "files", "attachments", "chat", "roles", "notes.file", "notes.lock", "connections.style", "floors", "nodes.tree", ...(SessionManager.tmuxAvailable() ? ["terminal.tmux"] : []), "nodes.terminal", "nodes.note", "connections", "messages", "drawings", "nodes.text", "terminal.lease", "terminal.snapshot", opts.unix ? "agent.socket" : "client.http"],
  }));
  const AGENT_HINT = "Você está rodando dentro de um nó terminal do MessAI, um workspace visual para agentes. Outros nós (notas, terminais) podem estar conectados ao seu. Use o comando `mess context` para ver o espaço, seu nó e o conteúdo das notas conectadas; `mess note read <id|título>`, `mess note write <título> <texto>` (cria nota ligada a você), `mess connect <nodeId>`, `mess nodes`. Para falar com outro agente conectado: `mess peers` lista quem está ligado a você, `mess ask <nome> 'pergunta'` envia (chega como mensagem no terminal dele), `mess reply <id> 'texto'` responde, `mess inbox` mostra mensagens recebidas. Chat: quando uma mensagem do usuário vier marcada com [MessAI chat], responda também com `mess say 'sua resposta em Markdown'` (aparece em balões na tela); `mess chat` mostra o histórico do chat. Quando o usuário mencionar 'a nota conectada' ou 'a nota ligada', leia com `mess context`.";
  const PRESETS = [
    { id: "shell", label: "Shell", command: cfg.defaultShell, args: [] as string[] },
    { id: "claude", label: "Claude Code", command: "claude", args: ["--append-system-prompt", AGENT_HINT] },
    { id: "codex", label: "Codex", command: "codex", args: [] as string[] },
    { id: "opencode", label: "OpenCode", command: "opencode", args: [] as string[] },
    { id: "antigravity", label: "Antigravity", command: "agy", args: [] as string[] }, // o binário é `agy`
  ];
  const onPath = (cmd: string): boolean => {
    if (cmd.includes("/")) { try { accessSync(cmd, constants.X_OK); return true; } catch { return false; } }
    for (const dir of (process.env["PATH"] ?? "").split(delimiter)) { try { accessSync(joinPath(dir, cmd), constants.X_OK); return true; } catch { /* próximo */ } }
    return false;
  };
  app.get("/v1/agent-usage", async () => svc.agentUsage());
  app.get("/v1/presets", async () => PRESETS.map((p) => ({ ...p, available: onPath(p.command) })));
  app.get("/v1/machine", async () => ({ machineId: cfg.machineId, name: cfg.machineName, platform: cfg.platform, protocolVersion: PROTOCOL_VERSION }));

  const body = <T>(schema: Parameters<typeof Value.Check>[0], v: unknown): T | ApiError =>
    Value.Check(schema, v) ? (v as T) : { code: "INVALID", message: [...Value.Errors(schema, v)].map((e) => `${e.path} ${e.message}`).join("; ") };
  const invalid = (reply: FastifyReply, e: ApiError) => reply.status(400).send({ error: e });

  app.get("/v1/workspaces", async () => svc.listWorkspaces());
  app.post("/v1/workspaces", async (req, reply) => {
    const b = body<CreateWorkspace>(CreateWorkspace, req.body); if ("code" in b) return invalid(reply, b);
    return send(reply, svc.createWorkspace(b), 201);
  });
  app.get<{ Params: { id: string } }>("/v1/workspaces/:id", async (req, reply) => {
    const s = svc.snapshot(req.params.id);
    return s ? s : reply.status(404).send({ error: { code: "NOT_FOUND", message: "espaço não encontrado" } });
  });
  app.patch<{ Params: { id: string } }>("/v1/workspaces/:id", async (req, reply) => {
    const b = body<PatchWorkspace>(PatchWorkspace, req.body); if ("code" in b) return invalid(reply, b);
    return send(reply, svc.patchWorkspace(req.params.id, b));
  });
  app.delete<{ Params: { id: string }; Querystring: { deleteBranch?: string } }>("/v1/workspaces/:id", async (req, reply) => send(reply, svc.deleteWorkspace(req.params.id, { deleteBranch: req.query.deleteBranch === "1" }), 204));

  // árvore de arquivos
  app.get<{ Params: { id: string }; Querystring: { path?: string } }>("/v1/workspaces/:id/tree", async (req, reply) => send(reply, await svc.listTree(req.params.id, req.query.path ?? "")));
  app.get<{ Params: { id: string }; Querystring: { path?: string } }>("/v1/workspaces/:id/file", async (req, reply) => send(reply, svc.readFile(req.params.id, req.query.path ?? "")));
  app.post<{ Params: { id: string } }>("/v1/workspaces/:id/fs", async (req, reply) => { const b = body<FsOp>(FsOp, req.body); if ("code" in b) return invalid(reply, b); return send(reply, svc.fsOp(req.params.id, b)); });
  app.get<{ Params: { id: string }; Querystring: { q?: string; content?: string } }>("/v1/workspaces/:id/search", async (req, reply) => send(reply, await svc.searchFiles(req.params.id, req.query.q ?? "", req.query.content === "1")));

  // andares (floors)
  app.get<{ Params: { id: string } }>("/v1/workspaces/:id/floors", async (req, reply) => send(reply, svc.listFloors(req.params.id)));
  app.post<{ Params: { id: string } }>("/v1/workspaces/:id/floors", async (req, reply) => {
    const b = body<CreateFloor>(CreateFloor, req.body); if ("code" in b) return invalid(reply, b);
    return send(reply, svc.createFloor(req.params.id, b), 201);
  });
  app.post<{ Params: { id: string } }>("/v1/workspaces/:id/land", async (req, reply) => {
    const b = body<LandFloor>(LandFloor, req.body ?? {}); if ("code" in b) return invalid(reply, b);
    return send(reply, svc.landFloor(req.params.id, b));
  });

  // papéis (responsabilidades)
  app.get("/v1/roles", async () => svc.listRoles());
  app.post("/v1/roles", async (req, reply) => { const b = body<CreateRole>(CreateRole, req.body); if ("code" in b) return invalid(reply, b); return send(reply, svc.createRole(b), 201); });
  app.patch<{ Params: { id: string } }>("/v1/roles/:id", async (req, reply) => { const b = body<PatchRole>(PatchRole, req.body); if ("code" in b) return invalid(reply, b); return send(reply, svc.patchRole(req.params.id, b)); });
  app.delete<{ Params: { id: string } }>("/v1/roles/:id", async (req, reply) => send(reply, svc.deleteRole(req.params.id), 204));
  app.post<{ Body: { dir?: string } }>("/v1/roles/discover", async (req, reply) => {
    const dir = typeof req.body?.dir === "string" ? req.body.dir : ""; if (!dir) return invalid(reply, { code: "INVALID", message: "dir obrigatório" });
    return send(reply, svc.discoverRoles(dir));
  });
  app.post<{ Params: { id: string }; Body: { dir?: string } }>("/v1/roles/:id/export", async (req, reply) => {
    const dir = typeof req.body?.dir === "string" ? req.body.dir : ""; if (!dir) return invalid(reply, { code: "INVALID", message: "dir obrigatório" });
    return send(reply, svc.exportRole(req.params.id, dir));
  });

  // chat por terminal: humano posta pelo cliente (role user), agente pelo socket (role agent)
  app.get<{ Params: { id: string }; Querystring: { thread?: string; limit?: string; since?: string } }>("/v1/nodes/:id/chat", async (req, reply) =>
    send(reply, svc.listChat(req.params.id, req.query.thread ? Number(req.query.thread) : undefined, Math.min(500, Number(req.query.limit ?? 100) || 100), req.query.since)));
  app.post<{ Params: { id: string } }>("/v1/nodes/:id/chat", async (req, reply) => {
    const b = body<SendChat>(SendChat, req.body); if ("code" in b) return invalid(reply, b);
    return send(reply, svc.postChat(req.params.id, b, opts.unix ? "agent" : "user"), 201);
  });
  app.delete<{ Params: { id: string }; Querystring: { thread?: string } }>("/v1/nodes/:id/chat", async (req, reply) =>
    send(reply, svc.clearChat(req.params.id, req.query.thread ? Number(req.query.thread) : undefined)));

  // compositor: arquivos do diretório do nó (#) e anexos (clipe/colar)
  app.get<{ Params: { id: string }; Querystring: { q?: string; limit?: string } }>("/v1/nodes/:id/files", async (req, reply) =>
    send(reply, svc.listFiles(req.params.id, req.query.q ?? "", Math.min(200, Number(req.query.limit ?? 50) || 50))));
  app.post<{ Params: { id: string } }>("/v1/workspaces/:id/attachments", async (req, reply) => {
    const b = body<CreateAttachment>(CreateAttachment, req.body); if ("code" in b) return invalid(reply, b);
    return send(reply, svc.saveAttachment(req.params.id, b), 201);
  });

  // barra lateral: pastas/grupos + espaços + terminais vivos
  app.get("/v1/sidebar", async () => svc.sidebar());
  app.post("/v1/folders", async (req, reply) => {
    const b = body<CreateFolder>(CreateFolder, req.body); if ("code" in b) return invalid(reply, b);
    return send(reply, svc.createFolder(b), 201);
  });
  app.patch<{ Params: { id: string } }>("/v1/folders/:id", async (req, reply) => {
    const b = body<PatchFolder>(PatchFolder, req.body); if ("code" in b) return invalid(reply, b);
    return send(reply, svc.patchFolder(req.params.id, b));
  });
  app.delete<{ Params: { id: string } }>("/v1/folders/:id", async (req, reply) => send(reply, svc.deleteFolder(req.params.id), 204));

  app.post<{ Params: { id: string } }>("/v1/workspaces/:id/nodes", async (req, reply) => {
    const b = body<CreateNode>(CreateNode, req.body); if ("code" in b) return invalid(reply, b);
    return send(reply, svc.createNode(req.params.id, b), 201);
  });
  app.patch<{ Params: { id: string } }>("/v1/nodes/:id", async (req, reply) => {
    const b = body<PatchNode>(PatchNode, req.body); if ("code" in b) return invalid(reply, b);
    return send(reply, svc.patchNode(req.params.id, b, !!opts.unix));
  });
  app.delete<{ Params: { id: string } }>("/v1/nodes/:id", async (req, reply) => {
    const b = body<DeleteNode>(DeleteNode, req.body ?? {}); if ("code" in b) return invalid(reply, b);
    return send(reply, svc.deleteNode(req.params.id, b.expectedRevision), 204);
  });
  app.post<{ Params: { id: string } }>("/v1/nodes/:id/duplicate", async (req, reply) => {
    const b = body<DeleteNode>(DeleteNode, req.body ?? {}); if ("code" in b) return invalid(reply, b);
    return send(reply, svc.duplicateNode(req.params.id, b.expectedRevision), 201);
  });
  app.post<{ Params: { id: string } }>("/v1/workspaces/:id/layout", async (req, reply) => {
    const b = body<ApplyLayout>(ApplyLayout, req.body); if ("code" in b) return invalid(reply, b);
    return send(reply, svc.applyLayout(req.params.id, b.expectedRevision, b.moves));
  });
  app.post<{ Params: { id: string } }>("/v1/workspaces/:id/drawings", async (req, reply) => {
    const b = body<CreateDrawing>(CreateDrawing, req.body); if ("code" in b) return invalid(reply, b);
    return send(reply, svc.createDrawing(req.params.id, b), 201);
  });
  app.patch<{ Params: { id: string } }>("/v1/drawings/:id", async (req, reply) => {
    const b = body<PatchDrawing>(PatchDrawing, req.body); if ("code" in b) return invalid(reply, b);
    return send(reply, svc.patchDrawing(req.params.id, b));
  });
  app.post<{ Params: { id: string } }>("/v1/workspaces/:id/drawings/group", async (req, reply) => {
    const b = body<GroupDrawings>(GroupDrawings, req.body); if ("code" in b) return invalid(reply, b);
    return send(reply, svc.groupDrawings(req.params.id, b));
  });
  app.delete<{ Params: { id: string } }>("/v1/drawings/:id", async (req, reply) => {
    const b = body<DeleteNode>(DeleteNode, req.body ?? {}); if ("code" in b) return invalid(reply, b);
    return send(reply, svc.deleteDrawing(req.params.id, b.expectedRevision), 204);
  });
  app.post<{ Params: { id: string } }>("/v1/workspaces/:id/connections", async (req, reply) => {
    const b = body<CreateConnection>(CreateConnection, req.body); if ("code" in b) return invalid(reply, b);
    return send(reply, svc.createConnection(req.params.id, b), 201);
  });
  app.patch<{ Params: { id: string } }>("/v1/connections/:id", async (req, reply) => {
    const b = body<PatchConnection>(PatchConnection, req.body); if ("code" in b) return invalid(reply, b);
    return send(reply, svc.patchConnection(req.params.id, b));
  });
  app.delete<{ Params: { id: string } }>("/v1/connections/:id", async (req, reply) => {
    const b = body<DeleteNode>(DeleteNode, req.body ?? {}); if ("code" in b) return invalid(reply, b);
    return send(reply, svc.deleteConnection(req.params.id, b.expectedRevision), 204);
  });
  app.post<{ Params: { id: string } }>("/v1/nodes/:id/messages", async (req, reply) => {
    const b = body<SendMessage>(SendMessage, req.body); if ("code" in b) return invalid(reply, b);
    return send(reply, svc.sendMessage(req.params.id, b), 201);
  });
  app.post<{ Params: { id: string } }>("/v1/nodes/:id/ask", async (req, reply) => {
    const b = body<Ask>(Ask, req.body); if ("code" in b) return invalid(reply, b);
    return send(reply, await svc.ask(req.params.id, b), 200);
  });
  app.get<{ Params: { id: string }; Querystring: { ref?: string } }>("/v1/nodes/:id/check", async (req, reply) =>
    send(reply, svc.checkPeer(req.params.id, req.query.ref ?? "")));
  app.get<{ Params: { id: string }; Querystring: { unread?: string; mark?: string } }>("/v1/nodes/:id/inbox", async (req, reply) =>
    send(reply, svc.inbox(req.params.id, req.query.unread === "1", req.query.mark === "1")));
  app.get<{ Params: { id: string } }>("/v1/messages/:id", async (req, reply) => {
    const m = svc.getMessage(req.params.id);
    return m ? m : reply.status(404).send({ error: { code: "NOT_FOUND", message: "mensagem não encontrada" } });
  });
  app.get<{ Params: { id: string } }>("/v1/workspaces/:id/unread", async (req) => svc.unreadCounts(req.params.id));
  app.get<{ Params: { id: string } }>("/v1/nodes/:id/connected", async (req, reply) => send(reply, svc.connectedNodes(req.params.id)));
  app.post<{ Params: { id: string } }>("/v1/nodes/:id/restart", async (req, reply) => send(reply, svc.restartTerminal(req.params.id)));
  app.get<{ Params: { id: string } }>("/v1/sessions/:id", async (req, reply) => {
    const s = svc.sessions.get(req.params.id);
    return s ? s : reply.status(404).send({ error: { code: "NOT_FOUND", message: "sessão não encontrada" } });
  });
  app.post<{ Params: { id: string } }>("/v1/sessions/:id/stop", async (req, reply) => send(reply, svc.sessions.stop(req.params.id)));

  // WebSocket: eventos de espaço e stream de terminal
  if (!opts.unix) {
    void app.register(websocket);
    void app.register(async (f) => {
      f.get("/v1/ws", { websocket: true }, (socket: WebSocket) => {
        const clientId = newId();
        const workspaces = new Set<string>();
        const attached = new Set<string>();
        const push = (m: WsServerMessage) => { if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(m)); };

        const onOutput = (sessionId: string, sequence: number, data: string) => { if (attached.has(sessionId)) push({ type: "output", sessionId, sequence, data }); };
        const onSession = (session: Parameters<typeof push>[0] extends never ? never : import("@messai/contracts").Session) => {
          if (workspaces.has(session.workspaceId) || attached.has(session.sessionId)) push({ type: "session", session });
          push({ type: "sidebar", sidebar: svc.sidebar() }); // contagem de terminais por espaço
        };
        const onWorkspace = (snapshot: import("@messai/contracts").WorkspaceSnapshot) => { if (workspaces.has(snapshot.workspace.workspaceId)) push({ type: "workspace", snapshot }); };
        const onMessage = (message: import("@messai/contracts").Message) => { if (workspaces.has(message.workspaceId)) push({ type: "message", message }); };
        const onSidebar = (sidebar: import("@messai/contracts").Sidebar) => push({ type: "sidebar", sidebar });
        svc.on("sidebar", onSidebar);
        const onChat = (message: import("@messai/contracts").ChatMessage) => { if (workspaces.has(message.workspaceId)) push({ type: "chat", message }); };
        svc.on("chat", onChat);
        svc.on("message", onMessage);
        svc.sessions.on("output", onOutput);
        svc.sessions.on("session", onSession);
        svc.on("workspace", onWorkspace);

        push({ type: "hello", clientId, protocolVersion: PROTOCOL_VERSION });

        socket.on("message", (raw) => {
          let msg: unknown;
          try { msg = JSON.parse(String(raw)); } catch { return push({ type: "error", error: { code: "INVALID", message: "JSON inválido" } }); }
          if (!Value.Check(WsClientMessage, msg)) return push({ type: "error", error: { code: "INVALID", message: "mensagem fora do contrato" } });
          const m = msg;
          switch (m.type) {
            case "subscribe": {
              const s = svc.snapshot(m.workspaceId);
              if (!s) return push({ type: "error", error: { code: "NOT_FOUND", message: "espaço não encontrado" } });
              workspaces.add(m.workspaceId); push({ type: "workspace", snapshot: s }); return;
            }
            case "attach": {
              const session = svc.sessions.get(m.sessionId);
              if (!session) return push({ type: "error", error: { code: "NOT_FOUND", message: "sessão não encontrada" }, sessionId: m.sessionId });
              attached.add(m.sessionId);
              const snap = svc.sessions.snapshot(m.sessionId) ?? { sequence: 0, data: "" };
              push({ type: "snapshot", sessionId: m.sessionId, sequence: snap.sequence, data: snap.data, session }); return;
            }
            case "detach": attached.delete(m.sessionId); svc.sessions.releaseLease(m.sessionId, clientId); return;
            case "acquireLease": {
              const r = svc.sessions.acquireLease(m.sessionId, clientId);
              if (!r.ok) push({ type: "error", error: r.error, sessionId: m.sessionId }); return;
            }
            case "releaseLease": svc.sessions.releaseLease(m.sessionId, clientId); return;
            case "input": {
              const r = svc.sessions.write(m.sessionId, clientId, m.data);
              if (!r.ok) push({ type: "error", error: r.error, sessionId: m.sessionId }); return;
            }
            case "resize": {
              const r = svc.sessions.resize(m.sessionId, clientId, m.cols, m.rows);
              if (!r.ok) push({ type: "error", error: r.error, sessionId: m.sessionId }); return;
            }
          }
        });
        socket.on("close", () => {
          for (const id of attached) svc.sessions.releaseLease(id, clientId);
          svc.sessions.off("output", onOutput); svc.sessions.off("session", onSession); svc.off("workspace", onWorkspace); svc.off("message", onMessage); svc.off("sidebar", onSidebar); svc.off("chat", onChat);
        });
      });
    });
  }
  return app;
}
