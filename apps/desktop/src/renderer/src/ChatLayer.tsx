import { useEffect, useMemo, useRef, useState } from "react";
import { Eraser, X } from "lucide-react";
import type { ChatMessage } from "@messai/contracts";
import type { Api } from "./api.js";
import { renderMarkdown, useMermaid } from "./md.js";

export const THREAD_COLORS = ["#5aa9ff", "#4cd964", "#ff9f43", "#a66bff", "#ff6bb5", "#2bc8b3", "#f6c344"] as const;
const render = renderMarkdown;

/** Camada de chat sobre o terminal (Ctrl+J): 7 tópicos com cor, balões em Markdown, copiar código, limpar tópico. */
export function ChatLayer({ nodeId, title, api, thread, setThread, messages, onClose }: { nodeId: string; title: string; api: Api; thread: number; setThread: (t: number) => void; messages: ChatMessage[]; onClose: () => void }) {
  const list = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const shown = useMemo(() => messages.filter((m) => m.thread === thread && m.role !== "system"), [messages, thread]);
  useEffect(() => { const el = list.current; if (el) el.scrollTop = el.scrollHeight; }, [shown.length, thread]);
  useMermaid(list, [shown]);
  const onClick = (e: React.MouseEvent) => {
    const mm = (e.target as HTMLElement).closest(".mermaid-box") as HTMLElement | null;
    const pre = mm ?? (e.target as HTMLElement).closest("pre"); if (!pre) return;
    void navigator.clipboard.writeText(mm ? (mm.dataset["src"] ?? "") : (pre.textContent ?? "")).then(() => { setCopied(pre.textContent ?? ""); setTimeout(() => setCopied(null), 1200); });
  };
  return (
    <div className="chat nodrag nowheel" data-testid="chat" onMouseDown={(e) => e.stopPropagation()}>
      <div className="chat-head">
        <span className="chat-title">Chat · {title}</span>
        <div className="threads">
          {THREAD_COLORS.map((c, i) => <button key={c} className={`th ${thread === i + 1 ? "on" : ""}`} style={{ background: c }} title={`Tópico ${i + 1}`} onClick={() => setThread(i + 1)} />)}
        </div>
        <button className="tb" title="Limpar tópico" onClick={() => { if (confirm(`Limpar o tópico ${thread}?`)) void api.clearChat(nodeId, thread); }}><Eraser size={14} /></button>
        <button className="tb" title="Fechar (Ctrl+J)" onClick={onClose}><X size={14} /></button>
      </div>
      <div className="bubbles" ref={list} onClick={onClick}>
        {shown.length === 0 && <div className="mut empty-chat">Sem mensagens neste tópico. Escreva no compositor abaixo; o agente responde com <code>mess say</code>.</div>}
        {shown.map((m) => (
          <div key={m.chatId} className={`bubble ${m.role}`} style={m.role === "user" ? { borderColor: THREAD_COLORS[thread - 1] } : undefined}>
            <div className="md" dangerouslySetInnerHTML={{ __html: render(m.text) }} />
            <div className="when">{m.createdAt.slice(11, 16)}</div>
          </div>
        ))}
        {copied !== null && <div className="copied">código copiado</div>}
      </div>
    </div>
  );
}
