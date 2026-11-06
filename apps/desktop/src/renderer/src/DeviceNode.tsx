import { memo, useCallback, useEffect, useRef, useState, type KeyboardEvent as RKeyboardEvent, type MouseEvent as RMouseEvent } from "react";
import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";
import { AppWindow, ArrowLeft, Cast, Circle, Crosshair, Loader, Power, RefreshCw, Smartphone, Square, Unplug } from "lucide-react";
import { uiNodeAt } from "@messai/domain";
import type { DeviceAct, DeviceList, DeviceState, DeviceUiNode } from "@messai/contracts";
import type { Api, Stream } from "./api.js";
import { EditableTitle } from "./EditableTitle.js";
import type { NodeExtras } from "./TerminalNode.js";

export type DeviceData = {
  title: string; content: string; workspaceId: string; api: Api; stream: Stream; peers: { id: string; title: string }[];
  onDelete: () => void; onRename: (t: string) => void; editSignal?: number; toast: (m: string, k?: "info" | "err" | "ok") => void;
} & NodeExtras;

const SPECIAL: Record<string, string> = { Enter: "enter", Backspace: "delete", Delete: "forward_delete", Tab: "tab", Escape: "back", ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
const isAscii = (s: string) => /^[\x20-\x7e]+$/.test(s);

/**
 * #73 — Dispositivo Android/emulador no canvas. O runtime fala com o aparelho por adb (dirigível por agentes via `mess device`); aqui chegam
 * os quadros (screencap) e saem toque/swipe/teclas/texto. Inspecionar: clique num elemento para ver o que o Android enxerga (acessibilidade)
 * e mandar ao agente conectado. Iniciar emulador leva 1–2 min: o progresso aparece no nó.
 */
function DeviceNodeImpl({ id, data, selected }: NodeProps & { data: DeviceData }) {
  const { api, stream } = data;
  const [st, setSt] = useState<DeviceState | null>(null);
  const [list, setList] = useState<DeviceList | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tree, setTree] = useState<DeviceUiNode[] | null>(null); const [inspect, setInspect] = useState(false); const [hover, setHover] = useState<DeviceUiNode | null>(null); const [picked, setPicked] = useState<DeviceUiNode | null>(null); const [loadingUi, setLoadingUi] = useState(false);
  const [apps, setApps] = useState<string[] | null>(null); const [textBox, setTextBox] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null); const view = useRef<HTMLDivElement>(null);
  const pendFrame = useRef<string | null>(null); const decoding = useRef(false);
  const [dims, setDims] = useState({ w: 0, h: 0 }); const dimsRef = useRef(dims); dimsRef.current = dims;
  const queue = useRef<Promise<unknown>>(Promise.resolve()); const down = useRef<{ x: number; y: number; t: number } | null>(null);
  const typed = useRef(""); const typeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined); const wheelBusy = useRef(false);
  const activeRef = useRef(false);
  const status = st?.status ?? "stopped"; activeRef.current = status === "connected";

  const act = useCallback((a: DeviceAct) => {
    queue.current = queue.current.then(() => api.deviceAct(id, a).then((r) => { if (!activeRef.current) setSt(r.state); setErr(null); return r; })).catch((e) => { setErr(e instanceof Error ? e.message : String(e)); return null; });
    return queue.current as Promise<{ state: DeviceState } | null>;
  }, [api, id]);
  const refreshList = useCallback(() => { void api.deviceList().then(setList).catch(() => {}); }, [api]);
  // Desenha o quadro num canvas (decode completo via createImageBitmap antes de pintar → troca atômica, SEM piscar como no <img>).
  // Mantém só o último quadro; se um decode está em andamento, o próximo substitui o pendente (drop de quadros atrasados).
  const drawFrame = useCallback((b64: string) => {
    pendFrame.current = b64;
    if (decoding.current) return;
    decoding.current = true;
    void (async () => {
      while (pendFrame.current) {
        const data = pendFrame.current; pendFrame.current = null;
        try {
          const bin = atob(data); const arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          const bmp = await createImageBitmap(new Blob([arr], { type: "image/png" }));
          const c = canvas.current;
          if (c) { if (c.width !== bmp.width || c.height !== bmp.height) { c.width = bmp.width; c.height = bmp.height; } c.getContext("2d")?.drawImage(bmp, 0, 0); }
          bmp.close?.();
        } catch { /* quadro ruim: ignora */ }
      }
      decoding.current = false;
    })();
  }, []);

  useEffect(() => { let alive = true; void api.deviceState(id).then((s) => { if (alive) setSt(s); }).catch(() => {}); refreshList(); return () => { alive = false; }; }, [api, id, refreshList]);
  // assiste sempre (barato: sem aparelho ligado não há captura); o servidor reconecta ao aparelho salvo
  useEffect(() => {
    const watch = () => stream.send({ type: "deviceWatch", nodeId: id });
    watch();
    const off = stream.on((m) => {
      if (m.type === "hello") watch();
      else if (m.type === "deviceFrame" && m.nodeId === id) { drawFrame(m.data); setDims((d) => (d.w === m.width && d.h === m.height ? d : { w: m.width, h: m.height })); }
      else if (m.type === "deviceState" && m.state.nodeId === id) setSt(m.state);
      else if (m.type === "error" && !("sessionId" in m && m.sessionId)) setErr(m.error.message);
    });
    return () => { off(); stream.send({ type: "deviceUnwatch", nodeId: id }); };
  }, [stream, id, drawFrame]);

  const pick = (value: string) => {
    if (!value) return; setErr(null);
    if (value.startsWith("serial:")) void act({ action: "select", serial: value.slice(7) });
    else if (value.startsWith("avd:")) void api.deviceAct(id, { action: "boot", avd: value.slice(4), wait: false }).then((r) => setSt(r.state)).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  };
  /** posição em coordenadas do APARELHO a partir do clique (considera o letterbox do object-fit: contain) */
  const pos = (e: { clientX: number; clientY: number }) => {
    const el = canvas.current; const d = dimsRef.current; if (!el || !d.w) return null;
    const r = el.getBoundingClientRect(); const sc = Math.min(r.width / d.w, r.height / d.h); if (!sc) return null;
    const x = (e.clientX - r.left - (r.width - d.w * sc) / 2) / sc; const y = (e.clientY - r.top - (r.height - d.h * sc) / 2) / sc;
    return x < 0 || y < 0 || x >= d.w || y >= d.h ? null : { x, y };
  };
  const loadTree = async () => { setLoadingUi(true); try { const t = await api.deviceUi(id); setTree(t.nodes); setPicked(null); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setLoadingUi(false); } };
  const toggleInspect = () => { const on = !inspect; setInspect(on); setPicked(null); setHover(null); if (on) void loadTree(); };

  const onDown = (e: RMouseEvent) => { view.current?.focus(); const p = pos(e); if (!p) return; if (inspect) return; down.current = { ...p, t: Date.now() }; };
  const onUp = (e: RMouseEvent) => {
    const p = pos(e); const d0 = down.current; down.current = null; if (!p) return;
    if (inspect) { if (tree) setPicked(uiNodeAt(tree as never, p.x, p.y) as DeviceUiNode | null); return; }
    if (!d0) return; const dist = Math.hypot(p.x - d0.x, p.y - d0.y); const dt = Date.now() - d0.t;
    if (dist < 14) void act(dt > 600 ? { action: "longpress", x: d0.x, y: d0.y, ms: Math.min(2000, dt) } : { action: "tap", x: d0.x, y: d0.y });
    else void act({ action: "swipe", x1: d0.x, y1: d0.y, x2: p.x, y2: p.y, ms: Math.max(80, Math.min(1500, dt)) });
  };
  const onMove = (e: RMouseEvent) => { if (!inspect || !tree) return; const p = pos(e); setHover(p ? (uiNodeAt(tree as never, p.x, p.y) as DeviceUiNode | null) : null); };
  const onWheel = (e: React.WheelEvent) => {
    if (inspect || wheelBusy.current) return; const p = pos(e); const d = dimsRef.current; if (!p || !d.h) return;
    const s = Math.max(100, Math.min(d.h * 0.3, Math.abs(e.deltaY) * 1.5)) * (e.deltaY > 0 ? 1 : -1); wheelBusy.current = true;
    void act({ action: "swipe", x1: p.x, y1: Math.min(d.h - 5, Math.max(5, p.y + s / 2)), x2: p.x, y2: Math.min(d.h - 5, Math.max(5, p.y - s / 2)), ms: 250 }).finally(() => { wheelBusy.current = false; });
  };
  const flushTyped = () => { const t = typed.current; typed.current = ""; if (t) void act({ action: "text", text: t }); };
  const onKey = (e: RKeyboardEvent) => {
    if (inspect || (e.target as HTMLElement).tagName === "INPUT" || e.ctrlKey || e.metaKey || e.altKey) return;
    const sp = SPECIAL[e.key];
    if (sp) { e.preventDefault(); e.stopPropagation(); flushTyped(); void act({ action: "key", key: sp }); }
    else if (e.key.length === 1) { e.preventDefault(); e.stopPropagation(); if (!isAscii(e.key)) { data.toast("O Android só aceita ASCII por adb (sem acentos/emoji)", "err"); return; } typed.current += e.key; clearTimeout(typeTimer.current); typeTimer.current = setTimeout(flushTyped, 180); }
  };
  const onPaste = (e: React.ClipboardEvent) => { const t = e.clipboardData.getData("text/plain").replace(/\r?\n/g, " "); if (!t) return; e.preventDefault(); if (!isAscii(t)) { data.toast("O Android só aceita ASCII por adb (sem acentos/emoji)", "err"); return; } void act({ action: "text", text: t.slice(0, 2000) }); };
  const sendBox = () => { const t = textBox; if (!t) return; if (!isAscii(t)) { data.toast("O Android só aceita ASCII por adb (sem acentos/emoji)", "err"); return; } setTextBox(""); void act({ action: "text", text: t }); };
  const openApps = () => { if (apps) { setApps(null); return; } void api.deviceApps(id).then(setApps).catch((e) => setErr(e instanceof Error ? e.message : String(e))); };
  const copy = (t: string) => { void navigator.clipboard?.writeText(t).then(() => data.toast("Copiado", "ok")).catch(() => data.toast("Não foi possível copiar", "err")); };
  const describe = (n: DeviceUiNode) => `Elemento do dispositivo "${data.title}"${st?.foreground ? ` (${st.foreground})` : ""}:\nclasse: ${n.cls}\ntexto: ${n.text}\ndescrição: ${n.desc}\nid: ${n.resourceId}\nbounds: [${n.bounds.x1},${n.bounds.y1}][${n.bounds.x2},${n.bounds.y2}]\nclicável: ${n.clickable}`;
  const sendPicked = async (peerId: string) => { if (!picked) return; try { await api.say(peerId, { text: describe(picked) }); data.toast("Enviado ao agente", "ok"); } catch (e) { data.toast(e instanceof Error ? e.message : String(e), "err"); } };

  // caixa de destaque (inspecionar) em % da imagem
  const box = (n: DeviceUiNode | null, cls: string) => (n && dims.w ? <div className={`dev-box ${cls}`} style={{ left: `${(n.bounds.x1 / dims.w) * 100}%`, top: `${(n.bounds.y1 / dims.h) * 100}%`, width: `${((n.bounds.x2 - n.bounds.x1) / dims.w) * 100}%`, height: `${((n.bounds.y2 - n.bounds.y1) / dims.h) * 100}%` }} /> : null);
  const sel = st?.serial ? `serial:${st.serial}` : "";
  return (
    <div className={`node device ${selected ? "sel" : ""}`} data-testid="device-node">
      <NodeResizer minWidth={240} minHeight={360} isVisible={selected} />
      <div className="bar">
        <Smartphone size={13} className="mut" />
        <EditableTitle value={data.title} onSave={data.onRename} editSignal={data.editSignal ?? 0} />
        <span className="sp" />
        {st?.watchers ? <span className="mut" style={{ fontSize: 10 }}>{st.watchers}👁</span> : null}
        <button className="ib nodrag" title="Abrir no scrcpy (controle manual numa janela nativa, na mesma sessão)" data-testid="device-scrcpy" disabled={status !== "connected"} onClick={() => void act({ action: "scrcpy" })}><Cast size={13} /></button>
        <button className={`ib nodrag ${inspect ? "on" : ""}`} title="Inspecionar elementos (árvore de acessibilidade)" data-testid="device-inspect" disabled={status !== "connected"} onClick={toggleInspect}><Crosshair size={13} /></button>
        <button className="ib nodrag" title="Desligar o nó do aparelho (não o desliga)" data-testid="device-disconnect" disabled={status !== "connected"} onClick={() => void act({ action: "disconnect" })}><Unplug size={13} /></button>
        <button className="ib nodrag" title="Encerrar o emulador (só os iniciados por este app)" data-testid="device-shutdown" disabled={status !== "connected"} onClick={() => void act({ action: "shutdown" })}><Power size={13} /></button>
        <button className="ib nodrag" title="Remover" onClick={data.onDelete}>✕</button>
      </div>
      <div className="dev-nav nodrag">
        <select data-testid="device-select" value={sel} onFocus={refreshList} onChange={(e) => pick(e.target.value)} title="Aparelhos conectados e emuladores (AVDs)">
          <option value="">{status === "connected" ? `${st?.model || st?.serial}` : "Escolher aparelho…"}</option>
          {(list?.devices ?? []).filter((d) => d.state === "device").map((d) => <option key={d.serial} value={`serial:${d.serial}`}>{d.kind === "emulator" ? "📱 " : "🔌 "}{d.serial}{d.model ? ` · ${d.model}` : ""}</option>)}
          {(list?.avds ?? []).length > 0 && <optgroup label="Iniciar emulador (efêmero)">{list!.avds.map((a) => <option key={a} value={`avd:${a}`}>▶ {a}</option>)}</optgroup>}
        </select>
        <button className="ib" title="Atualizar a lista" onClick={refreshList}><RefreshCw size={13} /></button>
        <span className={`portal-dot ${status === "connected" ? "running" : status}`} title={st?.error ?? st?.message ?? status} data-testid="device-status" data-status={status} />
      </div>
      {err && <div className="portal-err nodrag" data-testid="device-error" onClick={() => setErr(null)}>{err}</div>}
      <div ref={view} className={`device-view nodrag nowheel ${inspect ? "design" : ""}`} data-testid="device-view" tabIndex={0}
        onMouseDown={onDown} onMouseUp={onUp} onMouseMove={onMove} onMouseLeave={() => { setHover(null); down.current = null; }} onWheel={onWheel} onKeyDown={onKey} onPaste={onPaste} onContextMenu={(e) => e.preventDefault()}>
        {status === "connected" ? (
          <div className="dev-screen">
            <canvas ref={canvas} data-testid="device-img" />
            {inspect && dims.w > 0 && <div className="dev-overlay" style={{ aspectRatio: `${dims.w} / ${dims.h}` }}>{box(hover, "hover")}{box(picked, "pick")}</div>}
          </div>
        ) : (
          <div className="portal-idle" data-testid="device-idle">
            {status === "starting" ? <Loader size={28} className="spin" /> : <Smartphone size={28} />}
            <div data-testid="device-message">{status === "starting" ? (st?.message ?? "Conectando…") : st?.error ? `Erro: ${st.error}` : "Nenhum aparelho ligado"}</div>
            {!st?.error && status !== "starting" && <div className="mut">{list && !list.adb ? (list.adbError ?? "adb indisponível") : "Escolha um aparelho ou emulador acima."}</div>}
          </div>
        )}
        {loadingUi && <div className="portal-loading">Lendo a tela…</div>}
      </div>
      {picked && (
        <div className="portal-pick nodrag nowheel" data-testid="device-pick">
          <div><b>{picked.cls.split(".").pop()}</b> {picked.text && <span data-testid="device-pick-text">“{picked.text}”</span>} {picked.desc && <span className="mut">desc: {picked.desc}</span>}</div>
          {picked.resourceId && <code data-testid="device-pick-id">{picked.resourceId}</code>}
          <div className="mut">[{picked.bounds.x1},{picked.bounds.y1}][{picked.bounds.x2},{picked.bounds.y2}]{picked.clickable ? " · clicável" : ""}{picked.enabled ? "" : " · desabilitado"}</div>
          <div className="row">
            <button onClick={() => { const cx = (picked.bounds.x1 + picked.bounds.x2) / 2, cy = (picked.bounds.y1 + picked.bounds.y2) / 2; void act({ action: "tap", x: cx, y: cy }); }}>Tocar aqui</button>
            <button onClick={() => copy(picked.resourceId || picked.text || picked.desc)}>Copiar id/texto</button>
            {data.peers.map((p) => <button key={p.id} className="pri" data-testid="device-send" onClick={() => void sendPicked(p.id)}>Enviar a {p.title}</button>)}
            {data.peers.length === 0 && <span className="mut">Ligue este nó a um terminal para enviar o elemento ao agente.</span>}
            <button onClick={() => void loadTree()}>Atualizar árvore</button><button onClick={() => setPicked(null)}>Fechar</button>
          </div>
        </div>
      )}
      <div className="dev-keys nodrag">
        <button className="ib" title="Voltar" data-testid="device-back" disabled={status !== "connected"} onClick={() => void act({ action: "key", key: "back" })}><ArrowLeft size={14} /></button>
        <button className="ib" title="Início" data-testid="device-home" disabled={status !== "connected"} onClick={() => void act({ action: "key", key: "home" })}><Circle size={14} /></button>
        <button className="ib" title="Recentes" data-testid="device-recents" disabled={status !== "connected"} onClick={() => void act({ action: "key", key: "recents" })}><Square size={13} /></button>
        <input data-testid="device-text" placeholder="Digitar no aparelho (ASCII) + Enter" value={textBox} disabled={status !== "connected"} onChange={(e) => setTextBox(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") sendBox(); }} />
        <button className="ib" title="Abrir app instalado" data-testid="device-apps" disabled={status !== "connected"} onClick={openApps}><AppWindow size={14} /></button>
        {apps && <div className="menu dev-apps nodrag nowheel" data-testid="device-apps-menu" onMouseLeave={() => setApps(null)}>{apps.length ? apps.map((a) => <div key={a} className="mi" onClick={() => { setApps(null); void act({ action: "launch", package: a }); }}>{a}</div>) : <div className="mi mut">nenhum app de terceiros</div>}</div>}
      </div>
      <Handle type="source" position={Position.Right} /><Handle type="target" position={Position.Left} />
    </div>
  );
}
export const DeviceNode = memo(DeviceNodeImpl);
