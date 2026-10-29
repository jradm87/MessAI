import { useEffect, useState } from "react";
import type { Folder, Workspace } from "@messyai/contracts";
import { WS_COLORS, WS_ICONS } from "./wsicons.js";

export type WorkspaceInput = { name: string; cwd: string; icon: string; color: string; folderId?: string };

/** Diálogo "New Workspace" (criar e editar): nome, grade de ícones, cores, diretório com Procurar… */
export function WorkspaceDialog({ edit, folders, defaultFolderId, defaultCwd = "", onSubmit, onClose }: { edit?: Workspace; folders: Folder[]; defaultFolderId?: string; defaultCwd?: string; onSubmit: (i: WorkspaceInput) => void; onClose: () => void }) {
  const [name, setName] = useState(edit?.name ?? "");
  const [cwd, setCwd] = useState(edit?.cwd ?? defaultCwd);
  const [icon, setIcon] = useState(edit?.icon ?? "folder");
  const [color, setColor] = useState<string>(edit?.color ?? WS_COLORS[0]);
  const [folderId, setFolderId] = useState<string>(edit?.folderId ?? defaultFolderId ?? "");
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const ok = name.trim().length > 0;
  const submit = () => { if (ok) onSubmit({ name: name.trim(), cwd: cwd.trim() || defaultCwd, icon, color, ...(folderId ? { folderId } : {}) }); };
  const Sel = WS_ICONS[icon] ?? WS_ICONS.folder!;
  const onlyFolders = folders.filter((f) => f.kind === "folder");
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal ws-modal" data-testid="ws-dialog" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") submit(); }}>
        <h2>{edit ? "Editar espaço" : "Novo espaço"}</h2>
        <div className="ws-head">
          <span className="ws-ic big" style={{ background: color }}><Sel size={28} color="#0b0e14" strokeWidth={2.2} /></span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do espaço" autoFocus data-testid="ws-name" />
        </div>
        <div className="lbl">Ícone</div>
        <div className="icon-grid">
          {Object.entries(WS_ICONS).map(([k, I]) => <button key={k} type="button" className={`ig ${icon === k ? "on" : ""}`} title={k} onClick={() => setIcon(k)}><I size={18} /></button>)}
        </div>
        <div className="lbl">Cor</div>
        <div className="color-row">
          {WS_COLORS.map((c) => <button key={c} type="button" className={`sw lg ${color === c ? "on" : ""}`} style={{ background: c }} title={c} onClick={() => setColor(c)} />)}
        </div>
        <div className="lbl">Diretório de trabalho</div>
        <div className="row"><input value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder={defaultCwd || "/caminho/do/projeto"} data-testid="ws-cwd" /><button type="button" onClick={() => void window.messyai.pickDirectory?.().then((d) => d && setCwd(d))}>Procurar…</button></div>
        {onlyFolders.length > 0 && (
          <><div className="lbl">Pasta</div>
            <select value={folderId} onChange={(e) => setFolderId(e.target.value)}>
              <option value="">(sem pasta)</option>
              {onlyFolders.map((f) => <option key={f.folderId} value={f.folderId}>{f.name}</option>)}
            </select></>
        )}
        <div className="actions"><button type="button" onClick={onClose}>Cancelar</button><button type="button" className="pri" disabled={!ok} onClick={submit} data-testid="ws-submit">{edit ? "Salvar" : "Criar"}</button></div>
      </div>
    </div>
  );
}
