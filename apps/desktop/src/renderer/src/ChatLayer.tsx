import { useEffect, useMemo, useRef, useState } from "react";
import { Eraser, X, FileText, Image as ImageIcon, File as FileIcon, Trash2, ExternalLink } from "lucide-react";
import type { ChatAttachment, ChatMessage } from "@messai/contracts";
import type { Api } from "./api.js";
import { renderMarkdown, useMermaid } from "./md.js";

export const THREAD_COLORS = ["#5aa9ff", "#4cd964", "#ff9f43", "#a66bff", "#ff6bb5", "#2bc8b3", "#f6c344"] as const;
const render = renderMarkdown;
const fmtSize = (n: number): string => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

/** Camada de chat sobre o terminal (Ctrl+J): 7 tópicos com cor, balões em Markdown, copiar código, anexos como cards (#79), limpar tópico. */
export function ChatLayer({ nodeId, title, api, thread, setThread, messages, onClose }: { nodeId: string; title: string; api: Api; thread: number; setThread: (t: number) => void; messages: ChatMessage[]; onClose: () => void }) {
  const list = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [view, setView] = useState<{ att: ChatAttachment; text?: string } | null>(null);
  const shown = useMemo(() => messages.filter((m) => m.thread === thread && m.role !== "system"), [messages, thread]);
  useEffect(() => { const el = list.current; if (el) el.scrollTop = el.scrollHeight; }, [shown.length, thread]);
  useMermaid(list, [shown]);
  const onClick = (e: React.MouseEvent) => {
    const mm = (e.target as HTMLElement).closest(".mermaid-box") as HTMLElement | null;
    const pre = mm ?? (e.target as HTMLElement).closest("pre"); if (!pre) return;
    void navigator.clipboard.writeText(mm ? (mm.dataset["src"] ?? "") : (pre.textContent ?? "")).then(() => { setCopied(pre.textContent ?? ""); setTimeout(() => setCopied(null), 1200); });
  };
  const openAtt = async (att: ChatAttachment) => {
    if (att.mime.startsWith("image/")) { setView({ att }); return; }
    if (att.mime.startsWith("text/") || att.mime === "application/json") {
      try { const text = await api.chatAttachmentText(att.attachmentId); setView({ att, text }); return; } catch { /* fallback */ }
    }
    void window.messai.openPath?.(att.path);
  };
  const dragAtt = (ev: React.DragEvent, att: ChatAttachment) => {
    ev.dataTransfer.setData("application/x-mess-chat-att", JSON.stringify(att));
    ev.dataTransfer.setData("text/mess-path", att.path);
    ev.dataTransfer.setData("text/plain", att.path);
    ev.dataTransfer.effectAllowed = "copy";
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
            {m.attachments && m.attachments.length > 0 && (
              <div className="chat-atts" data-testid="chat-attachments">
                {m.attachments.map((att) => (
                  <div key={att.attachmentId} className="chat-att-card" data-testid="chat-att-card" draggable onDragStart={(ev) => dragAtt(ev, att)} onClick={(ev) => { ev.stopPropagation(); void openAtt(att); }}>
                    {att.mime.startsWith("image/") ? <img src={api.chatAttachmentUrl(att.attachmentId)} alt={att.name} className="chat-att-thumb" /> : att.mime.startsWith("text/") ? <FileText size={16} /> : <FileIcon size={16} />}
                    <span className="chat-att-meta">
                      <b className="chat-att-name">{att.name}</b>
                      <small className="mut">{fmtSize(att.size)} · arraste pro canvas ou árvore</small>
                    </span>
                    <button className="tb" title="Abrir" data-testid="chat-att-open" onClick={(ev) => { ev.stopPropagation(); void openAtt(att); }}><ExternalLink size={12} /></button>
                    <button className="tb danger" title="Excluir anexo" data-testid="chat-att-delete" onClick={(ev) => { ev.stopPropagation(); void api.deleteChatAttachment(att.attachmentId); }}><Trash2 size={12} /></button>
                  </div>
                ))}
              </div>
            )}
            <div className="when">{m.createdAt.slice(11, 16)}</div>
          </div>
        ))}
        {copied !== null && <div className="copied">código copiado</div>}
      </div>
      {view && (
        <div className="modal-backdrop" onMouseDown={() => setView(null)}>
          <div className="modal preview-modal" data-testid="chat-att-viewer" onMouseDown={(e) => e.stopPropagation()}>
            <h2 className="left">{view.att.mime.startsWith("image/") ? <ImageIcon size={15} /> : <FileText size={15} />} {view.att.name}</h2>
            {view.att.mime.startsWith("image/") ? <img src={api.chatAttachmentUrl(view.att.attachmentId)} alt={view.att.name} style={{ maxWidth: "100%", maxHeight: "65vh", objectFit: "contain" }} /> : <pre className="preview-text">{view.text ?? ""}</pre>}
            <div className="actions"><button className="pri" onClick={() => setView(null)}>Fechar</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
