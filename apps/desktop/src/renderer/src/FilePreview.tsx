import { useEffect, useState } from "react";
import type { FileContent } from "@messyai/contracts";
import type { Api } from "./api.js";

/** Prévia simples de arquivo (texto com rolagem; binário avisa). Editor embutido vem depois. */
export function FilePreview({ api, workspaceId, path, onClose, onOpenNote }: { api: Api; workspaceId: string; path: string; onClose: () => void; onOpenNote?: (p: string) => void }) {
  const [f, setF] = useState<FileContent | null>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { void api.file(workspaceId, path).then(setF).catch((e) => setErr(String(e))); }, [api, workspaceId, path]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal preview-modal" data-testid="file-preview" onMouseDown={(e) => e.stopPropagation()}>
        <h2 title={path}>{path}</h2>
        {err && <div className="err">{err}</div>}
        {f && (f.binary ? <div className="mut">Arquivo binário ({f.size} bytes). Prévia de mídia: em breve.</div> : <pre className="preview-text">{f.text}{f.truncated ? "\n… (truncado em 512 KB)" : ""}</pre>)}
        <div className="actions">{onOpenNote && /\.(md|markdown|txt)$/i.test(path) && <button onClick={() => onOpenNote(path)}>Abrir como nota</button>}<button className="pri" onClick={onClose}>Fechar</button></div>
      </div>
    </div>
  );
}
