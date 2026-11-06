import { useEffect, useRef, useState, type CSSProperties, memo } from "react";
import { useAtomValue } from "jotai";
import { Search, Eraser, Lock, Eye, Folder, SquareTerminal, Crown, Activity, Link2, ShieldCheck, OctagonX } from "lucide-react";
import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";
import type { NodeIsolation, Session, TermTheme } from "@messai/contracts";
import { countRender } from "./perf.js";
import { WS_COLORS, WS_ICONS, WsIcon } from "./wsicons.js";
import { AgentIcon, agentKind } from "./agentIcons.js";
import type { Api, Stream } from "./api.js";
import { unreadAtom, attentionAtom, finishedAtom, summaryAtom } from "./atoms.js";
import { TerminalView, type TerminalViewHandle } from "./TerminalView.js";
import { EditableTitle } from "./EditableTitle.js";
import { Composer, type MentionTarget } from "./Composer.js";
import { ChatLayer } from "./ChatLayer.js";
import type { ChatMessage, Role, Skill, SessionProcs, ConnectedPeer, CrossNodeCandidate } from "@messai/contracts";
import type { NodeBand } from "./bands.js";

export type NodeExtras = { onLink: () => void; linkCount: number; onChat: () => void; onRaise: () => void };
export type ComposerExtras = { composerOpen: boolean; onComposerClose: () => void; onFocus: () => void; workspaceId: string; targets: MentionTarget[]; chatOpen: boolean; onChatClose: () => void; role?: Role; roles: Role[]; onSetRole: (roleId: string | null) => void; onManageRoles: () => void; skills?: Skill[]; skillIds?: string[]; onSetSkills?: (ids: string[]) => void; onManageSkills?: () => void; bands?: NodeBand[]; onOpenBands?: () => void; maestro?: boolean; onMaestro?: (on: boolean) => void; onStopRecruits?: () => void; isolation?: NodeIsolation; isoAvailable?: boolean; onIsolation?: (iso: NodeIsolation | null) => void; memLimitMb?: number; onMemLimit?: (mb: number) => void; onFocusNode?: (wsId: string, nodeId: string) => void; onCrossConnect?: (target: { targetNodeId?: string; targetRef?: string }) => Promise<void> | void; onCrossDisconnect?: (connectionId: string) => Promise<void> | void };
export type Appearance = { icon?: string | null; color?: string | null; termTheme?: TermTheme | null };
export type TerminalData = { title: string; sessionId: string; api: Api; stream: Stream; onDelete: () => void; onRename: (t: string) => void; onResume: () => void; editSignal?: number; icon?: string; color?: string; termTheme?: string; onAppearance: (p: Appearance) => void } & NodeExtras & ComposerExtras;
const THEMES: { id: TermTheme; label: string }[] = [{ id: "system", label: "Sistema" }, { id: "dark", label: "Escuro" }, { id: "light", label: "Claro" }, { id: "custom", label: "Custom" }];

