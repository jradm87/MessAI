import { useEffect, useRef, useState, memo } from "react";
import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";
import { ArrowUpFromLine, ChevronsUp, Download, Layers, Palette, Plus, Unlink } from "lucide-react";
import { binderAddPage, binderBringToFront, binderPatchPage, binderSetActive, parseBinder, serializeBinder, type Binder } from "@messai/domain";
import { EditableTitle } from "./EditableTitle.js";
import { WS_COLORS } from "./wsicons.js";

/** #74 — Fichário: várias páginas (notas) num só nó, com abas laterais e cor uniforme. O conteúdo do nó é o JSON do fichário. */
export type BinderData = {
  title: string; content: string; groupId?: string; editSignal?: number;
  onChange: (content: string) => void; onRename: (t: string) => void; onDelete: () => void;
  onSpill: (pageId: string) => void; onUnstack: () => void; onPull: () => void; // tirar página / desmontar / puxar notas selecionadas
};
function BinderNodeImpl({ data, selected }: NodeProps & { data: BinderData }) {
  const [b, setB] = useState<Binder>(() => parseBinder(data.content));
  const [colors, setColors] = useState(false);
  const [menu, setMenu] = useState<string | null>(null); // página com menu aberto
  const last = useRef(data.content);
  useEffect(() => { if (data.content !== last.current) { last.current = data.content; setB(parseBinder(data.content)); } }, [data.content]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const commit = (next: Binder, now = false) => { setB(next); clearTimeout(timer.current); const fire = () => { const raw = serializeBinder(next); last.current = raw; data.onChange(raw); }; if (now) fire(); else timer.current = setTimeout(fire, 500); };
  const page = b.pages.find((p) => p.id === b.active) ?? b.pages[0]!;
  const tint = b.color ? { background: `color-mix(in srgb, ${b.color} 14%, var(--note))` } : undefined;
  return (
    <div className={`node note binder ${selected ? "sel" : ""}`} style={tint} data-testid="binder">
      <NodeResizer minWidth={220} minHeight={140} isVisible={selected} />
      <Handle type="target" position={Position.Left} /><Handle type="source" position={Position.Right} />
      <div className="bar" style={b.color ? { background: `color-mix(in srgb, ${b.color} 28%, var(--note-bar))` } : undefined}>
        <Layers size={13} className="mut" />
        <EditableTitle value={data.title} onSave={data.onRename} editSignal={data.editSignal ?? 0} />
        <span className="mut bd-count">{b.pages.length} pág.</span>
        <span className="sp" />
        <button className="ib nodrag" title="Puxar as notas selecionadas para este fichário" data-testid="binder-pull" onClick={data.onPull}><Download size={13} /></button>
        <button className="ib nodrag" title="Cor uniforme" onClick={() => setColors((v) => !v)}><Palette size={13} /></button>
        <button className="ib nodrag" title="Desmontar: cada página vira uma nota" data-testid="binder-unstack" onClick={data.onUnstack}><Unlink size={13} /></button>
        {colors && (
          <div className="menu color-menu nodrag" onMouseLeave={() => setColors(false)}>
            <button className={`sw ${!b.color ? "on" : ""}`} style={{ background: "var(--note-bar)" }} title="padrão" onClick={() => { setColors(false); commit({ ...b, color: "" }, true); }} />
            {WS_COLORS.map((c) => <button key={c} className={`sw ${b.color === c ? "on" : ""}`} style={{ background: c }} title={c} onClick={() => { setColors(false); commit({ ...b, color: c }, true); }} />)}
          </div>
        )}
      </div>
      <div className="bd-body">
        <div className="bd-tabs nodrag nowheel" data-testid="binder-tabs">
          {b.pages.map((p) => (
            <div key={p.id} className={`bd-tab ${p.id === b.active ? "on" : ""}`} data-testid="binder-tab" title={p.title} onClick={() => commit(binderSetActive(b, p.id), true)} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenu(p.id); }} onDoubleClick={() => { const t = prompt("Título da página", p.title); if (t?.trim()) commit(binderPatchPage(b, p.id, { title: t.trim() }), true); }}>
              <span>{p.title}</span>
              {menu === p.id && (
                <div className="menu bd-menu" onMouseLeave={() => setMenu(null)} onClick={(e) => e.stopPropagation()}>
                  <div className="mi" data-testid="binder-front" onClick={() => { setMenu(null); commit(binderBringToFront(b, p.id), true); }}><ChevronsUp size={13} /> Trazer para frente</div>
                  <div className={`mi ${b.pages.length <= 1 ? "off" : ""}`} data-testid="binder-spill" onClick={() => { setMenu(null); if (b.pages.length > 1) data.onSpill(p.id); }}><ArrowUpFromLine size={13} /> Tirar (vira nota)</div>
                </div>
              )}
            </div>
          ))}
          <button className="bd-add nodrag" title="Adicionar página" data-testid="binder-add" onClick={() => commit(binderAddPage(b), true)}><Plus size={13} /></button>
        </div>
        <textarea key={page.id} className="bd-text nodrag nowheel" value={page.content} data-testid="binder-text" placeholder="Escreva aqui… (clique direito na aba: tirar / trazer para frente · duplo clique: renomear)" onChange={(e) => commit(binderPatchPage(b, page.id, { content: e.target.value }))} />
      </div>
    </div>
  );
}
/** #42 memo (ver os outros nós). */
export const BinderNode = memo(BinderNodeImpl);
