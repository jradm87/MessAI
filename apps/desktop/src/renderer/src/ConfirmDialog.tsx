import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";

/** Confirmação padronizada antes de ações destrutivas (apagar nó, espaço, pasta…). Enter confirma, Esc cancela. */
export type ConfirmReq = { title: string; body?: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean };
export function ConfirmDialog({ req, onResolve }: { req: ConfirmReq; onResolve: (ok: boolean) => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onResolve(false); }
      else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); onResolve(true); }
    };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, [onResolve]);
  return (
    <div className="modal-backdrop" onMouseDown={() => onResolve(false)}>
      <div className="modal confirm-modal" data-testid="confirm-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <h2 className="left">{req.danger && <AlertTriangle size={16} className="confirm-ic" />}{req.title}</h2>
        {req.body && <div className="mut hint">{req.body}</div>}
        <div className="actions">
          <button onClick={() => onResolve(false)} data-testid="confirm-cancel">{req.cancelLabel ?? "Cancelar"}</button>
          <button className={req.danger ? "danger" : "pri"} autoFocus onClick={() => onResolve(true)} data-testid="confirm-ok">{req.confirmLabel ?? "Confirmar"}</button>
        </div>
      </div>
    </div>
  );
}
