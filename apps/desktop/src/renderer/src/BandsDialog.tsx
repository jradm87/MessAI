import { useEffect, useState } from "react";
import { Users, Plus, Trash2, Send, Radio, Loader2 } from "lucide-react";
import type { Band, BandAskResult } from "@messai/contracts";
import type { Api } from "./api.js";
import { bandColor } from "./bands.js";

/** #70 — Bandas: grupos nomeados de terminais/agentes. Perguntar em lote (coleta a resposta de cada membro) ou transmitir (broadcast). */
type Props = { api: Api; workspaceId: string; bands: Band[]; terminals: { nodeId: string; title: string }[]; selected: string[]; onClose: () => void };
export function BandsDialog({ api, workspaceId, bands, terminals, selected, onClose }: Props) {
  const [name, setName] = useState("");
  const [msg, setMsg] = useState("");
  const [text, setText] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, BandAskResult>>({});
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }; window.addEventListener("keydown", k, true); return () => window.removeEventListener("keydown", k, true); }, [onClose]);
  const say = (t: string) => { setMsg(t); setTimeout(() => setMsg(""), 3500); };
  const err = (e: unknown) => say(String(e instanceof Error ? e.message : e));
  const create = async () => { try { await api.createBand(workspaceId, { name: name.trim(), nodeIds: selected.filter((id) => terminals.some((t) => t.nodeId === id)) }); setName(""); } catch (e) { err(e); } };
  const toggle = async (b: Band, id: string) => { try { await api.patchBand(b.bandId, b.nodeIds.includes(id) ? { removeNodeIds: [id] } : { addNodeIds: [id] }); } catch (e) { err(e); } };
  const run = async (b: Band, kind: "ask" | "say") => {
    const t = (text[b.bandId] ?? "").trim(); if (!t) return;
    setBusy(b.bandId + kind);
    try {
      const r = kind === "ask" ? await api.askBand(b.bandId, { text: t }) : await api.broadcastBand(b.bandId, { text: t });
      setResults((o) => ({ ...o, [b.bandId]: r }));
      if (kind === "say") setText((o) => ({ ...o, [b.bandId]: "" }));
    } catch (e) { err(e); } finally { setBusy(null); }
  };
  const del = async (b: Band) => { if (!confirm(`Apagar a banda "${b.name}"? Os terminais continuam no canvas.`)) return; try { await api.deleteBand(b.bandId); } catch (e) { err(e); } };
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal bands-modal" data-testid="bands-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <h2 className="left"><Users size={16} /> Bandas</h2>
        <div className="mut hint">Um grupo nomeado de terminais/agentes. <b>Perguntar</b> manda o mesmo prompt a todos e coleta a resposta de cada um; <b>Transmitir</b> entrega sem esperar.</div>
        <div className="scores-save">
          <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) void create(); }} placeholder="Nome da nova banda" data-testid="band-name" />
          <button className="pri" disabled={!name.trim()} onClick={() => void create()} data-testid="band-create"><Plus size={14} /> Criar{selected.length ? ` com a seleção` : ""}</button>
        </div>
        {msg && <div className="err">{msg}</div>}
        <div className="band-list" data-testid="band-list">
          {bands.map((b, i) => (
            <div key={b.bandId} className="band-card" data-testid="band-card" style={{ borderLeftColor: bandColor(b, i) }}>
              <div className="band-head">
                <span className="band-dot" style={{ background: bandColor(b, i) }} />
                <b data-testid="band-title">{b.name}</b>
                <small className="mut">{b.nodeIds.length} membro(s){b.asking.length ? ` · perguntando a ${b.asking.length}…` : ""}</small>
                <span className="sp" />
                <button className="tb danger" title="Apagar banda" onClick={() => void del(b)}><Trash2 size={14} /></button>
              </div>
              <div className="band-members">
                {terminals.map((t) => (
                  <label key={t.nodeId} className={`band-chip ${b.nodeIds.includes(t.nodeId) ? "on" : ""} ${b.asking.includes(t.nodeId) ? "asking" : ""}`}>
                    <input type="checkbox" checked={b.nodeIds.includes(t.nodeId)} onChange={() => void toggle(b, t.nodeId)} data-testid={`band-member-${b.name}-${t.title}`} />
                    {t.title}{b.asking.includes(t.nodeId) && <Loader2 size={11} className="spin" />}
                  </label>
                ))}
                {terminals.length === 0 && <span className="mut">Nenhum terminal neste espaço.</span>}
              </div>
              <div className="band-ask">
                <textarea rows={2} value={text[b.bandId] ?? ""} onChange={(e) => setText((o) => ({ ...o, [b.bandId]: e.target.value }))} placeholder="Prompt para a banda…" data-testid="band-text" />
                <div className="band-actions">
                  <button className="pri" disabled={!!busy || !b.nodeIds.length || !(text[b.bandId] ?? "").trim()} onClick={() => void run(b, "ask")} data-testid="band-ask"><Send size={13} /> {busy === b.bandId + "ask" ? "Perguntando…" : "Perguntar"}</button>
                  <button disabled={!!busy || !b.nodeIds.length || !(text[b.bandId] ?? "").trim()} onClick={() => void run(b, "say")} data-testid="band-say"><Radio size={13} /> Transmitir</button>
                </div>
              </div>
              {results[b.bandId] && (
                <div className="band-results" data-testid="band-results">
                  {results[b.bandId]!.answers.map((a) => (
                    <div key={a.nodeId} className="band-answer">
                      <b>{a.title}</b> <small className="mut">{a.error ? "" : a.timedOut ? "tempo limite" : a.delivered ? "ok" : ""}</small>
                      {a.error ? <div className="err">{a.error}</div> : <pre>{a.response || (a.delivered ? "(sem saída / transmitido)" : "(não entregue)")}</pre>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          {bands.length === 0 && <div className="mut">Nenhuma banda neste espaço. Selecione terminais no canvas, dê um nome e crie.</div>}
        </div>
        <div className="actions"><button onClick={onClose}>Fechar</button></div>
      </div>
    </div>
  );
}
