import { useEffect, useState } from "react";
import type { Workspace } from "@messai/contracts";

const slug = (n: string) => n.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
export type FloorInput = { name: string; branch?: string; newBranch?: boolean; base?: string; floorType?: "worktree" | "none"; cloneLayout?: boolean };

/** Diálogo "Novo andar" (estilo Maestri): nome + clonar layout. Isolamento git (worktree/branch) fica em "Avançado". */
export function FloorDialog({ ground, onSubmit, onClose }: { ground: Workspace; onSubmit: (i: FloorInput) => void; onClose: () => void }) {
  const [name, setName] = useState("");
  const [clone, setClone] = useState(false);
  const [adv, setAdv] = useState(false);
  const [type, setType] = useState<"worktree" | "none">("none");
  const [branch, setBranch] = useState(""); const [touched, setTouched] = useState(false);
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [base, setBase] = useState("");
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const effBranch = touched ? branch : slug(name);
  const ok = name.trim().length > 0 && (type === "none" || effBranch.length > 0);
  const submit = () => ok && onSubmit({ name: name.trim(), floorType: type, cloneLayout: clone, ...(type === "worktree" ? { branch: effBranch, newBranch: mode === "new", ...(mode === "new" && base.trim() ? { base: base.trim() } : {}) } : {}) });
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal floor-modal" data-testid="floor-dialog" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") submit(); }}>
        <h2 className="left">Novo andar</h2>
        <p className="dlg-desc">Crie um andar para trabalhar num ambiente isolado, ou para organizar frentes diferentes neste espaço.</p>
        <div className="form">
          <div className="lbl">Nome do andar</div>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do andar" autoFocus data-testid="floor-name" />
          <label className="switch-row"><span>Clonar layout do térreo</span><button type="button" role="switch" aria-checked={clone} className={`switch ${clone ? "on" : ""}`} onClick={() => setClone((v) => !v)}><span className="knob" /></button></label>
          <button type="button" className="adv-toggle" onClick={() => setAdv((v) => !v)}>{adv ? "▾" : "▸"} Avançado — isolamento git</button>
          {adv && (<>
            <div className="lbl">Isolamento</div>
            <div className="tabs">
              <button type="button" className={type === "none" ? "on" : ""} onClick={() => setType("none")}>Sem isolamento</button>
              <button type="button" className={type === "worktree" ? "on" : ""} onClick={() => setType("worktree")}>Worktree git</button>
            </div>
            {type === "worktree" ? (<>
              <div className="row">
                <select value={mode} onChange={(e) => setMode(e.target.value as "new" | "existing")} style={{ width: 160 }}><option value="new">Branch nova</option><option value="existing">Branch existente</option></select>
                <input value={effBranch} onChange={(e) => { setTouched(true); setBranch(e.target.value); }} placeholder="nome-da-branch" data-testid="floor-branch" />
              </div>
              {mode === "new" && <label>Base <input value={base} onChange={(e) => setBase(e.target.value)} placeholder="(branch atual do térreo)" /></label>}
              <div className="mut">Cria um worktree em <code>~/.messai/floors/…</code> com a branch; o térreo continua intocado. Pousar faz merge local.</div>
            </>) : <div className="mut">O andar usa o mesmo diretório do térreo: separa o canvas sem separar o código.</div>}
          </>)}
        </div>
        <div className="actions right"><button type="button" onClick={onClose}>Cancelar</button><button type="button" className="pri" disabled={!ok} onClick={submit} data-testid="floor-submit">Criar</button></div>
      </div>
    </div>
  );
}
