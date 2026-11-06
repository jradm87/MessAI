#!/usr/bin/env node
// CLI mínima para agentes e humanos dentro de um terminal REA. Fala com o runtime pelo socket Unix.
import { request } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { AGENT_ENV, type Band, type BandAskResult, type AskResult, type ChatMessage, type EnvVarEntry, type FloorCopyInfo, type FloorHooksState, type FloorPrState, type GitHostEntry, type Message, type Node, type NotificationItem, type Routine, type RoutineRunResult, type Session, type Workspace, type WorkspaceBundle, type WorkspaceBundlePreview, type WorkspaceSnapshot } from "@messai/contracts";

import type { PortalActResult, PortalSnapshot, PortalScreenshot, DeviceList, DeviceActResult, DeviceUiTree, DeviceScreenshot, DeviceState } from "@messai/contracts";

const env = (k: keyof typeof AGENT_ENV) => process.env[AGENT_ENV[k]];
// Socket é determinístico (não-secreto): se o agente perdeu MESS_SOCKET no ambiente (ex.: política de env de alguns CLIs), cai no padrão.
const defaultSocket = () => { const d = process.env["MESS_DATA_DIR"]; return (d ? `${d}/agent.sock` : `${process.env["HOME"] ?? ""}/.messai/agent.sock`); };
const socketPath = env("socket") || defaultSocket();
const token = env("token"), workspaceId = env("workspaceId"), nodeId = env("nodeId");
const [cmd, sub, ...rest] = process.argv.slice(2);
const isHelp = !cmd || cmd === "help" || cmd === "--help" || cmd === "-h";
if (!isHelp && !token) { console.error("Fora de um terminal MessAI: a credencial (MESS_TOKEN) não chegou ao comando.\nSe este é um terminal Codex, o preset já herda o ambiente — recrie o terminal na versão nova. Caso contrário, rode `mess` de dentro de um terminal do MessAI."); process.exit(2); }

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

