import { memo, useCallback, useEffect, useRef, useState, type KeyboardEvent as RKeyboardEvent, type MouseEvent as RMouseEvent } from "react";
import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";
import { ArrowLeft, ArrowRight, Crosshair, ExternalLink, Globe, Play, RotateCw, Square } from "lucide-react";
import type { PortalAct, PortalInspect, PortalState } from "@messai/contracts";
import type { Api, Stream } from "./api.js";
import { EditableTitle } from "./EditableTitle.js";
import type { NodeExtras } from "./TerminalNode.js";

export type PortalData = {
  title: string; content: string; workspaceId: string; api: Api; stream: Stream; peers: { id: string; title: string }[];
  onDelete: () => void; onRename: (t: string) => void; editSignal?: number; toast: (m: string, k?: "info" | "err" | "ok") => void;
} & NodeExtras;

const SPECIAL = new Set(["Enter", "Backspace", "Tab", "Escape", "Delete", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"]);
const savedUrl = (content: string): string => { try { const j = JSON.parse(content) as { url?: unknown }; return typeof j.url === "string" ? j.url : ""; } catch { return ""; } };

/**
 * #26 — Portal: navegador embutido. O Chromium roda NO RUNTIME (dirigível por agentes via `mess portal`); aqui chegam os quadros (screencast)
 * e saem mouse/teclado/rolagem/navegação. Só abre o navegador quando você pede (ou quando um agente já o abriu): um espaço com portais
 * não sobe vários Chromium sozinho. Modo design: clique num elemento para inspecioná-lo e mandar o seletor/HTML a um agente conectado.
 */
function PortalNodeImpl({ id, data, selected }: NodeProps & { data: PortalData }) {
  const { api, stream } = data;
  const [st, setSt] = useState<PortalState | null>(null);
  const [url, setUrl] = useState(savedUrl(data.content)); const urlFocus = useRef(false);
  const [err, setErr] = useState<string | null>(null);
  const [design, setDesign] = useState(false); const [picked, setPicked] = useState<PortalInspect | null>(null);
  const img = useRef<HTMLImageElement>(null); const view = useRef<HTMLDivElement>(null);
  const stRef = useRef<PortalState | null>(null); stRef.current = st;
  const active = st?.status === "running" || st?.status === "starting"; // deriva do estado real do runtime
  const activeRef = useRef(false); activeRef.current = active;
  const queue = useRef<Promise<unknown>>(Promise.resolve()); const lastMove = useRef(0);

  // com o stream ativo o estado vem SÓ pelo WS: a resposta HTTP pode chegar depois de um estado mais novo e regredi-lo
  const act = useCallback((a: PortalAct) => {
    queue.current = queue.current.then(() => api.portalAct(id, a).then((r) => { if (!activeRef.current) setSt(r.state); setErr(null); return r; })).catch((e) => { setErr(e instanceof Error ? e.message : String(e)); return null; });
    return queue.current as Promise<{ value?: unknown; state: PortalState } | null>;
  }, [api, id]);

  // estado inicial sem abrir o navegador; se já estiver rodando (agente), assiste direto
  useEffect(() => { let alive = true; void api.portalState(id).then((s) => { if (alive) setSt(s); }).catch(() => {}); return () => { alive = false; }; }, [api, id]);
  // assiste SEMPRE (portalWatch não lança o navegador; só recebe quadros/estado se já estiver rodando) — pega o portal aberto por um agente
  useEffect(() => {
    const watch = () => stream.send({ type: "portalWatch", nodeId: id });
    watch();
    const off = stream.on((m) => {
      if (m.type === "hello") watch(); // reconectou: volta a assistir
      else if (m.type === "portalFrame" && m.nodeId === id) { if (img.current) img.current.src = `data:image/jpeg;base64,${m.data}`; }
      else if (m.type === "portalState" && m.state.nodeId === id) { setSt(m.state); if (!urlFocus.current) setUrl(m.state.url === "about:blank" ? "" : m.state.url); }
      else if (m.type === "error" && !("sessionId" in m && m.sessionId)) setErr(m.error.message);
    });
    return () => { off(); stream.send({ type: "portalUnwatch", nodeId: id }); };
  }, [stream, id]);
  // viewport = tamanho do nó (1:1 com o que se vê), com debounce
  useEffect(() => {
    const el = view.current; if (!el) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver(() => { clearTimeout(t); t = setTimeout(() => { if (!activeRef.current) return; const w = Math.round(el.clientWidth), h = Math.round(el.clientHeight); const s = stRef.current; if (w >= 200 && h >= 150 && s && (s.width !== w || s.height !== h)) void act({ action: "viewport", width: w, height: h }); }, 300); });
    ro.observe(el); return () => { clearTimeout(t); ro.disconnect(); };
  }, [act]);

  const start = (target?: string) => { const u = (target ?? url).trim(); if (u) void act({ action: "navigate", url: u }); else void api.portalAct(id, { action: "eval", expression: "1" }).then((r) => setSt(r.state)).catch((e) => setErr(String(e instanceof Error ? e.message : e))); };
  const go = () => { if (!url.trim()) return; if (!active) start(url); else void act({ action: "navigate", url: url.trim() }); };
  const stop = () => { setPicked(null); void api.portalAct(id, { action: "close" }).then((r) => setSt(r.state)).catch(() => {}); if (img.current) img.current.removeAttribute("src"); };

  const pos = (e: RMouseEvent | { clientX: number; clientY: number }) => {
    const r = img.current?.getBoundingClientRect(); const s = stRef.current; if (!r || !s || !r.width) return null;
    return { x: Math.max(0, (e.clientX - r.left) * (s.width / r.width)), y: Math.max(0, (e.clientY - r.top) * (s.height / r.height)) };
  };
  const onDown = (e: RMouseEvent) => {
    view.current?.focus(); const p = pos(e); if (!p) return;
    if (design && e.button === 0) { void act({ action: "inspect", x: p.x, y: p.y }).then((r) => setPicked((r?.value as PortalInspect | null) ?? null)); return; }
    void act({ action: "mouse", type: "down", x: p.x, y: p.y, button: e.button === 2 ? "right" : "left", clickCount: Math.min(3, Math.max(1, e.detail)) });
  };
  const onUp = (e: RMouseEvent) => { if (design) return; const p = pos(e); if (p) void act({ action: "mouse", type: "up", x: p.x, y: p.y, button: e.button === 2 ? "right" : "left", clickCount: Math.min(3, Math.max(1, e.detail)) }); };
  const onMove = (e: RMouseEvent) => { if (design) return; const now = Date.now(); if (now - lastMove.current < 70) return; lastMove.current = now; const p = pos(e); if (p) void api.portalAct(id, { action: "mouse", type: "move", x: p.x, y: p.y }).catch(() => {}); };
  const onWheel = (e: React.WheelEvent) => { const p = pos(e); void act({ action: "scroll", dy: e.deltaY, dx: e.deltaX, ...(p ? { x: p.x, y: p.y } : {}) }); };
  const onKey = (e: RKeyboardEvent) => {
    if (design || (e.target as HTMLElement).tagName === "INPUT") return;
    if (e.ctrlKey || e.metaKey || e.altKey) return; // atalhos do app/SO continuam do app
    if (SPECIAL.has(e.key)) { e.preventDefault(); e.stopPropagation(); void act({ action: "key", key: e.key }); }
    else if (e.key.length === 1) { e.preventDefault(); e.stopPropagation(); void act({ action: "type", text: e.key }); }
  };
  const onPaste = (e: React.ClipboardEvent) => { const t = e.clipboardData.getData("text/plain"); if (t) { e.preventDefault(); void act({ action: "type", text: t.slice(0, 20000) }); } };

  const copy = (text: string) => { void navigator.clipboard?.writeText(text).then(() => data.toast("Copiado", "ok")).catch(() => data.toast("Não foi possível copiar", "err")); };
  const sendPicked = async (peerId: string) => {
    if (!picked) return;
    const text = `Elemento selecionado no portal "${data.title}" (${st?.url ?? ""}):\nseletor: ${picked.selector}\ntag: <${picked.tag}>\ntexto: ${picked.text}\nHTML: ${picked.html}`;
    try { await api.say(peerId, { text }); data.toast("Enviado ao agente", "ok"); } catch (e) { data.toast(e instanceof Error ? e.message : String(e), "err"); }
  };
  const status = st?.status ?? "stopped";
  return (
    <div className={`node portal ${selected ? "sel" : ""}`} data-testid="portal-node">
      <NodeResizer minWidth={320} minHeight={240} isVisible={selected} />
      <div className="bar">
        <Globe size={13} className="mut" />
        <EditableTitle value={data.title} onSave={data.onRename} editSignal={data.editSignal ?? 0} />
        <span className="sp" />
        {st?.watchers ? <span className="mut" title="observadores" style={{ fontSize: 10 }}>{st.watchers}👁</span> : null}
        <button className={`ib nodrag ${design ? "on" : ""}`} title="Modo design: clique num elemento para inspecioná-lo" data-testid="portal-design" disabled={!active} onClick={() => { setDesign((v) => !v); setPicked(null); }}><Crosshair size={13} /></button>
        <button className="ib nodrag" title="Abrir no navegador do sistema" disabled={!st?.url || st.url === "about:blank"} onClick={() => st?.url && void window.messai.openExternal?.(st.url)}><ExternalLink size={13} /></button>
        {active ? <button className="ib nodrag" title="Fechar o navegador deste portal (libera memória; a URL fica salva)" data-testid="portal-stop" onClick={stop}><Square size={12} /></button> : null}
        <button className="ib nodrag" title="Remover" onClick={data.onDelete}>✕</button>
      </div>
      <div className="portal-nav nodrag">
        <button className="ib" title="Voltar" data-testid="portal-back" disabled={!st?.canGoBack || !active} onClick={() => void act({ action: "back" })}><ArrowLeft size={13} /></button>
        <button className="ib" title="Avançar" data-testid="portal-forward" disabled={!st?.canGoForward || !active} onClick={() => void act({ action: "forward" })}><ArrowRight size={13} /></button>
        <button className="ib" title="Recarregar" data-testid="portal-reload" disabled={!active} onClick={() => void act({ action: "reload" })}><RotateCw size={13} className={st?.loading ? "spin" : ""} /></button>
        <input data-testid="portal-url" className="portal-url" placeholder="Digite um endereço (https://…) e Enter" value={url} spellCheck={false}
          onFocus={(e) => { urlFocus.current = true; e.currentTarget.select(); }} onBlur={() => { urlFocus.current = false; }} onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") { go(); e.currentTarget.blur(); } }} />
        <span className={`portal-dot ${status}`} title={st?.error ?? status} data-testid="portal-status" data-status={status} />
      </div>
      {err && <div className="portal-err nodrag" data-testid="portal-error" onClick={() => setErr(null)}>{err}</div>}
      <div ref={view} className={`portal-view nodrag nowheel ${design ? "design" : ""}`} data-testid="portal-view" tabIndex={0}
        onMouseDown={onDown} onMouseUp={onUp} onMouseMove={onMove} onWheel={onWheel} onKeyDown={onKey} onPaste={onPaste} onContextMenu={(e) => e.preventDefault()}>
        {active ? <img ref={img} alt="" draggable={false} data-testid="portal-img" /> : (
          <div className="portal-idle" data-testid="portal-idle">
            <Globe size={28} />
            <div>{st?.error ? `Erro: ${st.error}` : "Portal parado"}</div>
            <div className="mut">{url ? url : "Digite um endereço acima"}</div>
            <button className="pri" data-testid="portal-start" onClick={() => start()}><Play size={12} /> {url ? "Abrir" : "Abrir em branco"}</button>
          </div>
        )}
        {active && status === "starting" && <div className="portal-loading">Abrindo o navegador…</div>}
      </div>
      {picked && (
        <div className="portal-pick nodrag nowheel" data-testid="portal-pick">
          <div><b>&lt;{picked.tag}&gt;</b> <code data-testid="portal-pick-selector">{picked.selector}</code></div>
          {picked.text && <div className="mut">“{picked.text.slice(0, 120)}”</div>}
          <div className="row">
            <button onClick={() => copy(picked.selector)}>Copiar seletor</button><button onClick={() => copy(picked.html)}>Copiar HTML</button>
            {data.peers.map((p) => <button key={p.id} className="pri" data-testid="portal-send" onClick={() => void sendPicked(p.id)}>Enviar a {p.title}</button>)}
            {data.peers.length === 0 && <span className="mut">Ligue este portal a um terminal para enviar o elemento ao agente.</span>}
            <button onClick={() => setPicked(null)}>Fechar</button>
          </div>
        </div>
      )}
      <Handle type="source" position={Position.Right} /><Handle type="target" position={Position.Left} />
    </div>
  );
}
export const PortalNode = memo(PortalNodeImpl);