function TerminalNodeImpl({ id, data, selected }: NodeProps & { data: TerminalData }) {
  countRender(id);
  const viewRef = useRef<TerminalViewHandle>(null);
  const [session, setSession] = useState<Session | null>(null);
  const { sessionId, stream, api } = data;
  const unread = useAtomValue(unreadAtom(id)); // só este nó re-renderiza quando a sua contagem muda
  const attention = useAtomValue(attentionAtom(id));
  const finishedAt = useAtomValue(finishedAtom(id)); // #65: agente concluiu um turno e espera você
  const summary = useAtomValue(summaryAtom(id)); // #66: resumo do turno pelo modelo local (quando houver)
  const [appear, setAppear] = useState(false);
  // #80 monitor de processos e métrica de memória ao vivo
  const [procsOpen, setProcsOpen] = useState(false);
  const [procs, setProcs] = useState<SessionProcs | null>(null);
  const loadProcs = () => api.sessionProcs(sessionId).then(setProcs).catch(() => {});
  useEffect(() => {
    if (session?.state !== "running") { setProcs(null); return; }
    void loadProcs();
    const iv = setInterval(() => void loadProcs(), procsOpen ? 1200 : 3000);
    return () => clearInterval(iv);
  }, [session?.state, sessionId, procsOpen, data.memLimitMb]); // eslint-disable-line react-hooks/exhaustive-deps
  // #82 conexões entre andares e entre espaços
  const [crossOpen, setCrossOpen] = useState(false);
  const [crossPeers, setCrossPeers] = useState<ConnectedPeer[]>([]);
  const [candidates, setCandidates] = useState<CrossNodeCandidate[]>([]);
  const [crossRefInput, setCrossRefInput] = useState("");
  const loadCross = () => {
    void api.connectedPeers(id).then((list) => setCrossPeers(list.filter((p) => p.crossWorkspace))).catch(() => {});
    if (crossOpen) void api.crossCandidates(id).then(setCandidates).catch(() => {});
  };
  useEffect(() => { loadCross(); }, [id, data.linkCount, crossOpen]); // eslint-disable-line react-hooks/exhaustive-deps

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
    <div className={`node terminal ${selected ? "sel" : ""} ${attention ? "att" : ""} ${data.bands?.length ? "inband" : ""}`} style={data.bands?.length ? ({ "--band-color": data.bands[0]!.color } as CSSProperties) : undefined}>
      <NodeResizer minWidth={240} minHeight={160} isVisible={selected} />
      <Composer open={data.composerOpen} nodeId={id} workspaceId={data.workspaceId} sessionId={sessionId} title={data.title} targets={data.targets} api={api} stream={stream} onClose={data.onComposerClose} {...(data.chatOpen ? { chatThread: thread } : {})} />
      <div className={`bar nodrag-off ${data.color ? "tinted" : ""}`} style={data.color ? ({ "--node-color": data.color } as CSSProperties) : undefined}>
        <button className="node-ic nodrag" title="Aparência (ícone, cor, tema)" data-testid="node-appearance" onClick={(e) => { e.stopPropagation(); setAppear((v) => !v); }}>
          {data.icon ? <WsIcon icon={data.icon} color={data.color || "currentColor"} size={15} /> : agentKind(data.title) !== "shell" ? <AgentIcon id={agentKind(data.title)} size={15} /> : <SquareTerminal size={15} />}
        </button>
        {appear && (
          <div className="menu appearance-menu nodrag" data-testid="appearance-menu" onMouseLeave={() => setAppear(false)}>
            <div className="icon-grid">
              <button type="button" className={`ig ${!data.icon ? "on" : ""}`} title="automático" onClick={() => data.onAppearance({ icon: null })}><SquareTerminal size={16} /></button>
              {Object.entries(WS_ICONS).map(([k, I]) => <button key={k} type="button" className={`ig ${data.icon === k ? "on" : ""}`} title={k} onClick={() => data.onAppearance({ icon: k })}><I size={16} /></button>)}
            </div>
            <div className="color-row">
              <button type="button" className={`sw ${!data.color ? "on" : ""}`} style={{ background: "var(--bar)" }} title="sem cor" onClick={() => data.onAppearance({ color: null })} />
              {WS_COLORS.map((c) => <button key={c} type="button" className={`sw ${data.color === c ? "on" : ""}`} style={{ background: c }} title={c} onClick={() => data.onAppearance({ color: c })} />)}
            </div>
            <div className="seg" data-testid="node-theme">{THEMES.map((t) => <button key={t.id} type="button" className={(data.termTheme ?? "system") === t.id ? "on" : ""} onClick={() => data.onAppearance({ termTheme: t.id === "system" ? null : t.id })}>{t.label}</button>)}</div>
          </div>
        )}
        {attention && <span className="dot" title={finishedAt ? `concluiu e espera você (${new Date(finishedAt).toLocaleTimeString()})${summary ? `\n${summary.summary}\nPróximo passo: ${summary.nextStep}` : ""} — Ctrl+Shift+A` : "precisa de atenção (Ctrl+Shift+A)"} />}
        <EditableTitle value={data.title} onSave={data.onRename} editSignal={data.editSignal ?? 0} />
        <span className={`role-pill nodrag ${data.role ? "" : "none"}`} title={data.role ? `Papel: ${data.role.name}\n${data.role.instructions.slice(0, 200)}` : "Sem papel (clique para atribuir)"} data-testid="role-pill" onClick={(e) => { e.stopPropagation(); setRoleMenu((v) => !v); }}>
          {data.role ? <><span className="role-badge">{data.role.badge || data.role.name.slice(0, 2).toUpperCase()}</span>{data.role.name}</> : "papel"}{data.skillIds?.length ? <span className="sk-count" title={`${data.skillIds.length} habilidade(s) anexada(s)`}>+{data.skillIds.length}</span> : null}
        </span>
        {roleMenu && (
          <div className="menu role-menu nodrag" onMouseLeave={() => setRoleMenu(false)}>
            <div className={`mi ${!data.role ? "on" : ""}`} onClick={() => { setRoleMenu(false); data.onSetRole(null); }}>Sem papel</div>
            {data.roles.map((r) => <div key={r.roleId} className={`mi ${data.role?.roleId === r.roleId ? "on" : ""}`} onClick={() => { setRoleMenu(false); data.onSetRole(r.roleId); }}><span className="role-badge">{r.badge}</span>{r.name}</div>)}
            <hr /><div className="mi" onClick={() => { setRoleMenu(false); data.onManageRoles(); }}>Gerenciar…</div>
            <hr /><div className="mi mut sk-head">Habilidades {data.skillIds?.length ? `(${data.skillIds.length})` : ""}</div>
            {(data.skills ?? []).map((k) => { const on = (data.skillIds ?? []).includes(k.skillId); return <div key={k.skillId} className={`mi ${on ? "on" : ""}`} title={k.description || k.instructions.slice(0, 120)} data-testid={`skill-toggle-${k.skillId}`} onClick={() => data.onSetSkills?.(on ? (data.skillIds ?? []).filter((x) => x !== k.skillId) : [...(data.skillIds ?? []), k.skillId])}><input type="checkbox" readOnly checked={on} tabIndex={-1} /> {k.name}</div>; })}
            {(data.skills ?? []).length === 0 && <div className="mi mut">nenhuma habilidade criada</div>}
            <div className="mi" onClick={() => { setRoleMenu(false); data.onManageSkills?.(); }}>Gerenciar habilidades…</div>
          </div>
        )}
        {data.isolation && <span className="iso-pill nodrag" data-testid="iso-pill" title={`Modo isolado (sandbox): ${data.isolation.network === "none" ? "sem rede" : "com a rede do host"}, ambiente limpo, só a pasta do espaço gravável`}><ShieldCheck size={11} /></span>}
        {data.maestro && <span className="maestro-pill nodrag" title="Modo Maestro: este terminal recruta, dispensa e reatribui agentes (mess maestro …)" data-testid="maestro-pill"><Crown size={11} /></span>}
        {data.bands?.map((b) => <span key={b.id} className={`band-pill nodrag ${b.asking ? "asking" : ""}`} style={{ "--band-color": b.color } as CSSProperties} title={b.asking ? `Banda ${b.name}: pergunta em andamento neste terminal` : `Banda ${b.name} (clique para gerenciar)`} data-testid="band-pill" onClick={(e) => { e.stopPropagation(); data.onOpenBands?.(); }}>{b.name}{b.asking ? " …" : ""}</span>)}
        {crossPeers.map((p) => (
          <span key={p.connectionId} className="band-pill nodrag" data-testid="cross-peer-pill" title={`Conectado a ${p.node.title} @ ${p.workspaceName} — clique para abrir conexões entre andares/espaços`} onClick={(e) => { e.stopPropagation(); setCrossOpen((v) => !v); }}>
            ⇄ {p.node.title} @ {p.workspaceName}
          </span>
        ))}
        {procs && state === "running" && (
          <span className={`mem-pill nodrag ${procs.overLimit ? "over" : ""}`} data-testid="term-mem-pill" title={`Memória da árvore do terminal: ${(procs.totalRssKb / 1024).toFixed(1)} MB${procs.limitMb ? ` / limite ${procs.limitMb} MB` : ""} (${procs.processes.length} processo(s)) — clique para monitorar`} onClick={(e) => { e.stopPropagation(); setProcsOpen((v) => !v); }}>
            <Activity size={10} /> {(procs.totalRssKb / 1024).toFixed(1)} MB{procs.limitMb ? `/${procs.limitMb}` : ""}{procs.overLimit ? " ⚠" : ""}
          </span>
        )}
        <span className={`st ${state}`} title={`${state}${session?.pid ? ` · pid ${session.pid}` : ""}${session?.lease ? (mine ? " · você controla" : " · observando") : ""}`}>
          {state}
          {session?.persistent && <span className="tag">tmux</span>}
          {session?.lease && (mine ? <Lock size={10} /> : <Eye size={10} />)}
        </span>
        {unread > 0 && <span className="badge" title="mensagens não lidas de outros agentes (mess inbox)">✉ {unread}</span>}
        {chatUnread > 0 && <span className="badge chatb" title="respostas no chat (Ctrl+J)">💬 {chatUnread}</span>}
        <span className="sp" />
        {data.onIsolation && <button title={data.isolation ? "Modo isolado ligado (clique para desligar — reinicia o terminal)" : data.isoAvailable === false ? "Modo isolado indisponível: instale o bubblewrap" : "Ligar o modo isolado (reinicia o terminal dentro do sandbox, sem rede)"} className={`nodrag iso-toggle ${data.isolation ? "on" : ""}`} data-testid="iso-toggle" disabled={!data.isolation && data.isoAvailable === false} onClick={() => data.onIsolation?.(data.isolation ? null : { network: "none" })}><ShieldCheck size={12} /></button>}
        {data.maestro && data.onStopRecruits && <button title="PARADA DE EMERGÊNCIA: interrompe todos os recrutados (sem matar) e avisa o Maestro para realinhar" className="nodrag maestro-stop danger" data-testid="maestro-stop" onClick={data.onStopRecruits}><OctagonX size={12} /></button>}
        {data.onMaestro && <button title={data.maestro ? "Modo Maestro ligado (clique para desligar)" : "Ligar o Modo Maestro (recrutar/dispensar/reatribuir agentes)"} className={`nodrag maestro-toggle ${data.maestro ? "on" : ""}`} data-testid="maestro-toggle" onClick={() => data.onMaestro?.(!data.maestro)}><Crown size={12} /></button>}
        <button title="Conexões entre andares e espaços (Nome @ Espaço)" className={`nodrag ${crossOpen || crossPeers.length > 0 ? "on" : ""}`} data-testid="node-cross-link-btn" onClick={() => setCrossOpen((v) => !v)}><Link2 size={12} /></button>
        <button title="Monitor de processos e limite de memória" className={`nodrag ${procsOpen ? "on" : ""}`} data-testid="term-procs-btn" onClick={() => { setProcsOpen((v) => !v); void loadProcs(); }}><Activity size={12} /></button>
        <button title="Buscar no terminal (Ctrl+F)" className="nodrag" onClick={() => viewRef.current?.openFind()}><Search size={12} /></button>
        <button title="Limpar a tela" className="nodrag" onClick={() => viewRef.current?.clear()}><Eraser size={12} /></button>
        {state === "running" && <button title="Descarregar terminal (poupar RAM preservando scrollback)" className="nodrag" data-testid="term-unload-btn" onClick={() => void api.unloadNode(id)}>💤</button>}
        {state === "unloaded" && <button title="Recarregar terminal" className="nodrag" data-testid="term-reload-btn" onClick={() => void api.reloadNode(id)}>▶</button>}
        {state === "running" && <button title="Parar processo" onClick={() => void api.stop(sessionId)}>■</button>}
        {(state === "exited" || state === "lost") && <button title="Reiniciar" onClick={() => void api.restart(id)}>↻</button>}
        <button title="Remover nó" onClick={data.onDelete}>✕</button>
      </div>
      <div className="term-wrap">
        {crossOpen && (
          <div className="term-procs nodrag nowheel" data-testid="cross-link-panel" onMouseDown={(e) => e.stopPropagation()}>
            <div className="row">
              <b>Conexões entre andares/espaços ({crossPeers.length})</b>
              <span className="sp" />
              <button onClick={() => setCrossOpen(false)}>✕</button>
            </div>
            <div className="row" style={{ gap: 6, marginTop: 4 }}>
              <input
                value={crossRefInput}
                onChange={(e) => setCrossRefInput(e.target.value)}
                placeholder="Nome @ Espaço (ex.: Worker @ Backend)"
                data-testid="cross-link-input"
                style={{ flex: 1 }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && crossRefInput.trim()) {
                    const ref = crossRefInput.trim();
                    setCrossRefInput("");
                    void Promise.resolve(data.onCrossConnect?.({ targetRef: ref })).then(() => setTimeout(loadCross, 150));
                  }
                }}
              />
              <button
                className="tb"
                data-testid="cross-link-submit"
                disabled={!crossRefInput.trim()}
                onClick={() => {
                  const ref = crossRefInput.trim();
                  if (!ref) return;
                  setCrossRefInput("");
                  void Promise.resolve(data.onCrossConnect?.({ targetRef: ref })).then(() => setTimeout(loadCross, 150));
                }}
              >
                Conectar
              </button>
            </div>
            {crossPeers.length > 0 && (
              <div className="proc-list" data-testid="cross-peer-list" style={{ marginTop: 6 }}>
                {crossPeers.map((p) => (
                  <div key={p.connectionId} className="proc-row" data-testid="cross-peer-row">
                    <b className="proc-name">{p.node.title} @ {p.workspaceName}</b>
                    <span className="mut mono">{p.node.kind}</span>
                    <span className="sp" />
                    {data.onFocusNode && <button className="tb" data-testid={`cross-go-${p.node.nodeId}`} onClick={() => data.onFocusNode?.(p.workspaceId, p.node.nodeId)}>Ir</button>}
                    <button className="tb danger" data-testid={`cross-unlink-${p.node.nodeId}`} onClick={() => void Promise.resolve(data.onCrossDisconnect?.(p.connectionId)).then(() => setTimeout(loadCross, 150))}>Desconectar</button>
                  </div>
                ))}
              </div>
            )}
            <div className="mut" style={{ fontSize: 11, marginTop: 6 }}>Outros andares e espaços</div>
            <div className="proc-list" data-testid="cross-candidate-list">
              {candidates.filter((c) => !crossPeers.some((p) => p.node.nodeId === c.nodeId)).map((c) => (
                <div key={c.nodeId} className="proc-row" data-testid="cross-candidate-row">
                  <b className="proc-name">{c.refLabel}</b>
                  <span className="mut mono">{c.kind}{c.branch ? ` · ${c.branch}` : ""}</span>
                  <span className="sp" />
                  <button className="tb" data-testid={`cross-connect-${c.nodeId}`} onClick={() => void Promise.resolve(data.onCrossConnect?.({ targetNodeId: c.nodeId })).then(() => setTimeout(loadCross, 150))}>Conectar</button>
                </div>
              ))}
              {candidates.filter((c) => !crossPeers.some((p) => p.node.nodeId === c.nodeId)).length === 0 && <div className="mut">Nenhum outro nó disponível fora deste espaço.</div>}
            </div>
          </div>
        )}
        {procsOpen && (
          <div className="term-procs nodrag nowheel" data-testid="term-procs-panel" onMouseDown={(e) => e.stopPropagation()}>
            <div className="row">
              <b>Processos ({procs?.processes.length ?? 0})</b>
              <span className="mut">{procs ? `${(procs.totalRssKb / 1024).toFixed(1)} MB RSS total` : "…"}</span>
              <span className="sp" />
              <label className="row" style={{ fontSize: 11 }}>
                Limite (MB):
                <input type="number" min={0} max={65536} step={32} style={{ width: 68 }} value={data.memLimitMb ?? 0} onChange={(e) => data.onMemLimit?.(Math.max(0, Number(e.target.value) || 0))} data-testid="node-mem-limit" />
              </label>
              <button onClick={() => setProcsOpen(false)}>✕</button>
            </div>
            {procs?.overLimit && <div className="err" data-testid="term-mem-warn">⚠ Memória acima do limite ({(procs.totalRssKb / 1024).toFixed(1)} MB &gt; {procs.limitMb} MB)</div>}
            <div className="proc-list" data-testid="proc-list">
              {(procs?.processes ?? []).map((p) => (
                <div key={p.pid} className="proc-row" data-testid="proc-row" style={{ paddingLeft: 4 + p.depth * 12 }}>
                  <span className="mono mut">{p.pid}</span>
                  <b className="proc-name" title={p.cmd}>{p.name}</b>
                  <span className="proc-cmd mut mono" title={p.cmd}>{p.cmd}</span>
                  <span className="mono">{(p.rssKb / 1024).toFixed(1)} MB</span>
                  <button className="tb danger" title={p.pid === procs?.rootPid ? "Parar processo raiz" : "Parar processo (SIGTERM)"} data-testid={`proc-kill-${p.pid}`} onClick={() => void api.killSessionProc(sessionId, { pid: p.pid, signal: "SIGTERM" }).then(() => setTimeout(loadProcs, 200))}>■</button>
                </div>
              ))}
              {(!procs || procs.processes.length === 0) && <div className="mut">Nenhum processo em execução.</div>}
            </div>
          </div>
        )}
        <TerminalView ref={viewRef} sessionId={sessionId} nodeId={id} api={api} stream={stream} termTheme={data.termTheme ?? null}
          onSession={setSession} onResume={data.onResume} onFocus={data.onFocus} />
        {data.chatOpen && <ChatLayer nodeId={id} title={data.title} api={api} thread={thread} setThread={setThread} messages={chat} onClose={data.onChatClose} />}
      </div>
      {session?.cwd && <div className="footbar nodrag" title={session.cwd}><Folder size={11} /><span className="cwd">{session.cwd.replace(/^\/home\/[^/]+/, "~")}</span></div>}
      <Handle type="source" position={Position.Right} /><Handle type="target" position={Position.Left} />
    </div>
  );
}

/** #42: memo — o wrapper do React Flow re-renderiza o nó em eventos que não mexem nas props dele (viewport, nós vizinhos). */
export const TerminalNode = memo(TerminalNodeImpl);
