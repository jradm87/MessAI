import { useEffect, useRef, useState, memo, type CSSProperties } from "react";
import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";
import { ArrowDown, ArrowUp, ArrowUpFromLine, ChevronsUp, Download, Layers, Palette, Pencil, Plus, Trash2, Unlink } from "lucide-react";
import { binderAddPage, binderBringToFront, binderDeletePage, binderMovePage, binderPatchPage, binderSetActive, parseBinder, serializeBinder, type Binder } from "@messai/domain";
import type { ConfirmReq } from "./ConfirmDialog.js";
import { EditableTitle } from "./EditableTitle.js";
import { WS_COLORS } from "./wsicons.js";

/** #74 — Fichário: várias páginas (notas) num só nó, com abas laterais e cor uniforme. O conteúdo do nó é o JSON do fichário. */
export type BinderData = {
  title: string; content: string; groupId?: string; editSignal?: number;
  onChange: (content: string) => void; onRename: (t: string) => void; onDelete: () => void;
  onSpill: (pageId: string) => void; onUnstack: () => void; onPull: () => void; // tirar página / desmontar / puxar notas selecionadas
  confirm?: (req: ConfirmReq) => Promise<boolean>;
};
function BinderNodeImpl({ data, selected }: NodeProps & { data: BinderData }) {
  const [b, setB] = useState<Binder>(() => parseBinder(data.content));
  const [colors, setColors] = useState(false);
  // menu da aba: renderizado FORA da coluna de abas (que rola e cortava o menu), posicionado na altura da aba
  const [menu, setMenu] = useState<{ id: string; top: number } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const last = useRef(data.content);
  useEffect(() => { if (data.content !== last.current) { last.current = data.content; setB(parseBinder(data.content)); } }, [data.content]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const commit = (next: Binder, now = false) => { setB(next); clearTimeout(timer.current); const fire = () => { const raw = serializeBinder(next); last.current = raw; data.onChange(raw); }; if (now) fire(); else timer.current = setTimeout(fire, 500); };
  const page = b.pages.find((p) => p.id === b.active) ?? b.pages[0]!;
  const menuPage = menu ? b.pages.find((p) => p.id === menu.id) : undefined;
  const idx = menuPage ? b.pages.indexOf(menuPage) : -1;
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
      <div className="bd-body" ref={bodyRef} onMouseDown={(e) => { if (menu && !(e.target as HTMLElement).closest(".bd-menu")) setMenu(null); }}>
        <div className="bd-tabs nodrag nowheel" data-testid="binder-tabs">
          {b.pages.map((p) => (
            <div key={p.id} className={`bd-tab ${p.id === b.active ? "on" : ""}`} data-testid="binder-tab" title={p.title}
              style={p.color ? ({ "--page-color": p.color } as CSSProperties) : undefined}
              onClick={() => { if (renaming !== p.id) commit(binderSetActive(b, p.id), true); }}
              onContextMenu={(e) => {
                e.preventDefault(); e.stopPropagation(); const body = bodyRef.current; if (!body) return;
                const br = body.getBoundingClientRect(); const k = br.height / (body.offsetHeight || br.height); // zoom do canvas
                setMenu({ id: p.id, top: Math.max(0, Math.min((e.currentTarget.getBoundingClientRect().top - br.top) / k, body.offsetHeight - 270)) }); // não vaza pelo rodapé do nó
              }}
              onDoubleClick={() => setRenaming(p.id)}>
              {renaming === p.id
                ? <input className="bd-rename" autoFocus defaultValue={p.title} data-testid="binder-rename"
                    onClick={(e) => e.stopPropagation()}
                    onBlur={(e) => { const t = e.target.value.trim(); setRenaming(null); if (t && t !== p.title) commit(binderPatchPage(b, p.id, { title: t }), true); }}
                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); else if (e.key === "Escape") setRenaming(null); }} />
                : <span>{p.title}</span>}
            </div>
          ))}
          <button className="bd-add nodrag" title="Adicionar página" data-testid="binder-add" onClick={() => commit(binderAddPage(b), true)}><Plus size={13} /></button>
        </div>
        {menuPage && (
          <div className="menu bd-menu nodrag" style={{ top: menu!.top }} onMouseLeave={() => setMenu(null)} data-testid="binder-menu">
            <div className="mi" data-testid="binder-rename-mi" onClick={() => { setMenu(null); setRenaming(menuPage.id); }}><Pencil size={13} /> Renomear</div>
            <div className="bd-swatches">
              <Palette size={13} className="mut" />
              <button className={`sw ${!menuPage.color ? "on" : ""}`} style={{ background: "var(--note-bar)" }} title="sem cor" onClick={() => commit(binderPatchPage(b, menuPage.id, { color: "" }), true)} />
              {WS_COLORS.map((c) => <button key={c} className={`sw ${menuPage.color === c ? "on" : ""}`} style={{ background: c }} title={c} data-testid="binder-page-color" onClick={() => commit(binderPatchPage(b, menuPage.id, { color: c }), true)} />)}
            </div>
            <div className={`mi ${idx <= 0 ? "off" : ""}`} onClick={() => { if (idx > 0) commit(binderMovePage(b, menuPage.id, idx - 1), true); }}><ArrowUp size={13} /> Mover para cima</div>
            <div className={`mi ${idx >= b.pages.length - 1 ? "off" : ""}`} onClick={() => { if (idx < b.pages.length - 1) commit(binderMovePage(b, menuPage.id, idx + 1), true); }}><ArrowDown size={13} /> Mover para baixo</div>
            <div className="mi" data-testid="binder-front" onClick={() => { setMenu(null); commit(binderBringToFront(b, menuPage.id), true); }}><ChevronsUp size={13} /> Trazer para frente</div>
            <div className={`mi ${b.pages.length <= 1 ? "off" : ""}`} data-testid="binder-spill" onClick={() => { setMenu(null); if (b.pages.length > 1) data.onSpill(menuPage.id); }}><ArrowUpFromLine size={13} /> Tirar (vira nota)</div>
            <div className={`mi danger ${b.pages.length <= 1 ? "off" : ""}`} data-testid="binder-delete" onClick={() => void (async () => {
              setMenu(null); if (b.pages.length <= 1) return;
              if (data.confirm && !(await data.confirm({ title: `Apagar a página "${menuPage.title}"?`, body: "O conteúdo da página será perdido (para guardar, use Tirar: vira nota).", confirmLabel: "Apagar", danger: true }))) return;
              const nb = binderDeletePage(b, menuPage.id); if (nb) commit(nb, true);
            })()}><Trash2 size={13} /> Apagar página</div>
          </div>
        )}
        <textarea key={page.id} className="bd-text nodrag nowheel" style={page.color ? { background: `color-mix(in srgb, ${page.color} 7%, transparent)` } : undefined} value={page.content} data-testid="binder-text" placeholder="Escreva aqui… (clique direito na aba: renomear, cor, mover, tirar, apagar · duplo clique: renomear)" onChange={(e) => commit(binderPatchPage(b, page.id, { content: e.target.value }))} />
      </div>
    </div>
  );
}
/** #42 memo (ver os outros nós). */
export const BinderNode = memo(BinderNodeImpl);
