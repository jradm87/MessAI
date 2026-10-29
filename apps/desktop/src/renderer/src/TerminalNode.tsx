import { useEffect, useRef, useState } from "react";
import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { Session } from "@messyai/contracts";
import type { Api, Stream } from "./api.js";
import { EditableTitle } from "./EditableTitle.js";
import { Composer, type MentionTarget } from "./Composer.js";
import { ChatLayer } from "./ChatLayer.js";
import type { ChatMessage, Role } from "@messyai/contracts";

export type NodeExtras = { onLink: () => void; linkCount: number; onChat: () => void; onRaise: () => void; attention?: boolean };
export type ComposerExtras = { composerOpen: boolean; onComposerClose: () => void; onFocus: () => void; workspaceId: string; targets: MentionTarget[]; chatOpen: boolean; onChatClose: () => void; role?: Role; roles: Role[]; onSetRole: (roleId: string | null) => void; onManageRoles: () => void };
export type TerminalData = { title: string; sessionId: string; unread: number; api: Api; stream: Stream; onDelete: () => void; onRename: (t: string) => void; onResume: () => void; editSignal?: number } & NodeExtras & ComposerExtras;

export function TerminalNode({ id, data, selected }: NodeProps & { data: TerminalData }) {
  const host = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const resumedRef = useRef(false);
  const stateRef = useRef<string>("");
  const { sessionId, stream, api } = data;

  useEffect(() => {
    const term = new Terminal({ cursorBlink: true, fontSize: 14, fontFamily: "ui-monospace, monospace", theme: { background: "#0a0a0b" }, scrollback: 2000 });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current!);
    termRef.current = term;
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
    const ro = new ResizeObserver(() => { try { fit.fit(); sendResize(); } catch { /* ainda sem layout */ } });
    ro.observe(host.current!);
    const el = host.current!;
    const focus = () => { if (stateRef.current === "running") stream.send({ type: "acquireLease", sessionId }); data.onFocus(); };
    el.addEventListener("focusin", focus);
    return () => { ro.disconnect(); onData.dispose(); off(); el.removeEventListener("focusin", focus); stream.detach(sessionId); term.dispose(); };
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
    <div className={`node terminal ${selected ? "sel" : ""} ${data.attention ? "att" : ""}`}>
      <NodeResizer minWidth={240} minHeight={160} isVisible={selected} />
      <Composer open={data.composerOpen} nodeId={id} workspaceId={data.workspaceId} sessionId={sessionId} title={data.title} targets={data.targets} api={api} stream={stream} onClose={data.onComposerClose} {...(data.chatOpen ? { chatThread: thread } : {})} />
      <div className="bar nodrag-off">
        {data.attention && <span className="dot" title="precisa de atenção (Ctrl+Shift+A)" />}
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
        <span className={`st ${state}`}>{state}{session?.persistent ? " · tmux" : ""}{session?.pid ? ` · pid ${session.pid}` : ""}{session?.lease ? (mine ? " · você controla" : " · observando") : ""}</span>
        {data.unread > 0 && <span className="badge" title="mensagens não lidas de outros agentes (messy inbox)">✉ {data.unread}</span>}
        {chatUnread > 0 && <span className="badge chatb" title="respostas no chat (Ctrl+J)">💬 {chatUnread}</span>}
        <span className="sp" />
        {state === "running" && <button title="Parar processo" onClick={() => void api.stop(sessionId)}>■</button>}
        {(state === "exited" || state === "lost") && <button title="Reiniciar" onClick={() => void api.restart(id)}>↻</button>}
        <button title="Remover nó" onClick={data.onDelete}>✕</button>
      </div>
      {err && <div className="err">{err}</div>}
      <div className="term-wrap">
        <div className="term nodrag nowheel" ref={host} tabIndex={0}
          onDragOver={(e) => { if (e.dataTransfer.types.includes("text/messy-path") || e.dataTransfer.types.includes("text/plain")) e.preventDefault(); }}
          onDrop={(e) => { const p = e.dataTransfer.getData("text/messy-path") || e.dataTransfer.getData("text/plain"); if (!p) return; e.preventDefault(); stream.send({ type: "acquireLease", sessionId }); stream.send({ type: "input", sessionId, data: /\s/.test(p) ? `'${p}' ` : `${p} ` }); }} />
        {data.chatOpen && <ChatLayer nodeId={id} title={data.title} api={api} thread={thread} setThread={setThread} messages={chat} onClose={data.onChatClose} />}
      </div>
      <Handle type="source" position={Position.Right} /><Handle type="target" position={Position.Left} />
    </div>
  );
}
