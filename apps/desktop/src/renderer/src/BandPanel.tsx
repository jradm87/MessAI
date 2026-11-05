import { useState } from "react";
import { Users, ChevronDown, ChevronRight, MessageSquarePlus, Loader2, Plus, Layers, Ungroup } from "lucide-react";
import type { Band } from "@messai/contracts";
import { bandColor } from "./bands.js";

/**
 * #70 — Painel de bandas no canto do canvas: cada banda é um grupo recolhível com seus membros (como o "RECON" do Maestri).
 * Clicar num membro foca o nó (ou abre a pilha e ativa a aba, se agrupada); dá pra agrupar/desagrupar os terminais num só nó.
 */
type Term = { nodeId: string; title: string };
export function BandPanel({ bands, terminals, selectedId, groupedBands, onFocus, onManage, onGroup, onUngroup }: {
  bands: Band[]; terminals: Term[]; selectedId: string | null; groupedBands: Set<string>;
  onFocus: (nodeId: string) => void; onManage: () => void; onGroup: (bandId: string) => void; onUngroup: (bandId: string) => void;
}) {
  const [open, setOpen] = useState<boolean>(() => { try { return localStorage.getItem("mess.bandpanel") !== "0"; } catch { return true; } });
  const [closed, setClosed] = useState<Set<string>>(new Set());
  if (!bands.length) return null;
  const titleOf = (id: string) => terminals.find((t) => t.nodeId === id)?.title ?? "—";
  const setOpenP = (v: boolean) => { setOpen(v); try { localStorage.setItem("mess.bandpanel", v ? "1" : "0"); } catch { /* sem storage */ } };
  const toggleBand = (id: string) => setClosed((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <div className="band-panel" data-testid="band-panel">
      <div className="bp-head" onClick={() => setOpenP(!open)}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <Users size={13} /> <b>BANDAS</b> <span className="mut">{bands.length}</span>
        <span className="sp" />
        <button className="tb" title="Gerenciar bandas / perguntar em lote" data-testid="bp-manage" onClick={(e) => { e.stopPropagation(); onManage(); }}><Plus size={13} /></button>
      </div>
      {open && (
        <div className="bp-body">
          {bands.map((b, i) => {
            const col = bandColor(b, i); const isClosed = closed.has(b.bandId); const grouped = groupedBands.has(b.bandId);
            return (
              <div key={b.bandId} className="bp-band" data-testid="bp-band">
                <div className="bp-band-head" style={{ borderLeftColor: col }} onClick={() => toggleBand(b.bandId)}>
                  {isClosed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                  <span className="bp-dot" style={{ background: col }} />
                  <span className="bp-name" title={b.name}>{b.name}</span>
                  <span className="mut">{b.nodeIds.length}</span>
                  {b.asking.length > 0 && <Loader2 size={11} className="spin" />}
                  <span className="sp" />
                  {grouped
                    ? <button className="tb on" title="Desagrupar: cada terminal volta a ser um nó" data-testid="bp-ungroup" onClick={(e) => { e.stopPropagation(); onUngroup(b.bandId); }}><Ungroup size={12} /></button>
                    : <button className="tb" title="Agrupar os terminais num só nó (abas)" data-testid="bp-group" onClick={(e) => { e.stopPropagation(); onGroup(b.bandId); }}><Layers size={12} /></button>}
                  <button className="tb" title="Perguntar / transmitir à banda" onClick={(e) => { e.stopPropagation(); onManage(); }}><MessageSquarePlus size={12} /></button>
                </div>
                {!isClosed && (
                  <div className="bp-members">
                    {b.nodeIds.length === 0 && <div className="mut bp-empty">sem membros</div>}
                    {b.nodeIds.map((id) => (
                      <button key={id} className={`bp-member ${selectedId === id ? "on" : ""} ${b.asking.includes(id) ? "asking" : ""}`} onClick={() => onFocus(id)} title={titleOf(id)} data-testid="bp-member">
                        <span className="bp-mdot" style={{ background: col }} />
                        <span className="bp-mname">{titleOf(id)}</span>
                        {b.asking.includes(id) && <Loader2 size={10} className="spin" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
