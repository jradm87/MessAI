#!/usr/bin/env node
// CLI mínima para agentes e humanos dentro de um terminal REA. Fala com o runtime pelo socket Unix.
import { request } from "node:http";
import { AGENT_ENV, type AskResult, type ChatMessage, type Message, type Node, type Workspace, type WorkspaceSnapshot } from "@messai/contracts";

const env = (k: keyof typeof AGENT_ENV) => process.env[AGENT_ENV[k]];
const socketPath = env("socket"), token = env("token"), workspaceId = env("workspaceId"), nodeId = env("nodeId");
if (!socketPath || !token) { console.error("Fora de um terminal MessAI: MESS_SOCKET/MESS_TOKEN ausentes."); process.exit(2); }

function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const req = request({ socketPath, path, method, headers: { authorization: `Bearer ${token}`, ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}) } }, (res) => {
      let buf = ""; res.setEncoding("utf8"); res.on("data", (c) => (buf += c));
      res.on("end", () => {
        if (res.statusCode === 204) return resolve(undefined as T);
        let j: unknown; try { j = JSON.parse(buf); } catch { return reject(new Error(`resposta inválida (${res.statusCode})`)); }
        if ((res.statusCode ?? 500) >= 400) return reject(new Error((j as { error: { code: string; message: string } }).error.code + ": " + (j as { error: { message: string } }).error.message));
        resolve(j as T);
      });
    });
    req.on("error", reject); if (data) req.write(data); req.end();
  });
}

const snapshot = () => call<WorkspaceSnapshot>("GET", `/v1/workspaces/${workspaceId}`);
const findNode = (nodes: Node[], ref: string) => nodes.find((n) => n.nodeId === ref || n.nodeId.startsWith(ref) || n.title.toLowerCase() === ref.toLowerCase());
const short = (id: string) => id.slice(0, 8);

