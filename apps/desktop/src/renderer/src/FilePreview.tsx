import { useEffect, useRef, useState } from "react";
import type { FileContent, GitCommitEntry } from "@messai/contracts";
import { ApiClientError, type Api } from "./api.js";
import { CodeEditor } from "./CodeEditor.js";

/** Cores simples para um diff unificado. */
export function DiffView({ text }: { text: string }) {
  if (!text) return <div className="mut" data-testid="diff-empty">Sem alterações.</div>;
  return <pre className="diff-view" data-testid="diff-view">{text.split("\n").map((l, i) => <div key={i} className={l.startsWith("+++") || l.startsWith("---") || l.startsWith("diff ") || l.startsWith("index ") ? "dh" : l.startsWith("@@") ? "dk" : l.startsWith("+") ? "da" : l.startsWith("-") ? "dd" : ""}>{l || " "}</div>)}</pre>;
}
export const isDark = () => document.documentElement.getAttribute("data-theme") !== "light";

/** #30 — Editor de arquivo (CodeMirror 6) com salvar seguro (detecta mudança externa), diff e histórico git do arquivo. Binário/truncado: somente leitura. */
export function FilePreview({ api, workspaceId, path, onClose, onOpenNote }: { api: Api; workspaceId: string; path: string; onClose: () => void; onOpenNote?: (p: string) => void }) {
  const [f, setF] = useState<FileContent | null>(null); const [err, setErr] = useState<string | null>(null);
  const [text, setText] = useState(""); const [saved, setSaved] = useState(""); const mtime = useRef<number | undefined>(undefined);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null); const [conflict, setConflict] = useState(false); const [asking, setAsking] = useState(false);
  const [tab, setTab] = useState<"edit" | "diff" | "history">("edit"); const [diff, setDiff] = useState<string | null>(null); const [log, setLog] = useState<GitCommitEntry[] | null>(null);
  const load = () => { setErr(null); void api.file(workspaceId, path).then((c) => { setF(c); setText(c.text ?? ""); setSaved(c.text ?? ""); mtime.current = c.mtimeMs; setConflict(false); }).catch((e) => setErr(String(e instanceof Error ? e.message : e))); };
  useEffect(load, [api, workspaceId, path]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = !!f && !f.binary && text !== saved;
  const editable = !!f && !f.binary && !f.truncated;
  const save = async (force = false) => {
    if (!editable || (!dirty && !force)) return;
    try {
      const r = await api.fsOp(workspaceId, { op: "write", path, text, ...(!force && mtime.current !== undefined ? { expectedMtimeMs: mtime.current } : {}) });
      mtime.current = r.mtimeMs; setSaved(text); setConflict(false); setMsg({ kind: "ok", text: "Salvo" }); setDiff(null); setLog(null);
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 409) { setConflict(true); setMsg({ kind: "err", text: "O arquivo mudou no disco desde que foi aberto." }); } else setMsg({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    }
  };
  const saveRef = useRef(save); saveRef.current = save;
  const tryClose = () => { if (dirty) setAsking(true); else onClose(); };
  const closeRef = useRef(tryClose); closeRef.current = tryClose;
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !(e.target as HTMLElement | null)?.closest?.(".cm-editor")) closeRef.current(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, []);
  useEffect(() => {
    if (tab === "diff" && diff === null) void api.gitDiff(workspaceId, path).then((d) => setDiff(d.text)).catch((e) => setDiff(`(erro: ${e instanceof Error ? e.message : String(e)})`));
    if (tab === "history" && log === null) void api.gitLog(workspaceId, 50, path).then(setLog).catch(() => setLog([]));
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="modal-backdrop" onMouseDown={tryClose}>
      <div className="modal preview-modal editor-modal" data-testid="file-preview" onMouseDown={(e) => e.stopPropagation()}>
        <h2 title={path}>{path}{dirty && <span className="dirty-dot" data-testid="editor-dirty" title="alterações não salvas"> ●</span>}</h2>
        {err && <div className="err">{err}</div>}
        {f && !f.binary && (
          <div className="tabs" data-testid="editor-tabs">
            {(["edit", "diff", "history"] as const).map((t) => <button key={t} className={tab === t ? "on" : ""} data-testid={`editor-tab-${t}`} onClick={() => setTab(t)}>{t === "edit" ? "Editar" : t === "diff" ? "Alterações (git)" : "Histórico (git)"}</button>)}
          </div>
        )}
        {f?.binary && <div className="mut">Arquivo binário ({f.size} bytes). Prévia de mídia: em breve.</div>}
        {f && !f.binary && tab === "edit" && <>
          {f.truncated && <div className="mut" data-testid="editor-truncated">Arquivo grande ({f.size} bytes): mostrando os primeiros 512 KB, somente leitura (para nunca gravar um arquivo cortado).</div>}
          <CodeEditor value={text} path={path} readOnly={!editable} dark={isDark()} onChange={setText} onSave={() => void saveRef.current()} />
        </>}
        {f && !f.binary && tab === "diff" && (diff === null ? <div className="mut">Carregando…</div> : <DiffView text={diff} />)}
        {f && !f.binary && tab === "history" && (log === null ? <div className="mut">Carregando…</div> : log.length === 0 ? <div className="mut" data-testid="history-empty">Sem histórico (arquivo novo ou fora de um repositório git).</div> : (
          <div className="git-log" data-testid="history-list">{log.map((c) => <div key={c.hash} className="git-log-row" title={c.hash}><code>{c.short}</code> <span>{c.subject}</span> <span className="mut">{c.author} · {new Date(c.date).toLocaleString()}</span></div>)}</div>
        ))}
        {msg && <div className={msg.kind === "ok" ? "mut" : "err"} data-testid="editor-msg">{msg.text}</div>}
        {conflict && <div className="row" data-testid="editor-conflict"><button onClick={load}>Recarregar do disco (perde minhas alterações)</button><button onClick={() => void save(true)}>Sobrescrever mesmo assim</button></div>}
        {asking && <div className="row" data-testid="editor-discard"><span>Descartar as alterações não salvas?</span><button data-testid="editor-discard-yes" onClick={onClose}>Descartar</button><button onClick={() => setAsking(false)}>Continuar editando</button></div>}
        <div className="actions">
          {onOpenNote && /\.(md|markdown|txt)$/i.test(path) && <button onClick={() => onOpenNote(path)}>Abrir como nota</button>}
          {editable && <button className="pri" data-testid="editor-save" disabled={!dirty} onClick={() => void save()} title="Ctrl+S">Salvar</button>}
          <button data-testid="editor-close" onClick={tryClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
}
