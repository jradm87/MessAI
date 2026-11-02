import { useEffect, useState } from "react";
import { LayoutTemplate, Play, Save, Trash2, Pencil } from "lucide-react";
import type { Score } from "@messai/contracts";
import type { Api } from "./api.js";

/** #71 — Partituras: salvar a seleção (ou o espaço todo) como arranjo nomeado e recolocá-lo em qualquer espaço/andar. */
type Props = { api: Api; hasSelection: number; onSave: (name: string, description: string) => Promise<void>; onPlace: (score: Score) => Promise<string[]>; onClose: () => void };
export function ScoresDialog({ api, hasSelection, onSave, onPlace, onClose }: Props) {
  const [scores, setScores] = useState<Score[] | null>(null);
  const [name, setName] = useState(""); const [desc, setDesc] = useState("");
  const [msg, setMsg] = useState(""); const [warn, setWarn] = useState<string[]>([]);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const load = () => api.scores().then(setScores).catch(() => setScores([]));
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }; window.addEventListener("keydown", k, true); return () => window.removeEventListener("keydown", k, true); }, [onClose]);
  const say = (t: string) => { setMsg(t); setTimeout(() => setMsg(""), 3000); };
  const save = async () => { try { await onSave(name.trim(), desc.trim()); setName(""); setDesc(""); await load(); say("partitura salva"); } catch (e) { say(String(e instanceof Error ? e.message : e)); } };
  const place = async (s: Score) => { try { const w = await onPlace(s); setWarn(w); if (!w.length) onClose(); } catch (e) { say(String(e instanceof Error ? e.message : e)); } };
  const del = async (s: Score) => { if (!confirm(`Apagar a partitura "${s.name}"?`)) return; await api.deleteScore(s.scoreId); await load(); };
  const rename = async () => { if (!editing || !editing.name.trim()) return; try { await api.patchScore(editing.id, { name: editing.name.trim() }); setEditing(null); await load(); } catch (e) { say(String(e instanceof Error ? e.message : e)); } };
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal scores-modal" data-testid="scores-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <h2 className="left"><LayoutTemplate size={16} /> Partituras</h2>
        <div className="mut hint">Um arranjo salvo do canvas — terminais/agentes (comando, papel, habilidades, aparência), notas, conexões e posições relativas — para recolocar em qualquer espaço ou andar com um clique.</div>
        <div className="scores-save">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome da nova partitura" data-testid="score-name" />
          <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Descrição (opcional)" />
          <button className="pri" disabled={!name.trim()} onClick={() => void save()} data-testid="score-save"><Save size={14} /> Salvar {hasSelection > 0 ? `seleção (${hasSelection})` : "espaço todo"}</button>
        </div>
        {msg && <div className="mut">{msg}</div>}
        {warn.length > 0 && <div className="err" data-testid="score-warnings">{warn.map((w) => <div key={w}>⚠ {w}</div>)}</div>}
        <div className="pt-list" data-testid="score-list">
          {scores?.map((s) => (
            <div key={s.scoreId} className="pt-row" data-testid="score-row">
              <LayoutTemplate size={16} />
              <span className="pt-name">{editing?.id === s.scoreId ? <input autoFocus value={editing.name} onChange={(e) => setEditing({ id: s.scoreId, name: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") void rename(); if (e.key === "Escape") setEditing(null); }} onBlur={() => void rename()} /> : <span>{s.name}</span>}
                <small>{s.nodes.length} nó(s) · {s.nodes.filter((n) => n.kind === "terminal").length} terminal(is) · {s.connections.length} conexão(ões){s.description ? ` · ${s.description}` : ""}</small></span>
              <button className="pri" onClick={() => void place(s)} data-testid={`score-place-${s.name}`}><Play size={14} /> Colocar aqui</button>
              <button className="tb" title="Renomear" onClick={() => setEditing({ id: s.scoreId, name: s.name })}><Pencil size={14} /></button>
              <button className="tb danger" title="Apagar" onClick={() => void del(s)}><Trash2 size={14} /></button>
            </div>
          ))}
          {scores && scores.length === 0 && <div className="mut">Nenhuma partitura ainda. Selecione nós no canvas (ou nenhum, para o espaço todo), dê um nome e salve.</div>}
        </div>
        <div className="actions"><button onClick={onClose}>Fechar</button></div>
      </div>
    </div>
  );
}
