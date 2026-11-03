import { useEffect, useState } from "react";
import { Check, ShieldAlert, X } from "lucide-react";
import type { Approval } from "@messai/contracts";
import type { Api } from "./api.js";

const CAP_LABEL: Record<string, string> = {
  "files:read": "ler arquivos do espaço", "files:write": "gravar arquivos do espaço", "chat:post": "postar no chat", "nodes:read": "ver os nós do espaço",
  "nodes:write": "criar/alterar notas, conexões e grupos", "messages:send": "enviar mensagens a outros agentes", "workspace:manage": "gerenciar o espaço (andares, hooks, rotinas…)",
  "terminal:control": "controlar outros terminais (digitar neles)", "maestro:conduct": "conduzir agentes (Maestro)",
};

/** #93 — Pedidos de permissão de agentes ISOLADOS: o agente pede (`mess request`), só o app decide. Aprovar vale já, sem reiniciar o terminal. */
export function ApprovalsDialog({ api, onClose, onChanged }: { api: Api; onClose: () => void; onChanged?: () => void }) {
  const [items, setItems] = useState<Approval[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const load = () => { void api.approvals().then((a) => setItems([...a].sort((x, y) => (x.status === "pending" ? 0 : 1) - (y.status === "pending" ? 0 : 1) || y.createdAt.localeCompare(x.createdAt)))).catch(() => {}); };
  useEffect(() => { load(); const t = setInterval(load, 2000); return () => clearInterval(t); }, [api]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }; window.addEventListener("keydown", k, true); return () => window.removeEventListener("keydown", k, true); }, [onClose]);
  const decide = async (a: Approval, approve: boolean) => { setErr(null); try { await api.decideApproval(a.approvalId, approve); load(); onChanged?.(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } };
  const pending = items.filter((a) => a.status === "pending");
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" data-testid="approvals-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <h2><ShieldAlert size={16} /> Pedidos de permissão {pending.length > 0 && <span className="att-badge">{pending.length}</span>}</h2>
        <p className="mut">Terminais em modo isolado não têm estas capacidades por padrão. Aprovar vale na hora e fica salvo para o terminal; negar não concede nada.</p>
        {err && <div className="err">{err}</div>}
        {items.length === 0 && <div className="mut" data-testid="approvals-empty">Nenhum pedido.</div>}
        <div className="approvals-list">
          {items.map((a) => (
            <div key={a.approvalId} className={`approval ${a.status}`} data-testid="approval-item">
              <div><b>{a.nodeTitle}</b> pede <code>{a.capability}</code> <span className="mut">— {CAP_LABEL[a.capability] ?? a.capability}</span></div>
              {a.reason && <div className="mut">“{a.reason}”</div>}
              {a.status === "pending"
                ? <div className="row"><button className="pri" data-testid="approval-approve" onClick={() => void decide(a, true)}><Check size={12} /> Aprovar</button><button data-testid="approval-deny" onClick={() => void decide(a, false)}><X size={12} /> Negar</button></div>
                : <div className="mut">{a.status === "approved" ? "aprovado" : "negado"}{a.decidedAt ? ` · ${new Date(a.decidedAt).toLocaleString()}` : ""}</div>}
            </div>
          ))}
        </div>
        <div className="actions"><button onClick={onClose}>Fechar</button></div>
      </div>
    </div>
  );
}