const [cmd, sub, ...rest] = process.argv.slice(2);
try {
  if (!cmd || cmd === "help" || cmd === "--help") {
    console.log(`rea — workspace visual
  mess context                      espaço, seu nó e notas conectadas (com conteúdo)
  mess nodes                        lista nós do espaço
  mess note read <id|título>        conteúdo de uma nota
  mess note write <título> <texto>  cria nota ligada ao seu nó
  mess note append <id|título> <texto>
  mess note path <id|título>        caminho do arquivo .md da nota (edite direto se preferir)
  mess connect <id|título>          liga seu nó a outro nó
  mess peers                        terminais conectados a você (com quem pode falar)
  mess ask <id|título> <texto>      pergunta a um nó conectado e ESPERA a resposta (última tela)
                                      [--no-wait] só dispara · [--timeout seg] tempo máx. de espera
  mess check <id|título>            lê a tela atual de um nó conectado (sem enviar nada)
  mess reply <idMsg> <texto>        responde uma mensagem recebida
  mess inbox [--all]                mensagens recebidas (marca como lidas)
  mess say <texto> [--thread N]     responde no chat do seu terminal (Markdown; aparece em balões)
  mess chat [--thread N] [--all]    histórico do chat do seu terminal (padrão: 30 recentes)
  mess floor list                   andares do térreo deste espaço
  mess floor create <nome> [--branch b] [--base ref] [--no-git]
  mess floor status <working|blocked|review|done> [texto]   status do andar atual
  mess floor land [--squash] [--keep] [--delete-branch]      pousa o andar atual no térreo
  mess floor delete <id|nome> [--delete-branch]`);
  } else if (cmd === "floor") {
    const s = await snapshot(); const me = s.workspace;
    const groundId = me.parentId ?? me.workspaceId;
    const args = rest.filter((a): a is string => a !== undefined);
    const flag = (f: string) => { const i = args.indexOf(f); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
    const has = (f: string) => { const i = args.indexOf(f); if (i < 0) return false; args.splice(i, 1); return true; };
    if (sub === "list") {
      const floors = await call<Workspace[]>("GET", `/v1/workspaces/${groundId}/floors`);
      console.log(`térreo: ${me.parentId ? "(este é um andar)" : me.name}`);
      if (!floors.length) console.log("nenhum andar");
      for (const f of floors) console.log(`${short(f.workspaceId)}  ${f.name.padEnd(24)} ${(f.branch ?? "-").padEnd(24)} ${f.status ?? ""}${f.statusText ? ` — ${f.statusText}` : ""}${f.workspaceId === me.workspaceId ? "  (você)" : ""}`);
    } else if (sub === "create") {
      const branch = flag("--branch"); const base = flag("--base"); const noGit = has("--no-git");
      const name = args.join(" ").trim(); if (!name) throw new Error("uso: mess floor create <nome> [--branch b] [--base ref] [--no-git]");
      const f = await call<Workspace>("POST", `/v1/workspaces/${groundId}/floors`, { name, ...(branch ? { branch } : {}), ...(base ? { base } : {}), ...(noGit ? { floorType: "none" } : {}) });
      console.log(`andar criado [${short(f.workspaceId)}] branch=${f.branch} em ${f.cwd}`);
    } else if (sub === "status") {
      if (!me.parentId) throw new Error("este espaço é o térreo; status é por andar");
      const [status, ...text] = args; if (!status || !["working", "blocked", "review", "done"].includes(status)) throw new Error("uso: mess floor status <working|blocked|review|done> [texto]");
      await call("PATCH", `/v1/workspaces/${me.workspaceId}`, { expectedRevision: me.revision, status, statusText: text.join(" ") });
      console.log("ok");
    } else if (sub === "land") {
      if (!me.parentId) throw new Error("este espaço é o térreo; pouse a partir de um andar");
      const r = await call<{ ok: boolean; conflicts: string[]; output: string; removed: boolean }>("POST", `/v1/workspaces/${me.workspaceId}/land`, { ...(has("--squash") ? { mode: "squash" } : {}), ...(has("--keep") ? { keepFloor: true } : {}), ...(has("--delete-branch") ? { deleteBranch: true } : {}) });
      if (r.ok) console.log(`pousado no térreo${r.removed ? "; andar removido (este terminal vai encerrar)" : ""}`);
      else { console.log(`não pousou: conflitos em ${r.conflicts.join(", ") || "(ver saída)"}\n${r.output}`); process.exit(1); }
    } else if (sub === "delete") {
      const del = has("--delete-branch"); const ref = args.join(" ");
      const floors = await call<Workspace[]>("GET", `/v1/workspaces/${groundId}/floors`);
      const f = floors.find((x) => x.workspaceId === ref || x.workspaceId.startsWith(ref) || x.name.toLowerCase() === ref.toLowerCase());
      if (!f) throw new Error("andar não encontrado");
      await call("DELETE", `/v1/workspaces/${f.workspaceId}${del ? "?deleteBranch=1" : ""}`);
      console.log("andar removido");
    } else throw new Error("uso: mess floor list|create|status|land|delete");
  } else if (cmd === "say") {
    if (!nodeId) throw new Error("sem MESS_NODE_ID");
    const args = [sub, ...rest].filter((a): a is string => a !== undefined);
    const ti = args.indexOf("--thread"); const thread = ti >= 0 ? Number(args[ti + 1]) : undefined; if (ti >= 0) args.splice(ti, 2);
    const text = args.join(" ").trim(); if (!text) throw new Error("uso: mess say <texto> [--thread N]");
    const m = await call<ChatMessage>("POST", `/v1/nodes/${nodeId}/chat`, { text, ...(thread ? { thread } : {}) });
    console.log(`ok (tópico ${m.thread})`);
  } else if (cmd === "chat") {
    if (!nodeId) throw new Error("sem MESS_NODE_ID");
    const args = [sub, ...rest].filter((a): a is string => a !== undefined);
    const ti = args.indexOf("--thread"); const thread = ti >= 0 ? Number(args[ti + 1]) : undefined;
    const limit = args.includes("--all") ? 500 : 30;
    const ms = await call<ChatMessage[]>("GET", `/v1/nodes/${nodeId}/chat?limit=${limit}${thread ? `&thread=${thread}` : ""}`);
    if (!ms.length) console.log("chat vazio");
    for (const m of ms) console.log(`[t${m.thread} ${m.createdAt.slice(11, 16)}] ${m.role === "user" ? "usuário" : m.role === "agent" ? "você" : "sistema"}: ${m.text}`);
  } else if (cmd === "context") {
    const s = await snapshot();
    const me = s.nodes.find((n) => n.nodeId === nodeId);
    console.log(`Espaço: ${s.workspace.name} (${s.workspace.cwd}) rev ${s.workspace.revision}`);
    console.log(`Seu nó: ${me ? `${me.title} [${short(me.nodeId)}]` : nodeId ?? "?"}`);
    if (process.env["MESS_ROLE"]) console.log(`Seu papel: ${process.env["MESS_ROLE"]}\n${process.env["MESS_ROLE_INSTRUCTIONS"] ?? ""}`);
    const conn = nodeId ? await call<{ node: Node; direction: string }[]>("GET", `/v1/nodes/${nodeId}/connected`) : [];
    if (conn.length === 0) { console.log("Nenhum nó conectado ao seu."); }
    for (const c of conn) {
      console.log(`\n--- ${c.direction === "in" ? "←" : "→"} ${c.node.kind} "${c.node.title}" [${short(c.node.nodeId)}]`);
      if (c.node.kind === "note") { if (c.node.locked) console.log("(bloqueada: somente leitura)"); if (c.node.filePath) console.log(`arquivo: ${c.node.filePath}`); console.log(c.node.content ?? ""); }
    }
  } else if (cmd === "nodes") {
    const s = await snapshot();
    for (const n of s.nodes) console.log(`${short(n.nodeId)}  ${n.kind.padEnd(8)} ${n.title}${n.nodeId === nodeId ? "  (você)" : ""}`);
  } else if (cmd === "note" && sub === "read") {
    const s = await snapshot(); const n = findNode(s.nodes, rest[0] ?? "");
    if (!n || n.kind !== "note") throw new Error("nota não encontrada");
    console.log(n.content ?? "");
  } else if (cmd === "note" && sub === "path") {
    const s = await snapshot(); const n = findNode(s.nodes, rest[0] ?? "");
    if (!n || n.kind !== "note") throw new Error("nota não encontrada");
    console.log(n.filePath ?? "(sem arquivo)");
  } else if (cmd === "note" && sub === "write") {
    const [title, ...text] = rest; if (!title) throw new Error("uso: mess note write <título> <texto>");
    let s = await snapshot();
    const me = s.nodes.find((n) => n.nodeId === nodeId);
    const g = me ? { x: me.geometry.x + me.geometry.w + 40, y: me.geometry.y, w: 280, h: 180 } : { x: 40, y: 40, w: 280, h: 180 };
    const r = await call<{ node: Node; revision: number }>("POST", `/v1/workspaces/${workspaceId}/nodes`, { expectedRevision: s.workspace.revision, kind: "note", title, geometry: g, content: text.join(" ") });
    if (nodeId) { s = await snapshot(); await call("POST", `/v1/workspaces/${workspaceId}/connections`, { expectedRevision: s.workspace.revision, sourceNodeId: nodeId, targetNodeId: r.node.nodeId }); }
    console.log(`nota criada [${short(r.node.nodeId)}]${nodeId ? " e ligada ao seu nó" : ""}`);
  } else if (cmd === "note" && sub === "append") {
    const [ref, ...text] = rest; const s = await snapshot(); const n = findNode(s.nodes, ref ?? "");
    if (!n || n.kind !== "note") throw new Error("nota não encontrada");
    await call("PATCH", `/v1/nodes/${n.nodeId}`, { expectedRevision: s.workspace.revision, content: `${n.content ?? ""}${n.content ? "\n" : ""}${text.join(" ")}` });
    console.log("ok");
  } else if (cmd === "peers") {
    if (!nodeId) throw new Error("sem MESS_NODE_ID");
    const conn = await call<{ node: Node; direction: string; agentType?: string }[]>("GET", `/v1/nodes/${nodeId}/connected`);
    const peers = conn.filter((c) => c.node.kind === "terminal");
    if (!peers.length) console.log("Nenhum terminal conectado a você. Use `mess connect <nome>` ou ligue no canvas.");
    for (const c of peers) console.log(`${short(c.node.nodeId)}  ${c.node.title.padEnd(24)} ${c.agentType && c.agentType !== "genericShell" ? c.agentType : "shell"}`);
  } else if (cmd === "ask") {
    if (!nodeId) throw new Error("sem MESS_NODE_ID");
    const args = [sub, ...rest].filter((a): a is string => a !== undefined);
    const noWait = (() => { const i = args.indexOf("--no-wait"); if (i >= 0) { args.splice(i, 1); return true; } return false; })();
    const ti = args.indexOf("--timeout"); let timeoutMs: number | undefined; if (ti >= 0) { timeoutMs = Math.round(Number(args[ti + 1]) * 1000); args.splice(ti, 2); }
    const [ref, ...text] = args; if (!ref || !text.length) throw new Error("uso: mess ask <id|título> <texto> [--no-wait] [--timeout seg]");
    const r = await call<AskResult>("POST", `/v1/nodes/${nodeId}/ask`, { to: ref, text: text.join(" "), ...(noWait ? { noWait: true } : {}), ...(timeoutMs ? { timeoutMs } : {}) });
    if (!r.delivered) console.log(`(destino não está rodando; mensagem [${short(r.messageId)}] fica na caixa de entrada)`);
    else if (noWait) console.log(`enviada [${short(r.messageId)}]`);
    else if (r.response) { console.log(r.response); if (r.timedOut) console.error("(aviso: tempo limite atingido; resposta pode estar incompleta)"); }
    else console.log(r.timedOut ? "(sem resposta no tempo limite; use `mess check` ou olhe o terminal)" : "(destino não devolveu saída)");
  } else if (cmd === "reply") {
    if (!nodeId) throw new Error("sem MESS_NODE_ID");
    const [ref, ...text] = [sub, ...rest]; if (!ref || !text.length) throw new Error("uso: mess reply <idMsg> <texto>");
    const orig = await call<Message>("GET", `/v1/messages/${ref}`);
    const m = await call<Message>("POST", `/v1/nodes/${nodeId}/messages`, { to: orig.fromNodeId, text: text.join(" "), replyTo: orig.messageId });
    console.log(`respondida [${short(m.messageId)}]${m.delivered ? "" : " (destino não está rodando; fica na caixa de entrada)"}`);
  } else if (cmd === "check") {
    if (!nodeId) throw new Error("sem MESS_NODE_ID");
    if (!sub) throw new Error("uso: mess check <id|título>");
    const r = await call<{ agentType: string; screen: string }>("GET", `/v1/nodes/${nodeId}/check?ref=${encodeURIComponent(sub)}`);
    console.log(r.screen || "(tela vazia ou destino não está rodando)");
  } else if (cmd === "inbox") {
    if (!nodeId) throw new Error("sem MESS_NODE_ID");
    const all = sub === "--all";
    const r = await call<{ messages: (Message & { fromTitle: string })[] }>("GET", `/v1/nodes/${nodeId}/inbox?unread=${all ? 0 : 1}&mark=1`);
    if (!r.messages.length) console.log(all ? "Sem mensagens." : "Sem mensagens novas.");
    for (const m of r.messages) console.log(`[${short(m.messageId)}] ${m.createdAt.slice(11, 19)} de "${m.fromTitle}"${m.replyTo ? ` (resposta a ${short(m.replyTo)})` : ""}:\n  ${m.text}`);
  } else if (cmd === "connect") {
    if (!nodeId) throw new Error("sem MESS_NODE_ID");
    const s = await snapshot(); const n = findNode(s.nodes, sub ?? "");
    if (!n) throw new Error("nó não encontrado");
    await call("POST", `/v1/workspaces/${workspaceId}/connections`, { expectedRevision: s.workspace.revision, sourceNodeId: nodeId, targetNodeId: n.nodeId });
    console.log(`ligado a "${n.title}"`);
  } else { console.error(`comando desconhecido: ${cmd} ${sub ?? ""}`); process.exit(2); }
} catch (e) { console.error(String(e instanceof Error ? e.message : e)); process.exit(1); }
