import { memo, useEffect, useRef, useState } from "react";
import { useAtomValue } from "jotai";
import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";
import { Layers, Ungroup, ArrowUpFromLine, X } from "lucide-react";
import { parseStack, serializeStack, stackSetActive, type Stack } from "@messai/domain";
import { AgentIcon, agentKind } from "./agentIcons.js";
import { WsIcon } from "./wsicons.js";
import { attentionAtom, unreadAtom, finishedAtom } from "./atoms.js";
import { EditableTitle } from "./EditableTitle.js";
import { TerminalView, type TerminalViewHandle } from "./TerminalView.js";
import type { Api, Stream } from "./api.js";

/** #70 — Pilha: terminais de uma banda agrupados num só nó, com abas. Só a aba ativa monta o terminal ao vivo; as sessões continuam rodando no runtime. */
export type StackChild = { nodeId: string; sessionId: string; title: string; icon?: string; color?: string; termTheme?: string };
export type StackData = {
  title: string; content: string; children: StackChild[]; api: Api; stream: Stream; editSignal?: number;
  onChange: (content: string) => void; onRename: (t: string) => void; onDelete: () => void;
  onUngroup: () => void; onSpill: (nodeId: string) => void;
  focusChild?: { nodeId: string; n: number }; // sinal do painel de bandas: ativa esta aba
};

/** Aba de um membro, com selo de atenção/não-lidas lido dos átomos (não re-renderiza a pilha inteira). */
function StackTab({ child, active, onClick, onSpill }: { child: StackChild; active: boolean; onClick: () => void; onSpill: () => void }) {
  const att = useAtomValue(attentionAtom(child.nodeId));
  const fin = useAtomValue(finishedAtom(child.nodeId));
  const unread = useAtomValue(unreadAtom(child.nodeId));
  const kind = agentKind(child.title);
  return (
    <div className={`sk-tab ${active ? "on" : ""} ${att ? "att" : ""}`} data-testid="stack-tab" title={child.title} onClick={onClick}>
      {child.icon ? <WsIcon icon={child.icon} color={child.color || "currentColor"} size={13} /> : kind !== "shell" ? <AgentIcon id={kind} size={13} /> : null}
      <span className="sk-tab-nm">{child.title}</span>
      {(att || fin) && <span className="sk-dot" title="precisa de atenção" />}
      {unread > 0 && <span className="sk-badge" title="mensagens não lidas">{unread}</span>}
      <button className="sk-spill nodrag" title="Tirar da pilha (volta a ser um nó)" data-testid="stack-spill" onClick={(e) => { e.stopPropagation(); onSpill(); }}><ArrowUpFromLine size={11} /></button>
    </div>
  );
}

function StackNodeImpl({ data, selected }: NodeProps & { data: StackData }) {
  const [s, setS] = useState<Stack>(() => parseStack(data.content));
  const viewRef = useRef<TerminalViewHandle>(null);
  const last = useRef(data.content);
  useEffect(() => { if (data.content !== last.current) { last.current = data.content; setS(parseStack(data.content)); } }, [data.content]);
  const commit = (next: Stack) => { setS(next); const raw = serializeStack(next); last.current = raw; data.onChange(raw); };
  // sinal do painel: ativa a aba pedida
  useEffect(() => { if (data.focusChild && s.childIds.includes(data.focusChild.nodeId) && s.active !== data.focusChild.nodeId) commit(stackSetActive(s, data.focusChild.nodeId)); }, [data.focusChild?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  const children = data.children; // já resolvidos e na ordem de childIds
  const active = children.find((c) => c.nodeId === s.active) ?? children[0];
  return (
    <div className={`node stack ${selected ? "sel" : ""}`} data-testid="stack">
      <NodeResizer minWidth={360} minHeight={220} isVisible={selected} />
      <Handle type="target" position={Position.Left} /><Handle type="source" position={Position.Right} />
      <div className="bar">
        <Layers size={13} className="mut" />
        <EditableTitle value={data.title} onSave={data.onRename} editSignal={data.editSignal ?? 0} />
        <span className="mut bd-count">{children.length} terminais</span>
        <span className="sp" />
        <button className="ib nodrag" title="Desagrupar: cada terminal volta a ser um nó" data-testid="stack-ungroup" onClick={data.onUngroup}><Ungroup size={13} /></button>
        <button className="ib nodrag" title="Remover a pilha (os terminais voltam ao canvas)" onClick={data.onDelete}><X size={13} /></button>
      </div>
      <div className="sk-tabs nodrag nowheel" data-testid="stack-tabs">
        {children.map((c) => (
          <StackTab key={c.nodeId} child={c} active={c.nodeId === active?.nodeId} onClick={() => commit(stackSetActive(s, c.nodeId))} onSpill={() => data.onSpill(c.nodeId)} />
        ))}
        {children.length === 0 && <span className="mut" style={{ padding: "6px 8px" }}>Pilha vazia — desagrupe para recuperar os terminais.</span>}
      </div>
      <div className="sk-body">
        {active
          ? <TerminalView key={active.nodeId} ref={viewRef} sessionId={active.sessionId} nodeId={active.nodeId} api={data.api} stream={data.stream} termTheme={active.termTheme ?? null} />
          : <div className="sk-empty mut">Nenhum terminal ativo.</div>}
      </div>
      <Handle type="source" position={Position.Right} /><Handle type="target" position={Position.Left} />
    </div>
  );
}
export const StackNode = memo(StackNodeImpl);