try {
  if (isHelp) {
    console.log(`rea — workspace visual
  mess context                      espaço, seu nó e notas conectadas (com conteúdo)
  mess nodes                        lista nós do espaço
  mess note read <id|título>        conteúdo de uma nota
  mess note write <título> <texto>  cria nota ligada ao seu nó
  mess note append <id|título> <texto>
  mess note path <id|título>        caminho do arquivo .md da nota (edite direto se preferir)
  mess connect <id|título>          liga seu nó a outro nó
  mess close <id|título>            apaga uma nota/portal/dispositivo (terminal: use mess maestro dismiss)
  mess peers                        terminais conectados a você (com quem pode falar)
  mess ask <id|título> <texto>      pergunta a um nó conectado e ESPERA a resposta (última tela)
                                      [--no-wait] só dispara · [--timeout seg] tempo máx. de espera
  mess check <id|título>            lê a tela atual de um nó conectado (sem enviar nada)
  mess reply <idMsg> <texto>        responde uma mensagem recebida
  mess inbox [--all]                mensagens recebidas (marca como lidas)
  mess request <capacidade> [motivo...] [--wait seg]   pede ao USUÁRIO uma capacidade que você não tem (aprovação humana)
  mess say <texto> [--thread N] [--attach arquivo]...   responde no chat do seu terminal (Markdown; anexos viram cards)
  mess chat [--thread N] [--all]    histórico do chat do seu terminal (padrão: 30 recentes)
  mess band list                    bandas do espaço (grupos de terminais) e seus membros
  mess band create <nome> [nó...]   cria uma banda · add/remove <banda> <nó> · delete <banda>
  mess band ask <banda> <texto>     pergunta a TODOS os membros e espera as respostas [--timeout seg]
  mess band say <banda> <texto>     transmite (broadcast) sem esperar resposta
  mess maestro recruit (--preset p | --command c [--arg a]...) [--name n] [--role r] [--band b] [--cwd d] [--persist]
                                    (só condutor) recruta um terminal ligado a você · --persist = tmux (sobrevive a fechar/reabrir o app)
  mess maestro dismiss <nó>         (só condutor) encerra e remove um terminal ligado a você
  mess maestro assign <nó> <papel|->  (só condutor) reatribui o papel (- remove)
  mess maestro interrupt <nó> | --all   (só condutor) interrompe (Esc/Ctrl-C, sem matar) um recrutado ou todos
  mess portal list|new [url] [--name n]   portais (navegador no canvas) do espaço · cria um
  mess portal <portal> open <url>   navega · back|forward|reload|state|close
  mess portal <portal> snapshot [--full]   página como texto + elementos com ref [N] (clicáveis)
  mess portal <portal> click <ref|x,y> [--right] [--double]  · type <ref> <texto> [--submit] [--clear]
  mess portal <portal> key <Enter|Tab|ArrowDown|…> · scroll <dy> [dx] · eval <js> · wait-text <texto> [--timeout seg]
  mess portal <portal> screenshot [arquivo.png]   (exige a capacidade portals:control)
  mess device list                  aparelhos/emuladores Android (adb) e AVDs disponíveis
  mess device new [--name n] [--serial s | --avd a]   cria um nó de dispositivo no canvas
  mess device <nó> select <serial> · boot <avd> [--persist] · disconnect · shutdown · state
  mess device <nó> ui [--all]       árvore de elementos da tela (com o centro x,y de cada um)
  mess device <nó> tap <x> <y> · longpress <x> <y> [ms] · swipe <x1> <y1> <x2> <y2> [ms]
  mess device <nó> key <back|home|recents|enter|…> · text <ASCII> · launch <pacote> [atividade] · stop <pacote> · apps
  mess device <nó> screenshot [arquivo.png]   (exige a capacidade devices:control)
  mess floor list                   andares do térreo deste espaço
  mess floor create <nome> [--branch b] [--base ref] [--no-git]
  mess floor status <working|blocked|review|done> [texto]   status do andar atual
  mess floor land [--squash] [--keep] [--delete-branch]      pousa o andar atual no térreo
  mess floor delete <id|nome> [--delete-branch]
  mess floor hooks [set <setup|run|teardown> <cmd> | run [seção] | stop [seção] | logs [seção]]
  mess env [list [--global] [--reveal] | set <KEY=VALUE> [--global] [--secret] | unset <KEY> [--global]]`);
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
      const branch = flag("--branch"); const base = flag("--base"); const noGit = has("--no-git"); const copy = has("--copy");
      const excl = flag("--exclude");
      const name = args.join(" ").trim(); if (!name) throw new Error("uso: mess floor create <nome> [--branch b] [--base ref] [--no-git|--copy [--exclude dir1,dir2]]");
      const f = await call<Workspace>("POST", `/v1/workspaces/${groundId}/floors`, {
        name, ...(branch ? { branch } : {}), ...(base ? { base } : {}),
        ...(noGit ? { floorType: "none" } : copy ? { floorType: "copy", ...(excl ? { excludeDirs: excl.split(",").map((x) => x.trim()).filter(Boolean) } : {}) } : {}),
      });
      console.log(`andar criado [${short(f.workspaceId)}] tipo=${f.floorType}${f.copyMode ? `(${f.copyMode})` : ""} branch=${f.branch} em ${f.cwd}`);
    } else if (sub === "excludes") {
      const info = await call<FloorCopyInfo>("GET", `/v1/workspaces/${groundId}/floor-copy-info`);
      console.log(`CoW suportado: ${info.cowSupported ? "sim" : "não"}`);
      console.log(`Pastas excluídas: ${info.excludeDirs.join(", ") || "(nenhuma)"}`);
      console.log(`Pastas presentes no espaço: ${info.presentDirs.join(", ") || "(nenhuma)"}`);
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
    } else if (sub === "hooks") {
      const op = args.shift();
      if (!op || op === "list") {
        const h = await call<FloorHooksState>("GET", `/v1/workspaces/${me.workspaceId}/hooks`);
        for (const k of ["setup", "run", "teardown"] as const) {
          const st = h.status[k];
          console.log(`${k.padEnd(10)} [${st.state}${st.exitCode !== undefined ? ` exit=${st.exitCode}` : ""}]  ${h.hooks[k] || "(vazio)"}`);
        }
      } else if (op === "set") {
        const sec = args.shift();
        if (sec !== "setup" && sec !== "run" && sec !== "teardown") throw new Error("uso: mess floor hooks set <setup|run|teardown> <comando>");
        const h = await call<FloorHooksState>("PUT", `/v1/workspaces/${me.workspaceId}/hooks`, { [sec]: args.join(" ") });
        console.log(`${sec}: ${h.hooks[sec] || "(vazio)"}`);
      } else if (op === "run") {
        const noWait = has("--no-wait");
        const sec = args[0] ?? "all";
        const h = await call<FloorHooksState>("POST", `/v1/workspaces/${me.workspaceId}/hooks/run`, { section: sec, wait: !noWait });
        for (const k of (sec === "all" ? ["setup", "run", "teardown"] : [sec]) as ("setup" | "run" | "teardown")[]) {
          const st = h.status[k];
          if (st.state !== "idle") console.log(`=== ${k} (${st.state}) ===\n${st.log.trim()}`);
        }
      } else if (op === "stop") {
        const sec = args[0] ?? "all";
        await call<FloorHooksState>("POST", `/v1/workspaces/${me.workspaceId}/hooks/stop`, { section: sec });
        console.log("parado");
      } else if (op === "logs") {
        const sec = (args[0] ?? "run") as "setup" | "run" | "teardown";
        const h = await call<FloorHooksState>("GET", `/v1/workspaces/${me.workspaceId}/hooks`);
        console.log(h.status[sec]?.log || "(sem saída)");
      } else throw new Error("uso: mess floor hooks [set|run|stop|logs]");
    } else if (sub === "pr") {
      const op = args.shift() ?? "status";
      if (op === "status") {
        const pr = await call<FloorPrState>("GET", `/v1/workspaces/${me.workspaceId}/pr`);
        if (pr.state === "none") console.log(`sem PR aberto (${pr.branch} -> ${pr.baseBranch}, +${pr.ahead}/-${pr.behind}) · comparar: ${pr.compareUrl}`);
        else console.log(`PR #${pr.number} [${pr.state}${pr.draft ? " draft" : ""}] "${pr.title}" (${pr.branch} -> ${pr.baseBranch}) revisão=${pr.reviewStatus} checks=${pr.checksStatus}\n${pr.url}`);
      } else if (op === "create") {
        const bodyText = flag("--body"); const baseBranch = flag("--base"); const draft = has("--draft"); const push = has("--push");
        const title = args.join(" ").trim() || me.name;
        const pr = await call<FloorPrState>("POST", `/v1/workspaces/${me.workspaceId}/pr`, { title, ...(bodyText ? { body: bodyText } : {}), ...(baseBranch ? { baseBranch } : {}), ...(draft ? { draft: true } : {}), ...(push ? { push: true } : {}) });
        console.log(`PR #${pr.number} criado: ${pr.url}`);
      } else if (op === "merge" || op === "close" || op === "reopen" || op === "push" || op === "refresh") {
        const pr = await call<FloorPrState>("PATCH", `/v1/workspaces/${me.workspaceId}/pr`, { action: op });
        console.log(`PR #${pr.number ?? "-"} [${pr.state}] revisão=${pr.reviewStatus} checks=${pr.checksStatus}`);
      } else if (op === "review") {
        const reviewStatus = args[0];
        if (!reviewStatus || !["none", "review_required", "approved", "changes_requested"].includes(reviewStatus)) throw new Error("uso: mess floor pr review <none|review_required|approved|changes_requested>");
        const pr = await call<FloorPrState>("PATCH", `/v1/workspaces/${me.workspaceId}/pr`, { reviewStatus });
        console.log(`revisão=${pr.reviewStatus}`);
      } else if (op === "checks") {
        const checksStatus = args[0];
        if (!checksStatus || !["none", "pending", "passing", "failing"].includes(checksStatus)) throw new Error("uso: mess floor pr checks <none|pending|passing|failing>");
        const pr = await call<FloorPrState>("PATCH", `/v1/workspaces/${me.workspaceId}/pr`, { checksStatus });
        console.log(`checks=${pr.checksStatus}`);
      } else throw new Error("uso: mess floor pr [status|create|merge|close|reopen|push|refresh|review|checks]");
    } else if (sub === "hosts") {
      const op = args.shift() ?? "list";
      const hosts = await call<GitHostEntry[]>("GET", "/v1/git-hosts");
      if (op === "list") {
        if (!hosts.length) console.log("nenhum host Git customizado");
        for (const h of hosts) console.log(`${h.host.padEnd(28)} ${h.kind.padEnd(10)} ${h.prUrlTemplate ?? ""}`);
      } else if (op === "add") {
        const [host, kind, prUrlTemplate] = args;
        if (!host || !kind || !["github", "gitlab", "gitea", "custom"].includes(kind)) throw new Error("uso: mess floor hosts add <host> <github|gitlab|gitea|custom> [template]");
        const next = [...hosts.filter((h) => h.host.toLowerCase() !== host.toLowerCase()), { host, kind: kind as GitHostEntry["kind"], ...(prUrlTemplate ? { prUrlTemplate } : {}) }];
        await call<GitHostEntry[]>("PUT", "/v1/git-hosts", { hosts: next });
        console.log(`host ${host} (${kind}) salvo`);
      } else throw new Error("uso: mess floor hosts [list|add]");
    } else throw new Error("uso: mess floor list|create|status|land|delete|hooks|pr|hosts");
  } else if (cmd === "say") {
    if (!nodeId) throw new Error("sem MESS_NODE_ID");
    const args = [sub, ...rest].filter((a): a is string => a !== undefined);
    const ti = args.indexOf("--thread"); const thread = ti >= 0 ? Number(args[ti + 1]) : undefined; if (ti >= 0) args.splice(ti, 2);
    const files: string[] = []; for (let i = args.indexOf("--attach"); i >= 0; i = args.indexOf("--attach")) { const f = args[i + 1]; args.splice(i, 2); if (f) files.push(resolvePath(f)); }
    const text = args.join(" ").trim() || (files.length ? `📎 ${files.length} arquivo(s)` : ""); if (!text) throw new Error("uso: mess say <texto> [--thread N] [--attach arquivo]...");
    const m = await call<ChatMessage>("POST", `/v1/nodes/${nodeId}/chat`, { text, ...(thread ? { thread } : {}), ...(files.length ? { attachments: files.map((path) => ({ path })) } : {}) });
    console.log(`ok (tópico ${m.thread}${m.attachments?.length ? `, ${m.attachments.length} anexo(s)` : ""})`);
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
    if (process.env["MESS_MAESTRO"] === "1") console.log("Modo Maestro: você é o condutor — pode `mess maestro recruit|dismiss|assign` e `mess band ask|say`.");
    if (process.env["MESS_ROLE"]) console.log(`Seu papel: ${process.env["MESS_ROLE"]}\n${process.env["MESS_ROLE_INSTRUCTIONS"] ?? ""}`);
    const conn = nodeId ? await call<{ node: Node; direction: string; workspaceName?: string; crossWorkspace?: boolean }[]>("GET", `/v1/nodes/${nodeId}/connected`) : [];
    if (conn.length === 0) { console.log("Nenhum nó conectado ao seu."); }
    for (const c of conn) {
      const label = c.crossWorkspace && c.workspaceName ? `${c.node.title} @ ${c.workspaceName}` : c.node.title;
      console.log(`\n--- ${c.direction === "in" ? "←" : "→"} ${c.node.kind} "${label}" [${short(c.node.nodeId)}]`);
      if (c.node.kind === "note") { if (c.node.locked) console.log("(bloqueada: somente leitura)"); if (c.node.secret) { console.log(`(nota SECRETA — valor oculto${c.node.secretEnv ? `; já está no seu ambiente como $${c.node.secretEnv}, use por referência e nunca imprima` : ""})`); continue; } if (c.node.filePath) console.log(`arquivo: ${c.node.filePath}`); console.log(c.node.content ?? ""); }
    }
  } else if (cmd === "nodes") {
    const s = await snapshot();
    for (const n of s.nodes) console.log(`${short(n.nodeId)}  ${n.kind.padEnd(8)} ${n.title}${n.nodeId === nodeId ? "  (você)" : ""}`);
  } else if (cmd === "note" && sub === "read") {
    const s = await snapshot(); const n = findNode(s.nodes, rest[0] ?? "");
    if (!n || n.kind !== "note") throw new Error("nota não encontrada");
    if (n.secret) { console.log(`[oculto] nota secreta — o valor não é exposto.${n.secretEnv ? ` Use por referência: $${n.secretEnv} (já no seu ambiente).` : ""}`); }
    else console.log(n.content ?? "");
  } else if (cmd === "note" && sub === "path") {
    const s = await snapshot(); const n = findNode(s.nodes, rest[0] ?? "");
    if (!n || n.kind !== "note") throw new Error("nota não encontrada");
    console.log(n.filePath ?? "(sem arquivo)");
  } else if (cmd === "note" && sub === "write") {
    const [title, ...text] = rest; if (!title) throw new Error("uso: mess note write <título> <texto>");
    let s = await snapshot();
    const me = s.nodes.find((n) => n.nodeId === nodeId);
    const g = me ? { x: me.geometry.x + me.geometry.w + 40, y: me.geometry.y, w: 280, h: 180 } : { x: 40, y: 40, w: 280, h: 180 };
    const r = await call<{ node: Node; revision: number }>("POST", `/v1/workspaces/${workspaceId}/nodes`, { expectedRevision: s.workspace.revision, kind: "note", title, geometry: g, autoPlace: true, content: text.join(" ") });
    if (nodeId) { s = await snapshot(); await call("POST", `/v1/workspaces/${workspaceId}/connections`, { expectedRevision: s.workspace.revision, sourceNodeId: nodeId, targetNodeId: r.node.nodeId }); }
    console.log(`nota criada [${short(r.node.nodeId)}]${nodeId ? " e ligada ao seu nó" : ""}`);
  } else if (cmd === "note" && sub === "append") {
    const [ref, ...text] = rest; const s = await snapshot(); const n = findNode(s.nodes, ref ?? "");
    if (!n || n.kind !== "note") throw new Error("nota não encontrada");
    await call("PATCH", `/v1/nodes/${n.nodeId}`, { expectedRevision: s.workspace.revision, content: `${n.content ?? ""}${n.content ? "\n" : ""}${text.join(" ")}` });
    console.log("ok");
  } else if (cmd === "peers") {
    if (!nodeId) throw new Error("sem MESS_NODE_ID");
    const conn = await call<{ node: Node; direction: string; agentType?: string; workspaceName?: string; crossWorkspace?: boolean }[]>("GET", `/v1/nodes/${nodeId}/connected`);
    const peers = conn.filter((c) => c.node.kind === "terminal");
    if (!peers.length) console.log("Nenhum terminal conectado a você. Use `mess connect <nome>` ou ligue no canvas.");
    for (const c of peers) {
      const label = c.crossWorkspace && c.workspaceName ? `${c.node.title} @ ${c.workspaceName}` : c.node.title;
      console.log(`${short(c.node.nodeId)}  ${label.padEnd(28)} ${c.agentType && c.agentType !== "genericShell" ? c.agentType : "shell"}`);
    }
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
    const ref = [sub, ...rest].filter((a): a is string => a !== undefined).join(" ").trim();
    if (!ref) throw new Error("uso: mess check <id|título|Nome @ Espaço>");
    const r = await call<{ agentType: string; screen: string }>("GET", `/v1/nodes/${nodeId}/check?ref=${encodeURIComponent(ref)}`);
    console.log(r.screen || "(tela vazia ou destino não está rodando)");
  } else if (cmd === "request") {
    // #93 aprovação humana: um terminal (isolado, sobretudo) pede uma capacidade; o usuário decide no app.
    const args = [sub, ...rest].filter((a): a is string => a !== undefined);
    let waitSec = 0; const wi = args.indexOf("--wait"); if (wi >= 0) { waitSec = Math.max(0, Math.min(600, Number(args[wi + 1]) || 60)); args.splice(wi, 2); }
    const cap = args.shift(); if (!cap) throw new Error("uso: mess request <capacidade> [motivo...] [--wait seg]  (ex.: nodes:write)");
    const created = await call<{ approvalId: string; status: string; capability: string }>("POST", "/v1/approvals", { capability: cap, ...(args.length ? { reason: args.join(" ") } : {}) });
    console.log(`Pedido ${short(created.approvalId)}: "${created.capability}" — ${created.status === "pending" ? "aguardando o usuário decidir no app" : created.status}.`);
    if (waitSec > 0 && created.status === "pending") {
      const until = Date.now() + waitSec * 1000; let st = created.status;
      while (st === "pending" && Date.now() < until) { await new Promise((r) => setTimeout(r, 1500)); st = (await call<{ status: string }>("GET", `/v1/approvals/${created.approvalId}`)).status; }
      console.log(st === "approved" ? "APROVADO: a capacidade já vale para este terminal." : st === "denied" ? "NEGADO pelo usuário." : "Sem resposta no prazo; o pedido continua pendente.");
      if (st === "denied") process.exitCode = 3; else if (st === "pending") process.exitCode = 4;
    }
  } else if (cmd === "inbox") {
    if (!nodeId) throw new Error("sem MESS_NODE_ID");
    const all = sub === "--all";
    const r = await call<{ messages: (Message & { fromTitle: string })[] }>("GET", `/v1/nodes/${nodeId}/inbox?unread=${all ? 0 : 1}&mark=1`);
    if (!r.messages.length) console.log(all ? "Sem mensagens." : "Sem mensagens novas.");
    for (const m of r.messages) console.log(`[${short(m.messageId)}] ${m.createdAt.slice(11, 19)} de "${m.fromTitle}"${m.replyTo ? ` (resposta a ${short(m.replyTo)})` : ""}:\n  ${m.text}`);
  } else if (cmd === "band") {
    const args = [sub, ...rest].filter((a): a is string => a !== undefined);
    const op = args.shift();
    const bands = () => call<Band[]>("GET", `/v1/workspaces/${workspaceId}/bands`);
    const needBand = async (ref: string | undefined) => { const r = (ref ?? "").toLowerCase(); const b = (await bands()).find((x) => x.bandId.startsWith(r) || x.name.toLowerCase() === r); if (!b || !r) throw new Error(`banda não encontrada: ${ref ?? ""}`); return b; };
    const ids = async (refs: string[]) => { const s = await snapshot(); return refs.map((r) => { const n = findNode(s.nodes, r); if (!n || n.kind !== "terminal") throw new Error(`terminal não encontrado: ${r}`); return n.nodeId; }); };
    const flagNum = (f: string) => { const i = args.indexOf(f); if (i < 0) return undefined; const v = Math.round(Number(args[i + 1]) * 1000); args.splice(i, 2); return v; };
    if (op === "list" || !op) {
      const list = await bands(); const s = await snapshot();
      if (!list.length) console.log("nenhuma banda");
      for (const b of list) console.log(`${short(b.bandId)}  ${b.name.padEnd(20)} ${b.nodeIds.map((id) => s.nodes.find((n) => n.nodeId === id)?.title ?? short(id)).join(", ") || "(vazia)"}`);
    } else if (op === "create") {
      const [name, ...members] = args; if (!name) throw new Error("uso: mess band create <nome> [nó...]");
      const b = await call<Band>("POST", `/v1/workspaces/${workspaceId}/bands`, { name, nodeIds: await ids(members) });
      console.log(`banda "${b.name}" criada [${short(b.bandId)}] com ${b.nodeIds.length} membro(s)`);
    } else if (op === "add" || op === "remove") {
      const [ref, ...members] = args; const b = await needBand(ref); if (!members.length) throw new Error(`uso: mess band ${op} <banda> <nó...>`);
      const r = await call<Band>("PATCH", `/v1/bands/${b.bandId}`, op === "add" ? { addNodeIds: await ids(members) } : { removeNodeIds: await ids(members) });
      console.log(`banda "${r.name}": ${r.nodeIds.length} membro(s)`);
    } else if (op === "delete") {
      const b = await needBand(args[0]); await call("DELETE", `/v1/bands/${b.bandId}`); console.log(`banda "${b.name}" removida`);
    } else if (op === "ask" || op === "say") {
      if (!nodeId) throw new Error("sem MESS_NODE_ID");
      const timeoutMs = flagNum("--timeout"); const [ref, ...text] = args; if (!ref || !text.length) throw new Error(`uso: mess band ${op} <banda> <texto>`);
      const b = await needBand(ref);
      const r = await call<BandAskResult>("POST", `/v1/bands/${b.bandId}/${op === "say" ? "broadcast" : "ask"}`, { text: text.join(" "), fromNodeId: nodeId, ...(timeoutMs && op === "ask" ? { timeoutMs } : {}) });
      for (const a of r.answers) {
        if (a.error) console.log(`--- ${a.title}: (erro) ${a.error}`);
        else if (op === "say") console.log(`--- ${a.title}: ${a.delivered ? "enviado" : "não está rodando"}`);
        else console.log(`--- ${a.title}${a.timedOut ? " (tempo limite; resposta pode estar incompleta)" : ""}\n${a.response || "(sem saída)"}`);
      }
    } else throw new Error("uso: mess band list|create|add|remove|delete|ask|say");
  } else if (cmd === "portal") {
    const args = [sub, ...rest].filter((a): a is string => a !== undefined);
    const flag = (f: string) => { const i = args.indexOf(f); if (i >= 0) { args.splice(i, 1); return true; } return false; };
    const flagVal = (f: string) => { const i = args.indexOf(f); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
    const first = args[0];
    if (!first || first === "list") {
      const s = await snapshot(); const ps = s.nodes.filter((n) => n.kind === "portal");
      if (!ps.length) console.log("Nenhum portal neste espaço. Crie com `mess portal new [url]`.");
      for (const n of ps) { let u = ""; try { u = (JSON.parse(n.content ?? "{}") as { url?: string }).url ?? ""; } catch { /* sem url */ } console.log(`${short(n.nodeId)}  ${n.title.padEnd(24)} ${u || "(em branco)"}`); }
    } else if (first === "new" || first === "create") {
      args.shift(); const name = flagVal("--name") ?? (args[1] && !args[1].startsWith("-") ? args.splice(1,1)[0] : undefined); const url = args[0] ?? "";
      const s = await snapshot(); const me = s.nodes.find((n) => n.nodeId === nodeId);
      const g = me ? { x: me.geometry.x + me.geometry.w + 40, y: me.geometry.y, w: 560, h: 400 } : { x: 40, y: 40, w: 560, h: 400 };
      const r = await call<{ node: Node }>("POST", `/v1/workspaces/${workspaceId}/nodes`, { expectedRevision: s.workspace.revision, kind: "portal", ...(name ? { title: name } : {}), geometry: g, autoPlace: true, content: JSON.stringify({ url }) });
      if (nodeId) { const s2 = await snapshot(); await call("POST", `/v1/workspaces/${workspaceId}/connections`, { expectedRevision: s2.workspace.revision, sourceNodeId: nodeId, targetNodeId: r.node.nodeId }).catch(() => {}); }
      console.log(`portal criado [${short(r.node.nodeId)}] "${r.node.title}"${url ? ` → ${url}` : ""}${nodeId ? " e ligado ao seu nó" : ""}`);
    } else {
      const OPS = ["open", "navigate", "back", "forward", "reload", "state", "close", "snapshot", "click", "type", "key", "scroll", "eval", "wait-text", "screenshot"];
      if (OPS.includes(args[0]!) && args[1] && !OPS.includes(args[1])) [args[0], args[1]] = [args[1]!, args[0]!]; // aceita também `mess portal snapshot <portal>` (ordem alternativa aceita)
      const ref = args.shift()!; const op = args.shift();
      const s = await snapshot(); const n = findNode(s.nodes.filter((x) => x.kind === "portal"), ref);
      if (!n) throw new Error("portal não encontrado (veja `mess portal list`)");
      const act = (a: Record<string, unknown>) => call<PortalActResult>("POST", `/v1/portals/${n.nodeId}/act`, a);
      const line = (r: PortalActResult) => console.log(`${r.state.title ? `${r.state.title} — ` : ""}${r.state.url || "(em branco)"}${r.state.loading ? " (carregando)" : ""}`);
      if (op === "info") { const st = await call<{ status: string; url: string; title: string; loading: boolean; width: number; height: number }>("GET", `/v1/portals/${n.nodeId}`); console.log(`${st.status}  ${st.url || "(em branco)"}  "${st.title}"  ${st.width}x${st.height}`); }
      else if (op === "open" || op === "navigate") { const url = args[0]; if (!url) throw new Error("uso: mess portal <portal> open <url>"); line(await act({ action: "navigate", url })); }
      else if (op === "back" || op === "forward" || op === "reload") line(await act({ action: op }));
      else if (op === "state") { const st = await call<{ status: string; url: string; title: string; loading: boolean; width: number; height: number }>("GET", `/v1/portals/${n.nodeId}`); console.log(`${st.status}  ${st.url || "(em branco)"}  "${st.title}"  ${st.width}x${st.height}${st.loading ? "  carregando" : ""}`); }
      else if (op === "close") { await act({ action: "close" }); console.log("portal fechado (o navegador é reaberto na URL salva ao próximo uso)"); }
      else if (op === "snapshot") {
        const full = flag("--full"); const sn = await call<PortalSnapshot>("GET", `/v1/portals/${n.nodeId}/snapshot`);
        console.log(`# ${sn.title || "(sem título)"} — ${sn.url}`);
        console.log(`\nElementos (use o número em click/type):`);
        for (const e of sn.elements) console.log(`[${e.ref}] ${e.tag}${e.type ? `:${e.type}` : ""}${e.role ? ` role=${e.role}` : ""} "${e.name}"${e.value ? ` value="${e.value}"` : ""}${e.href ? ` → ${e.href}` : ""}`);
        console.log(`\nTexto da página:\n${full ? sn.text : sn.text.slice(0, 4000)}${!full && sn.text.length > 4000 ? "\n… (use --full)" : ""}${sn.truncated ? "\n… (página maior que 30 mil caracteres)" : ""}`);
      }
      else if (op === "click") {
        const right = flag("--right"), dbl = flag("--double"); const t = args[0] ?? ""; const xy = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(t);
        if (!xy && !/^\d+$/.test(t)) throw new Error("uso: mess portal <portal> click <ref|x,y> [--right] [--double]");
        line(await act({ action: "click", ...(xy ? { x: Number(xy[1]), y: Number(xy[2]) } : { ref: Number(t) }), ...(right ? { button: "right" } : {}), ...(dbl ? { double: true } : {}) }));
      }
      else if (op === "type") {
        const submit = flag("--submit"), clear = flag("--clear"); const [r0, ...txt] = args;
        if (r0 === undefined || !/^\d+$/.test(r0)) throw new Error("uso: mess portal <portal> type <ref> <texto> [--submit] [--clear]");
        line(await act({ action: "type", ref: Number(r0), text: txt.join(" "), ...(submit ? { submit: true } : {}), ...(clear ? { clear: true } : {}) }));
      }
      else if (op === "key") { if (!args[0]) throw new Error("uso: mess portal <portal> key <Enter|Tab|ArrowDown|…>"); line(await act({ action: "key", key: args[0] })); }
      else if (op === "scroll") { const dy = Number(args[0]); if (!Number.isFinite(dy)) throw new Error("uso: mess portal <portal> scroll <dy> [dx]"); line(await act({ action: "scroll", dy, dx: Number(args[1] ?? 0) || 0 })); }
      else if (op === "eval") { if (!args.length) throw new Error("uso: mess portal <portal> eval <js>"); const r = await act({ action: "eval", expression: args.join(" ") }); console.log(typeof r.value === "string" ? r.value : JSON.stringify(r.value, null, 2)); }
      else if (op === "wait-text") { const to = flagVal("--timeout"); if (!args.length) throw new Error("uso: mess portal <portal> wait-text <texto> [--timeout seg]"); const r = await act({ action: "waitForText", text: args.join(" "), ...(to ? { timeoutMs: Math.round(Number(to) * 1000) } : {}) }); console.log(r.ok ? "encontrado" : (r.message ?? "não apareceu")); if (!r.ok) process.exitCode = 1; }
      else if (op === "screenshot") { const sh = await call<PortalScreenshot>("GET", `/v1/portals/${n.nodeId}/screenshot`); const f = resolvePath(args[0] ?? `portal-${short(n.nodeId)}.png`); writeFileSync(f, Buffer.from(sh.data, "base64")); console.log(`${f} (${sh.width}x${sh.height})`); }
      else throw new Error("uso: mess portal <portal> open|back|forward|reload|state|snapshot|click|type|key|scroll|eval|wait-text|screenshot|close");
    }
  } else if (cmd === "device") {
    const args = [sub, ...rest].filter((a): a is string => a !== undefined);
    const flag = (f: string) => { const i = args.indexOf(f); if (i >= 0) { args.splice(i, 1); return true; } return false; };
    const flagVal = (f: string) => { const i = args.indexOf(f); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
    const first = args[0];
    if (!first || first === "list") {
      const l = await call<DeviceList>("GET", "/v1/devices");
      if (!l.adb) console.log(`adb indisponível: ${l.adbError ?? ""}`);
      for (const d of l.devices) console.log(`${d.serial.padEnd(22)} ${d.state.padEnd(12)} ${d.kind.padEnd(8)} ${d.model ?? ""}`);
      if (l.adb && !l.devices.length) console.log("Nenhum dispositivo conectado.");
      console.log(l.avds.length ? `AVDs (emuladores): ${l.avds.join(", ")}` : l.emulator ? "Nenhum AVD criado." : "Emulador Android não instalado.");
      const s = await snapshot(); const ds = s.nodes.filter((n) => n.kind === "device");
      if (ds.length) { console.log("\nNós de dispositivo neste espaço:"); for (const n of ds) console.log(`${short(n.nodeId)}  ${n.title}`); }
    } else if (first === "new") {
      args.shift(); const name = flagVal("--name"); const serial = flagVal("--serial"); const avd = flagVal("--avd");
      const s = await snapshot(); const me = s.nodes.find((n) => n.nodeId === nodeId);
      const g = me ? { x: me.geometry.x + me.geometry.w + 40, y: me.geometry.y, w: 360, h: 640 } : { x: 40, y: 40, w: 360, h: 640 };
      const r = await call<{ node: Node }>("POST", `/v1/workspaces/${workspaceId}/nodes`, { expectedRevision: s.workspace.revision, kind: "device", ...(name ? { title: name } : {}), geometry: g, autoPlace: true, content: JSON.stringify({ ...(serial ? { serial } : {}), ...(avd ? { avd } : {}) }) });
      if (nodeId) { const s2 = await snapshot(); await call("POST", `/v1/workspaces/${workspaceId}/connections`, { expectedRevision: s2.workspace.revision, sourceNodeId: nodeId, targetNodeId: r.node.nodeId }).catch(() => {}); }
      console.log(`dispositivo criado [${short(r.node.nodeId)}] "${r.node.title}"${nodeId ? " e ligado ao seu nó" : ""}`);
    } else {
      const OPS = ["select", "boot", "disconnect", "shutdown", "state", "ui", "tap", "longpress", "swipe", "key", "text", "launch", "stop", "apps", "screenshot"];
      if (OPS.includes(args[0]!) && args[1] && !OPS.includes(args[1])) [args[0], args[1]] = [args[1]!, args[0]!]; // aceita também `mess device tap <nó> …`
      const ref = args.shift()!; const op = args.shift();
      const s = await snapshot(); const n = findNode(s.nodes.filter((x) => x.kind === "device"), ref);
      if (!n) throw new Error("nó de dispositivo não encontrado (veja `mess device list`)");
      const act = (a: Record<string, unknown>) => call<DeviceActResult>("POST", `/v1/devices/${n.nodeId}/act`, a);
      const num = (v: string | undefined, what: string) => { const x = Number(v); if (v === undefined || !Number.isFinite(x)) throw new Error(`${what} inválido`); return x; };
      const line = (r: DeviceActResult) => console.log(`${r.state.status}${r.state.serial ? ` ${r.state.serial}` : ""}${r.state.model ? ` (${r.state.model})` : ""}${r.state.foreground ? ` · ${r.state.foreground}` : ""}`);
      if (op === "select") { if (!args[0]) throw new Error("uso: mess device <nó> select <serial>"); line(await act({ action: "select", serial: args[0] })); }
      else if (op === "boot") { const persist = flag("--persist"); if (!args[0]) throw new Error("uso: mess device <nó> boot <avd> [--persist]"); console.log("iniciando o emulador (1–2 min)…"); line(await act({ action: "boot", avd: args[0], ...(persist ? { persist: true } : {}) })); }
      else if (op === "disconnect" || op === "shutdown") line(await act({ action: op }));
      else if (op === "state") { const st = await call<DeviceState>("GET", `/v1/devices/${n.nodeId}`); console.log(`${st.status}  ${st.serial ?? "-"}  ${st.avd ?? ""}  ${st.model ?? ""}  ${st.width}x${st.height}${st.foreground ? `  ${st.foreground}` : ""}${st.error ? `  ERRO: ${st.error}` : ""}${st.message ? `  ${st.message}` : ""}`); }
      else if (op === "tap") line(await act({ action: "tap", x: num(args[0], "x"), y: num(args[1], "y") }));
      else if (op === "longpress") line(await act({ action: "longpress", x: num(args[0], "x"), y: num(args[1], "y"), ...(args[2] ? { ms: num(args[2], "ms") } : {}) }));
      else if (op === "swipe") line(await act({ action: "swipe", x1: num(args[0], "x1"), y1: num(args[1], "y1"), x2: num(args[2], "x2"), y2: num(args[3], "y2"), ...(args[4] ? { ms: num(args[4], "ms") } : {}) }));
      else if (op === "key") { if (!args[0]) throw new Error("uso: mess device <nó> key <back|home|recents|enter|…>"); line(await act({ action: "key", key: args[0] })); }
      else if (op === "text") { if (!args.length) throw new Error("uso: mess device <nó> text <texto ASCII>"); line(await act({ action: "text", text: args.join(" ") })); }
      else if (op === "launch") { if (!args[0]) throw new Error("uso: mess device <nó> launch <pacote> [atividade]"); line(await act({ action: "launch", package: args[0], ...(args[1] ? { activity: args[1] } : {}) })); }
      else if (op === "stop") { if (!args[0]) throw new Error("uso: mess device <nó> stop <pacote>"); line(await act({ action: "stop", package: args[0] })); }
      else if (op === "apps") for (const p of await call<string[]>("GET", `/v1/devices/${n.nodeId}/apps`)) console.log(p);
      else if (op === "ui") {
        const all = flag("--all"); const t = await call<DeviceUiTree>("GET", `/v1/devices/${n.nodeId}/ui`);
        for (const e of t.nodes) {
          if (!all && !(e.text || e.desc || e.clickable || e.scrollable)) continue;
          const cx = Math.round((e.bounds.x1 + e.bounds.x2) / 2), cy = Math.round((e.bounds.y1 + e.bounds.y2) / 2);
          console.log(`${"  ".repeat(all ? e.depth : 0)}[${e.ref}] ${e.cls.split(".").pop()}${e.text ? ` "${e.text}"` : ""}${e.desc ? ` desc="${e.desc}"` : ""}${e.resourceId ? ` id=${e.resourceId}` : ""} centro=(${cx},${cy})${e.clickable ? " clicável" : ""}${e.scrollable ? " rolável" : ""}${e.enabled ? "" : " desabilitado"}${e.checked ? " marcado" : ""}`);
        }
        if (t.truncated) console.log("… (árvore truncada)");
      }
      else if (op === "screenshot") { const sh = await call<DeviceScreenshot>("GET", `/v1/devices/${n.nodeId}/screenshot`); const f = resolvePath(args[0] ?? `device-${short(n.nodeId)}.png`); writeFileSync(f, Buffer.from(sh.data, "base64")); console.log(`${f} (${sh.width}x${sh.height})`); }
      else throw new Error("uso: mess device <nó> select|boot|disconnect|shutdown|state|ui|tap|longpress|swipe|key|text|launch|stop|apps|screenshot");
    }
  } else if (cmd === "maestro") {
    if (!nodeId) throw new Error("sem MESS_NODE_ID");
    const args = [sub, ...rest].filter((a): a is string => a !== undefined);
    const op = args.shift();
    const flags = (f: string) => { const out: string[] = []; for (let i = args.indexOf(f); i >= 0; i = args.indexOf(f)) { const v = args[i + 1]; args.splice(i, 2); if (v !== undefined) out.push(v); } return out; };
    if (op === "recruit") {
      const persist = (() => { const i = args.indexOf("--persist"); if (i < 0) return false; args.splice(i, 1); return true; })();
      const [preset] = flags("--preset"), [command] = flags("--command"), [name] = flags("--name"), [roleName] = flags("--role"), [band] = flags("--band"), [cwd] = flags("--cwd"); const a = flags("--arg");
      if (!preset && !command) throw new Error("uso: mess maestro recruit (--preset <id> | --command <cmd> [--arg a]...) [--name n] [--role r] [--band b] [--cwd d] [--persist]");
      const r = await call<{ node: Node; bandId?: string }>("POST", `/v1/nodes/${nodeId}/maestro/recruit`, { ...(preset ? { preset } : {}), ...(command ? { command } : {}), ...(a.length ? { args: a } : {}), ...(name ? { name } : {}), ...(roleName ? { roleName } : {}), ...(band ? { band } : {}), ...(cwd ? { cwd } : {}), ...(persist ? { persistent: true } : {}) });
      console.log(`recrutado "${r.node.title}" [${short(r.node.nodeId)}]${r.bandId ? ` na banda ${band}` : ""}`);
    } else if (op === "dismiss") {
      const [ref] = args; if (!ref) throw new Error("uso: mess maestro dismiss <nó>");
      const r = await call<{ title: string }>("POST", `/v1/nodes/${nodeId}/maestro/dismiss`, { ref }); console.log(`dispensado "${r.title}"`);
    } else if (op === "assign") {
      const [ref, role] = args; if (!ref || !role) throw new Error("uso: mess maestro assign <nó> <papel|->");
      const r = await call<Node>("POST", `/v1/nodes/${nodeId}/maestro/assign`, { ref, roleName: role === "-" ? null : role }); console.log(`"${r.title}": ${role === "-" ? "sem papel" : `papel ${role}`}`);
    } else if (op === "interrupt" || op === "stop") {
      const all = (() => { const i = args.indexOf("--all"); if (i < 0) return false; args.splice(i, 1); return true; })();
      const [ref] = args; if (!all && !ref) throw new Error("uso: mess maestro interrupt <nó> | --all");
      const r = await call<{ interrupted: number; titles: string[] }>("POST", `/v1/nodes/${nodeId}/maestro/interrupt`, { ...(all ? { all: true } : { ref }) });
      console.log(r.interrupted ? `interrompido(s) ${r.interrupted}: ${r.titles.join(", ")}` : "nenhum recrutado em execução para interromper");
    } else throw new Error("uso: mess maestro recruit|dismiss|assign|interrupt");
  } else if (cmd === "close" || cmd === "delete" || cmd === "rm") {
    // apaga um nó não-terminal do espaço (nota, portal, dispositivo, fichário…); terminais vão por `mess maestro dismiss`
    const ref = [sub, ...rest].filter((a): a is string => a !== undefined).join(" ").trim();
    if (!ref) throw new Error("uso: mess close <id|título>  (nota/portal/dispositivo) — terminal: use mess maestro dismiss");
    const s = await snapshot();
    const n = findNode(s.nodes, ref);
    if (!n) throw new Error(`nó não encontrado: ${ref}`);
    if (n.kind === "terminal") throw new Error(`"${n.title}" é um terminal — use: mess maestro dismiss "${n.title}"`);
    await call("DELETE", `/v1/nodes/${n.nodeId}`, { expectedRevision: s.workspace.revision });
    console.log(`apagado: ${n.kind} "${n.title}"`);
  } else if (cmd === "connect") {
    if (!nodeId) throw new Error("sem MESS_NODE_ID");
    const targetRef = [sub, ...rest].filter((a): a is string => a !== undefined).join(" ").trim();
    if (!targetRef) throw new Error("uso: mess connect <id|título|Nome @ Espaço>");
    const s = await snapshot();
    const n = !targetRef.includes("@") ? findNode(s.nodes, targetRef) : undefined;
    await call("POST", `/v1/workspaces/${workspaceId}/connections`, {
      expectedRevision: s.workspace.revision,
      sourceNodeId: nodeId,
      ...(n ? { targetNodeId: n.nodeId } : { targetRef }),
    });
    console.log(`ligado a "${n ? n.title : targetRef}"`);
  } else if (cmd === "env") {
    const args = [sub, ...rest].filter((a): a is string => a !== undefined);
    const has = (f: string) => { const i = args.indexOf(f); if (i < 0) return false; args.splice(i, 1); return true; };
    const isGlobal = has("--global");
    const reveal = has("--reveal");
    const secret = has("--secret");
    const op = args.shift() ?? "list";
    const endpoint = isGlobal ? "/v1/environments/global" : `/v1/workspaces/${workspaceId}/env`;
    const cur = await call<EnvVarEntry[]>("GET", endpoint);
    if (op === "list") {
      if (!cur.length) console.log(isGlobal ? "nenhuma variável global" : "nenhuma variável neste espaço");
      for (const v of cur) {
        const val = v.secret && !reveal ? "••••••••" : v.value;
        console.log(`${v.key}=${val}${v.secret ? "  (secreto)" : ""}`);
      }
    } else if (op === "set") {
      const pair = args.join(" ").trim();
      const eq = pair.indexOf("=");
      if (eq <= 0) throw new Error("uso: mess env set <KEY=VALUE> [--global] [--secret]");
      const key = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1);
      const next = [...cur.filter((v) => v.key !== key), { key, value, ...(secret ? { secret: true } : {}) }];
      await call<EnvVarEntry[]>("PUT", endpoint, { vars: next });
      console.log(`${key} salvo (${isGlobal ? "global" : "espaço"})`);
    } else if (op === "unset") {
      const key = (args[0] ?? "").trim();
      if (!key) throw new Error("uso: mess env unset <KEY> [--global]");
      const next = cur.filter((v) => v.key !== key);
      await call<EnvVarEntry[]>("PUT", endpoint, { vars: next });
      console.log(`${key} removido (${isGlobal ? "global" : "espaço"})`);
    } else throw new Error("uso: mess env [list|set|unset] [--global]");
  } else if (cmd === "workspace") {
    const args = [sub, ...rest].filter((a): a is string => a !== undefined);
    const flag = (f: string) => { const i = args.indexOf(f); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
    const op = args.shift() ?? "export";
    if (op === "export") {
      const outPath = args[0];
      const bundle = await call<WorkspaceBundle>("GET", `/v1/workspaces/${workspaceId}/export`);
      const text = JSON.stringify(bundle, null, 2);
      if (outPath) {
        writeFileSync(resolvePath(outPath), text, "utf8");
        console.log(`exportado para ${resolvePath(outPath)} (${bundle.nodes.length} nós)`);
      } else {
        console.log(text);
      }
    } else if (op === "preview") {
      const inPath = args[0];
      if (!inPath) throw new Error("uso: mess workspace preview <arquivo.messai>");
      const bundle = JSON.parse(readFileSync(resolvePath(inPath), "utf8")) as WorkspaceBundle;
      const prev = await call<WorkspaceBundlePreview>("POST", "/v1/workspaces/import/preview", { bundle });
      console.log(`Espaço: ${prev.name} (${prev.cwd}) · ${prev.counts.nodes} nós (${prev.counts.terminals} terminais, ${prev.counts.notes} notas) · ${prev.counts.connections} conexões · ${prev.counts.envVars} vars`);
    } else if (op === "import") {
      const name = flag("--name");
      const cwd = flag("--cwd");
      const inPath = args[0];
      if (!inPath) throw new Error("uso: mess workspace import <arquivo.messai> [--name n] [--cwd d]");
      const bundle = JSON.parse(readFileSync(resolvePath(inPath), "utf8")) as WorkspaceBundle;
      const w = await call<Workspace>("POST", "/v1/workspaces/import", { bundle, ...(name ? { name } : {}), ...(cwd ? { cwd } : {}) });
      console.log(`importado "${w.name}" [${short(w.workspaceId)}]`);
    } else if (op === "duplicate") {
      const name = flag("--name");
      const cwd = flag("--cwd");
      const w = await call<Workspace>("POST", `/v1/workspaces/${workspaceId}/duplicate`, { ...(name ? { name } : {}), ...(cwd ? { cwd } : {}) });
      console.log(`duplicado "${w.name}" [${short(w.workspaceId)}]`);
    } else throw new Error("uso: mess workspace [export [arquivo] | preview <arquivo> | import <arquivo> [--name n] [--cwd d] | duplicate [--name n]]");
  } else if (cmd === "unload" || cmd === "reload") {
    const args = [sub, ...rest].filter((a): a is string => a !== undefined);
    const wsFlag = args.includes("--workspace");
    if (wsFlag) {
      if (cmd === "unload") {
        const r = await call<{ workspace: Workspace; unloadedCount: number }>("POST", `/v1/workspaces/${workspaceId}/unload`);
        console.log(`espaço "${r.workspace.name}" descarregado (${r.unloadedCount} terminal(is))`);
      } else {
        const r = await call<{ workspace: Workspace; reloadedCount: number }>("POST", `/v1/workspaces/${workspaceId}/reload`);
        console.log(`espaço "${r.workspace.name}" recarregado (${r.reloadedCount} terminal(is))`);
      }
    } else {
      const ref = args.join(" ").trim();
      let targetId = nodeId;
      if (ref) {
        const s = await snapshot();
        const n = findNode(s.nodes, ref);
        if (!n) throw new Error(`nó não encontrado: ${ref}`);
        targetId = n.nodeId;
      }
      if (!targetId) throw new Error(`uso: mess ${cmd} [<id|título> | --workspace]`);
      const sess = await call<Session>("POST", `/v1/nodes/${targetId}/${cmd}`);
      console.log(`terminal [${short(targetId)}] ${cmd === "unload" ? "descarregado" : "recarregado"} (${sess.state})`);
    }
  } else if (cmd === "notify") {
    const args = [sub, ...rest].filter((a): a is string => a !== undefined);
    const flag = (f: string) => { const i = args.indexOf(f); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
    const title = flag("--title");
    const text = args.join(" ").trim();
    if (!text) throw new Error("uso: mess notify <texto> [--title <título>]");
    const n = await call<NotificationItem>("POST", "/v1/notify", {
      text,
      ...(title ? { title } : {}),
      ...(workspaceId ? { workspaceId } : {}),
      ...(nodeId ? { nodeId } : {}),
    });
    console.log(`notificação enviada [${short(n.notificationId)}]`);
  } else if (cmd === "routine") {
    const args = [sub, ...rest].filter((a): a is string => a !== undefined);
    const flag = (f: string) => { const i = args.indexOf(f); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
    const has = (f: string) => { const i = args.indexOf(f); if (i < 0) return false; args.splice(i, 1); return true; };
    const op = args.shift() ?? "list";
    const listRoutines = () => call<Routine[]>("GET", `/v1/workspaces/${workspaceId}/routines`);
    const findRoutine = async (ref: string | undefined) => {
      const r = (ref ?? "").toLowerCase();
      const all = await listRoutines();
      const found = all.find((x) => x.routineId.startsWith(r) || x.name.toLowerCase() === r);
      if (!found || !r) throw new Error(`rotina não encontrada: ${ref ?? ""}`);
      return found;
    };
    if (op === "list") {
      const list = await listRoutines();
      if (!list.length) console.log("nenhuma rotina");
      for (const r of list) {
        console.log(`${short(r.routineId)}  ${(r.enabled ? "ativa" : "pausada").padEnd(8)}  ${r.name.padEnd(20)}  ${r.actionType} (${r.intervalSeconds}s)  runs=${r.runCount}`);
      }
    } else if (op === "create") {
      const prompt = flag("--prompt");
      const command = flag("--command");
      const every = flag("--every");
      const nodeRef = flag("--node");
      const once = has("--once");
      const noWake = has("--no-wake");
      const name = args.join(" ").trim();
      if (!name || (!prompt && !command)) throw new Error("uso: mess routine create <nome> (--prompt <texto> [--node <ref>] | --command <cmd>) [--every <seg>] [--once]");
      let targetNodeId: string | undefined;
      if (nodeRef) {
        const s = await snapshot();
        const n = findNode(s.nodes, nodeRef);
        if (!n) throw new Error(`terminal não encontrado: ${nodeRef}`);
        targetNodeId = n.nodeId;
      }
      const r = await call<Routine>("POST", `/v1/workspaces/${workspaceId}/routines`, {
        name,
        actionType: prompt ? "prompt" : "command",
        payload: (prompt ?? command)!,
        ...(targetNodeId ? { targetNodeId } : {}),
        scheduleType: once ? "once" : "interval",
        intervalSeconds: every ? Math.max(1, Number(every)) : 300,
        wakeIfUnloaded: !noWake,
      });
      console.log(`rotina "${r.name}" criada [${short(r.routineId)}]`);
    } else if (op === "run") {
      const r = await findRoutine(args[0]);
      const res = await call<RoutineRunResult>("POST", `/v1/routines/${r.routineId}/run`);
      console.log(`[${res.status}] ${res.output}`);
    } else if (op === "enable" || op === "disable") {
      const r = await findRoutine(args[0]);
      const upd = await call<Routine>("PATCH", `/v1/routines/${r.routineId}`, { enabled: op === "enable" });
      console.log(`rotina "${upd.name}": ${upd.enabled ? "ativa" : "pausada"}`);
    } else if (op === "delete") {
      const r = await findRoutine(args[0]);
      await call("DELETE", `/v1/routines/${r.routineId}`);
      console.log(`rotina "${r.name}" removida`);
    } else throw new Error("uso: mess routine [list|create|run|enable|disable|delete]");
  } else { console.error(`comando desconhecido: ${cmd} ${sub ?? ""}`); process.exit(2); }
} catch (e) { console.error(String(e instanceof Error ? e.message : e)); process.exit(1); }
