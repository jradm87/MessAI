import { useEffect, useRef, useState } from "react";
import { useAtomValue } from "jotai";
import { Search, Eraser, Lock, Eye, Folder } from "lucide-react";
import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { SearchAddon } from "@xterm/addon-search";
import "@xterm/xterm/css/xterm.css";
import type { Session } from "@messai/contracts";
import type { Api, Stream } from "./api.js";
import { unreadAtom, attentionAtom, finishedAtom, finishedMapAtom, store } from "./atoms.js";
import { onTheme, cssVar } from "./theme.js";
import { EditableTitle } from "./EditableTitle.js";
import { Composer, type MentionTarget } from "./Composer.js";
import { ChatLayer } from "./ChatLayer.js";
import type { ChatMessage, Role } from "@messai/contracts";

export type NodeExtras = { onLink: () => void; linkCount: number; onChat: () => void; onRaise: () => void };
export type ComposerExtras = { composerOpen: boolean; onComposerClose: () => void; onFocus: () => void; workspaceId: string; targets: MentionTarget[]; chatOpen: boolean; onChatClose: () => void; role?: Role; roles: Role[]; onSetRole: (roleId: string | null) => void; onManageRoles: () => void };
export type TerminalData = { title: string; sessionId: string; api: Api; stream: Stream; onDelete: () => void; onRename: (t: string) => void; onResume: () => void; editSignal?: number } & NodeExtras & ComposerExtras;

