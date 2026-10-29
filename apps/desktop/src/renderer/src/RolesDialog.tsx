import { useEffect, useState } from "react";
import { Plus, Trash2, FolderSearch, FileDown } from "lucide-react";
import type { Role } from "@messai/contracts";
import type { Api } from "./api.js";

/** Gerenciar responsabilidades: lista, editor (nome, badge, instruções), descobrir no diretório do espaço, exportar role.json. */
export function RolesDialog({ api, workspaceCwd, onClose, onChanged }: { api: Api; workspaceCwd: string; onClose: () => void; onChanged: () => void }) {
  const [roles, setRoles] = useState<Role[]>([]);
  const [sel, setSel] = useState<string | "new" | null>(null);
  const [name, setName] = useState(""); const [badge, setBadge] = useState(""); const [instr, setInstr] = useState("");
  const [msg, setMsg] = useState("");
  const load = () => api.roles().then((r) => { setRoles(r); return r; }).catch(() => []);
  useEffect(() => { void load(); }, []);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const pick = (r: Role | "new") => { if (r === "new") { setSel("new"); setName(""); setBadge(""); setInstr(""); } else { setSel(r.roleId); setName(r.name); setBadge(r.badge); setInstr(r.instructions); } };
  const say = (t: string) => { setMsg(t); setTimeout(() => setMsg(""), 2500); };
  const save = async () => {
    try {
      if (sel === "new") { const r = await api.createRole({ name: name.trim(), instructions: instr, ...(badge.trim() ? { badge: badge.trim() } : {}) }); await load(); pick(r); }
      else if (sel) { await api.patchRole(sel, { name: name.trim(), badge: badge.trim(), instructions: instr }); await load(); }
      onChanged(); say("salvo");
    } catch (e) { say(String(e)); }
  };
  const del = async () => { if (sel && sel !== "new" && confirm("Apagar este papel? Terminais que o usam ficam sem papel.")) { await api.deleteRole(sel); setSel(null); await load(); onChanged(); } };
  const discover = async () => { try { const r = await api.discoverRoles(workspaceCwd); await load(); onChanged(); say(r.imported.length ? `${r.imported.length} papel(is) importado(s) de ${workspaceCwd}` : "nenhum role.json em .messai/roles ou .maestri/roles"); } catch (e) { say(String(e)); } };
  const exp = async () => { if (sel && sel !== "new") { try { const r = await api.exportRole(sel, workspaceCwd); say(`gravado em ${r.path}`); } catch (e) { say(String(e)); } } };
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal roles-modal" data-testid="roles-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Responsabilidades</h2>
        <div className="roles-body">
          <div className="roles-list">
            {roles.map((r) => <div key={r.roleId} className={`mi ${sel === r.roleId ? "on" : ""}`} onClick={() => pick(r)}><span className="role-badge">{r.badge || r.name.slice(0, 2).toUpperCase()}</span><span className="nm">{r.name}</span></div>)}
            <div className={`mi ${sel === "new" ? "on" : ""}`} onClick={() => pick("new")} data-testid="role-new"><Plus size={14} /> Novo papel</div>
            <div className="sp" />
            <button onClick={() => void discover()} title={`Procura role.json em ${workspaceCwd}/.messai/roles e .maestri/roles`}><FolderSearch size={14} /> Descobrir no diretório</button>
          </div>
          <div className="roles-edit">
            {sel ? (<>
              <div className="row"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome (ex.: Revisor de código)" data-testid="role-name" autoFocus /><input className="badge-in" value={badge} onChange={(e) => setBadge(e.target.value.slice(0, 4))} placeholder="Badge" title="até 4 caracteres" /></div>
              <textarea className="role-instr" value={instr} onChange={(e) => setInstr(e.target.value)} placeholder="Instruções injetadas na partida do agente (Markdown livre)…" data-testid="role-instr" />
              <div className="actions left">
                <button className="pri" disabled={!name.trim()} onClick={() => void save()} data-testid="role-save">{sel === "new" ? "Criar" : "Salvar"}</button>
                {sel !== "new" && <><button onClick={() => void exp()} title="Grava .messai/roles/<slug>/role.json no diretório do espaço"><FileDown size={14} /> Exportar</button><button className="danger" onClick={() => void del()}><Trash2 size={14} /> Apagar</button></>}
                <span className="mut">{msg}</span>
              </div>
            </>) : <div className="mut empty-roles">Selecione um papel ou crie um novo. As instruções entram no system prompt do Claude Code e nas variáveis <code>MESS_ROLE</code> / <code>MESS_ROLE_INSTRUCTIONS</code> de qualquer CLI.</div>}
          </div>
        </div>
        <div className="actions"><button onClick={onClose}>Fechar</button></div>
      </div>
    </div>
  );
}
