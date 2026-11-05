import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { SearchAddon } from "@xterm/addon-search";
import "@xterm/xterm/css/xterm.css";
import type { Session } from "@messai/contracts";
import { usePref } from "./prefs.js";
import { effectiveScrollback, fontStack, parseCustomPalette, resolveTermTheme } from "./term-theme.js";
import { onTheme, cssVar } from "./theme.js";
import { finishedMapAtom, summaryMapAtom, store } from "./atoms.js";
import type { Api, Stream } from "./api.js";

/**
 * View reutilizável do terminal ao vivo (xterm + stream). Antes vivia dentro do TerminalNode; agora o nó e o
 * nó-pilha (#70 banda agrupada) compartilham a mesma lógica. Dona de: xterm, anexar/soltar sessão, tema, fit e busca.
 */
export type TerminalViewHandle = { clear: () => void; openFind: () => void };
type Props = {
  sessionId: string; nodeId: string; api: Api; stream: Stream;
  termTheme?: string | null; padX?: number; padY?: number;
  onSession?: (s: Session) => void; onResume?: () => void; onFocus?: () => void;
};
export const TerminalView = forwardRef<TerminalViewHandle, Props>(function TerminalView(
  { sessionId, nodeId, api, stream, termTheme, padX, padY, onSession, onResume, onFocus }, ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal>(null);
  const searchRef = useRef<SearchAddon>(null);
  const [find, setFind] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const resumedRef = useRef(false);
  const stateRef = useRef<string>("");
  const fitNow = useRef<() => void>(null);
  const cbRef = useRef({ onSession, onResume, onFocus }); cbRef.current = { onSession, onResume, onFocus };

  const pTheme = usePref("termTheme"); const pCustom = usePref("termCustom"); const pFont = usePref("termFont"); const pSize = usePref("termFontSize");
  const pPadX = padX ?? usePref("termPadX"); const pPadY = padY ?? usePref("termPadY"); const pMem = usePref("termMemLimit"); const pScroll = usePref("termScrollback"); const pCopy = usePref("termCopyOnSelect");
  const themeRef = useRef({ node: termTheme, pref: pTheme, custom: pCustom }); themeRef.current = { node: termTheme, pref: pTheme, custom: pCustom };
  const copyRef = useRef(pCopy); copyRef.current = pCopy;
  const xtermTheme = () => resolveTermTheme(themeRef.current.node ?? undefined, themeRef.current.pref, parseCustomPalette(themeRef.current.custom),
    { background: cssVar("--term-bg") || "#0a0a0b", foreground: cssVar("--term-fg") || "#e4e4e7", cursor: cssVar("--acc") || "#4a9eff", selectionBackground: cssVar("--term-sel") || "rgba(74,158,255,.35)" });
  const applyTheme = () => { const t = xtermTheme(); if (termRef.current) termRef.current.options.theme = t; if (host.current) { host.current.style.backgroundColor = t.background; host.current.style.color = t.foreground; } };
  useEffect(() => { applyTheme(); }, [termTheme, pTheme, pCustom]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = termRef.current; if (!t) return; t.options.fontSize = pSize; t.options.fontFamily = fontStack(pFont); fitNow.current?.(); }, [pSize, pFont]);
  useEffect(() => { fitNow.current?.(); }, [pPadX, pPadY]);
  useEffect(() => { const t = termRef.current; if (t) t.options.scrollback = effectiveScrollback(pMem, pScroll); }, [pMem, pScroll]);
  useImperativeHandle(ref, () => ({ clear: () => termRef.current?.clear(), openFind: () => setFind((v) => (v === null ? "" : null)) }), []);

  useEffect(() => {
    const p0 = { font: fontStack(pFont), size: pSize, scroll: effectiveScrollback(pMem, pScroll) };
    const term = new Terminal({ cursorBlink: true, fontSize: p0.size, fontFamily: p0.font, theme: xtermTheme(), scrollback: p0.scroll, allowProposedApi: true });
    const fit = new FitAddon();
    const search = new SearchAddon();
    term.loadAddon(new Unicode11Addon());
    term.loadAddon(fit);
    term.loadAddon(search);
    searchRef.current = search;
    term.unicode.activeVersion = "11";
    term.attachCustomKeyEventHandler((e) => { if (e.type === "keydown" && (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "f") { setFind((v) => v ?? ""); return false; } return true; });
    term.open(host.current!);
    termRef.current = term;
    applyTheme();
    const offTheme = onTheme(() => applyTheme());
    let lastSeq = 0;
    let mine = false;
    const sendResize = () => { if (mine) stream.send({ type: "resize", sessionId, cols: term.cols, rows: term.rows }); };
    const off = stream.on((m) => {
      if ("sessionId" in m && m.sessionId !== sessionId) return;
      if (m.type === "snapshot") { term.reset(); term.write(m.data); lastSeq = m.sequence; mine = m.session.lease?.clientId === stream.clientId; cbRef.current.onSession?.(m.session); stateRef.current = m.session.state; if (m.session.state === "lost" && !resumedRef.current) { resumedRef.current = true; cbRef.current.onResume?.(); } }
      else if (m.type === "output") {
        if (m.sequence > lastSeq + 1) stream.attach(sessionId);
        else { term.write(m.data); lastSeq = m.sequence; }
      }
      else if (m.type === "session" && m.session.sessionId === sessionId) { const was = mine; mine = m.session.lease?.clientId === stream.clientId; cbRef.current.onSession?.(m.session); stateRef.current = m.session.state; if (m.session.state === "lost" && !resumedRef.current) { resumedRef.current = true; cbRef.current.onResume?.(); } if (mine && !was) sendResize(); }
      else if (m.type === "error" && "sessionId" in m) { if (m.error.code !== "NOT_FOUND") { setErr(m.error.message); setTimeout(() => setErr(null), 2500); } }
    });
    stream.attach(sessionId);
    const onData = term.onData((d) => stream.send({ type: "input", sessionId, data: d }));
    const applyFit = () => {
      try {
        const d = fit.proposeDimensions();
        if (!d || !Number.isFinite(d.cols) || !Number.isFinite(d.rows)) return;
        if (d.cols < 2 || d.rows < 1 || d.cols > 1000 || d.rows > 1000) return;
        if (d.cols !== term.cols || d.rows !== term.rows) term.resize(d.cols, d.rows);
        sendResize();
      } catch { /* ainda sem layout */ }
    };
    fitNow.current = applyFit;
    const ro = new ResizeObserver(applyFit);
    ro.observe(host.current!);
    const onSel = term.onSelectionChange(() => { if (copyRef.current && term.hasSelection()) void navigator.clipboard.writeText(term.getSelection()).catch(() => {}); });
    const el = host.current!;
    const focus = () => {
      if (stateRef.current === "running") stream.send({ type: "acquireLease", sessionId });
      store.set(finishedMapAtom, (p) => { if (!(nodeId in p)) return p; const n = { ...p }; delete n[nodeId]; return n; });
      store.set(summaryMapAtom, (p) => { if (!(nodeId in p)) return p; const n = { ...p }; delete n[nodeId]; return n; });
      void window.messai.hudDismiss?.(nodeId);
      void api.seen(nodeId).catch(() => {});
      cbRef.current.onFocus?.();
    };
    el.addEventListener("focusin", focus);
    return () => { fitNow.current = null; onSel.dispose(); ro.disconnect(); onData.dispose(); off(); offTheme(); el.removeEventListener("focusin", focus); stream.detach(sessionId); term.dispose(); };
  }, [sessionId, stream]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="term-view">
      {err && <div className="err">{err}</div>}
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
      <div className="term nodrag nowheel" ref={host} tabIndex={0} style={{ padding: `${pPadY}px ${pPadX}px` }}
        onDragOver={(e) => { if (e.dataTransfer.types.includes("text/mess-path") || e.dataTransfer.types.includes("text/plain")) e.preventDefault(); }}
        onDrop={(e) => { const p = e.dataTransfer.getData("text/mess-path") || e.dataTransfer.getData("text/plain"); if (!p) return; e.preventDefault(); stream.send({ type: "acquireLease", sessionId }); stream.send({ type: "input", sessionId, data: /\s/.test(p) ? `'${p}' ` : `${p} ` }); }} />
    </div>
  );
});