export function TerminalNode({ id, data, selected }: NodeProps & { data: TerminalData }) {
  const host = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal>(null);
  const searchRef = useRef<SearchAddon>(null);
  const [find, setFind] = useState<string | null>(null); // null = fechado; string = busca aberta
  const [session, setSession] = useState<Session | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const resumedRef = useRef(false);
  const stateRef = useRef<string>("");
  const { sessionId, stream, api } = data;
  const unread = useAtomValue(unreadAtom(id)); // só este nó re-renderiza quando a sua contagem muda
  const attention = useAtomValue(attentionAtom(id));
  const finishedAt = useAtomValue(finishedAtom(id)); // #65: agente concluiu um turno e espera você

  useEffect(() => {
    // Tema do xterm vem dos tokens do app (#54): acompanha claro/escuro; re-aplicado quando o tema muda.
    const xtermTheme = () => ({ background: cssVar("--term-bg") || "#0a0a0b", foreground: cssVar("--term-fg") || "#e4e4e7", cursor: cssVar("--acc") || "#4a9eff", selectionBackground: cssVar("--term-sel") || "rgba(74,158,255,.35)" });
    const term = new Terminal({ cursorBlink: true, fontSize: 14, fontFamily: '"JetBrainsMono Nerd Font", "MesloLGS NF", "FiraCode Nerd Font", "JetBrains Mono", "Cascadia Code", Menlo, Consolas, "DejaVu Sans Mono", ui-monospace, monospace', theme: xtermTheme(), scrollback: 2000, allowProposedApi: true });
    const fit = new FitAddon();
    const search = new SearchAddon();
    term.loadAddon(new Unicode11Addon());
    term.loadAddon(fit);
    term.loadAddon(search);
    searchRef.current = search;
    term.unicode.activeVersion = "11"; // largura correta de glyphs (powerline/CJK) — evita a quebra errada do prompt
    // Ctrl+F abre a busca sem repassar ao shell (no readline seria forward-char).
    term.attachCustomKeyEventHandler((e) => { if (e.type === "keydown" && (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "f") { setFind((v) => v ?? ""); return false; } return true; });
    term.open(host.current!);
    // Renderer canvas/DOM (sem WebGL de propósito): o React Flow aplica `transform: scale` no
    // zoom, e o renderer WebGL ignora esse scale — mede a célula errado, o `fit` calcula colunas
    // demais e o `ls`/prompt saem embaralhados (timestamps repetidos, conteúdo jogado pra direita).
    // O canvas respeita o scale do CSS e mede a célula de forma confiável.
    termRef.current = term;
    const offTheme = onTheme(() => { term.options.theme = xtermTheme(); });
    let lastSeq = 0;
    let mine = false;
    const sendResize = () => { if (mine) stream.send({ type: "resize", sessionId, cols: term.cols, rows: term.rows }); };
    const off = stream.on((m) => {
      if ("sessionId" in m && m.sessionId !== sessionId) return;
      if (m.type === "snapshot") { term.reset(); term.write(m.data); lastSeq = m.sequence; mine = m.session.lease?.clientId === stream.clientId; setSession(m.session); stateRef.current = m.session.state; if (m.session.state === "lost" && !resumedRef.current) { resumedRef.current = true; data.onResume(); } }
      else if (m.type === "output") {
        if (m.sequence > lastSeq + 1) stream.attach(sessionId); // lacuna: pede snapshot de novo
        else { term.write(m.data); lastSeq = m.sequence; }
      }
      else if (m.type === "session" && m.session.sessionId === sessionId) { const was = mine; mine = m.session.lease?.clientId === stream.clientId; setSession(m.session); stateRef.current = m.session.state; if (m.session.state === "lost" && !resumedRef.current) { resumedRef.current = true; data.onResume(); } if (mine && !was) sendResize(); }
      else if (m.type === "error" && "sessionId" in m) { if (m.error.code !== "NOT_FOUND") { setErr(m.error.message); setTimeout(() => setErr(null), 2500); } }
    });
    stream.attach(sessionId);
    const onData = term.onData((d) => stream.send({ type: "input", sessionId, data: d }));
    // Blindagem: só aplica o tamanho proposto se for são. Dimensões absurdas (célula medida ~0
    // durante uma transição de zoom/layout) deixariam o PTY com centenas de colunas e embaralhariam a saída.
    const ro = new ResizeObserver(() => {
      try {
        const d = fit.proposeDimensions();
        if (!d || !Number.isFinite(d.cols) || !Number.isFinite(d.rows)) return;
        if (d.cols < 2 || d.rows < 1 || d.cols > 1000 || d.rows > 1000) return;
        if (d.cols !== term.cols || d.rows !== term.rows) term.resize(d.cols, d.rows);
        sendResize();
      } catch { /* ainda sem layout */ }
    });
    ro.observe(host.current!);
    const el = host.current!;
    const focus = () => {
      if (stateRef.current === "running") stream.send({ type: "acquireLease", sessionId });
      // Olhou o terminal: o "concluiu, precisa de você" (#65) deste nó foi atendido.
      store.set(finishedMapAtom, (p) => { if (!(id in p)) return p; const n = { ...p }; delete n[id]; return n; });
      data.onFocus();
    };
    el.addEventListener("focusin", focus);
    return () => { ro.disconnect(); onData.dispose(); off(); offTheme(); el.removeEventListener("focusin", focus); stream.detach(sessionId); term.dispose(); };
  }, [sessionId, stream]);

  const mine = session?.lease?.clientId === stream.clientId;
  const state = session?.state ?? "…";
  const [roleMenu, setRoleMenu] = useState(false);
  // chat por terminal
  const [thread, setThread] = useState(1);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [chatUnread, setChatUnread] = useState(0);
  const chatOpenRef = useRef(data.chatOpen); useEffect(() => { chatOpenRef.current = data.chatOpen; if (data.chatOpen) setChatUnread(0); }, [data.chatOpen]);
  useEffect(() => {
    void api.chat(id).then(setChat).catch(() => {});
    return stream.on((m) => {
      if (m.type !== "chat" || m.message.nodeId !== id) return;
      if (m.message.role === "system" && m.message.text === "__cleared__") { void api.chat(id).then(setChat).catch(() => {}); return; }
      setChat((c) => [...c, m.message]);
      if (m.message.role === "agent" && !chatOpenRef.current) setChatUnread((n) => n + 1);
    });
  }, [id, api, stream]);
  return (
    <div className={`node terminal ${selected ? "sel" : ""} ${attention ? "att" : ""}`}>
      <NodeResizer minWidth={240} minHeight={160} isVisible={selected} />
      <Composer open={data.composerOpen} nodeId={id} workspaceId={data.workspaceId} sessionId={sessionId} title={data.title} targets={data.targets} api={api} stream={stream} onClose={data.onComposerClose} {...(data.chatOpen ? { chatThread: thread } : {})} />
      <div className="bar nodrag-off">
        {attention && <span className="dot" title={finishedAt ? `concluiu e espera você (${new Date(finishedAt).toLocaleTimeString()}) — Ctrl+Shift+A` : "precisa de atenção (Ctrl+Shift+A)"} />}
        <EditableTitle value={data.title} onSave={data.onRename} editSignal={data.editSignal ?? 0} />
        <span className={`role-pill nodrag ${data.role ? "" : "none"}`} title={data.role ? `Papel: ${data.role.name}\n${data.role.instructions.slice(0, 200)}` : "Sem papel (clique para atribuir)"} data-testid="role-pill" onClick={(e) => { e.stopPropagation(); setRoleMenu((v) => !v); }}>
          {data.role ? <><span className="role-badge">{data.role.badge || data.role.name.slice(0, 2).toUpperCase()}</span>{data.role.name}</> : "papel"}
        </span>
        {roleMenu && (
          <div className="menu role-menu nodrag" onMouseLeave={() => setRoleMenu(false)}>
            <div className={`mi ${!data.role ? "on" : ""}`} onClick={() => { setRoleMenu(false); data.onSetRole(null); }}>Sem papel</div>
            {data.roles.map((r) => <div key={r.roleId} className={`mi ${data.role?.roleId === r.roleId ? "on" : ""}`} onClick={() => { setRoleMenu(false); data.onSetRole(r.roleId); }}><span className="role-badge">{r.badge}</span>{r.name}</div>)}
            <hr /><div className="mi" onClick={() => { setRoleMenu(false); data.onManageRoles(); }}>Gerenciar…</div>
          </div>
        )}
        <span className={`st ${state}`} title={`${state}${session?.pid ? ` · pid ${session.pid}` : ""}${session?.lease ? (mine ? " · você controla" : " · observando") : ""}`}>
          {state}
          {session?.persistent && <span className="tag">tmux</span>}
          {session?.lease && (mine ? <Lock size={10} /> : <Eye size={10} />)}
        </span>
        {unread > 0 && <span className="badge" title="mensagens não lidas de outros agentes (mess inbox)">✉ {unread}</span>}
        {chatUnread > 0 && <span className="badge chatb" title="respostas no chat (Ctrl+J)">💬 {chatUnread}</span>}
        <span className="sp" />
        <button title="Buscar no terminal (Ctrl+F)" className="nodrag" onClick={() => setFind((v) => (v === null ? "" : null))}><Search size={12} /></button>
        <button title="Limpar a tela" className="nodrag" onClick={() => termRef.current?.clear()}><Eraser size={12} /></button>
        {state === "running" && <button title="Parar processo" onClick={() => void api.stop(sessionId)}>■</button>}
        {(state === "exited" || state === "lost") && <button title="Reiniciar" onClick={() => void api.restart(id)}>↻</button>}
        <button title="Remover nó" onClick={data.onDelete}>✕</button>
      </div>
      {err && <div className="err">{err}</div>}
      <div className="term-wrap">
        {find !== null && (
          <div className="term-find nodrag nowheel">
            <input autoFocus value={find} placeholder="Buscar no terminal…"
              onChange={(e) => { setFind(e.target.value); searchRef.current?.findNext(e.target.value, { incremental: true }); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); const s = searchRef.current; if (s) { if (e.shiftKey) s.findPrevious(find ?? ""); else s.findNext(find ?? ""); } }
                else if (e.key === "Escape") { e.preventDefault(); setFind(null); searchRef.current?.clearDecorations(); }
              }} />
            <button title="Anterior (Shift+Enter)" onClick={() => searchRef.current?.findPrevious(find ?? "")}>↑</button>
            <button title="Próximo (Enter)" onClick={() => searchRef.current?.findNext(find ?? "")}>↓</button>
            <button title="Fechar (Esc)" onClick={() => { setFind(null); searchRef.current?.clearDecorations(); }}>✕</button>
          </div>
        )}
        <div className="term nodrag nowheel" ref={host} tabIndex={0}
          onDragOver={(e) => { if (e.dataTransfer.types.includes("text/mess-path") || e.dataTransfer.types.includes("text/plain")) e.preventDefault(); }}
          onDrop={(e) => { const p = e.dataTransfer.getData("text/mess-path") || e.dataTransfer.getData("text/plain"); if (!p) return; e.preventDefault(); stream.send({ type: "acquireLease", sessionId }); stream.send({ type: "input", sessionId, data: /\s/.test(p) ? `'${p}' ` : `${p} ` }); }} />
        {data.chatOpen && <ChatLayer nodeId={id} title={data.title} api={api} thread={thread} setThread={setThread} messages={chat} onClose={data.onChatClose} />}
      </div>
      {session?.cwd && <div className="footbar nodrag" title={session.cwd}><Folder size={11} /><span className="cwd">{session.cwd.replace(/^\/home\/[^/]+/, "~")}</span></div>}
      <Handle type="source" position={Position.Right} /><Handle type="target" position={Position.Left} />
    </div>
  );
}
