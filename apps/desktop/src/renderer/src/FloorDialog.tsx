import { useEffect, useState } from "react";
import type { FloorCopyInfo, FloorCopyMode, PutFloorHooks, Workspace } from "@messai/contracts";
import type { Api } from "./api.js";

const slug = (n: string) => n.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
export type FloorInput = { name: string; branch?: string; newBranch?: boolean; base?: string; floorType?: "worktree" | "copy" | "none"; copyMode?: FloorCopyMode; excludeDirs?: string[]; cloneLayout?: boolean; hooks?: PutFloorHooks };

/** Diálogo "Novo andar" (estilo Maestri): nome + clonar layout. Isolamento (worktree / cópia isolada CoW / sem isolamento) e hooks ficam em "Avançado". */
export function FloorDialog({ ground, api, onSubmit, onClose }: { ground: Workspace; api?: Api; onSubmit: (i: FloorInput) => void; onClose: () => void }) {
  const [name, setName] = useState("");
  const [clone, setClone] = useState(false);
  const [adv, setAdv] = useState(false);
  const [type, setType] = useState<"worktree" | "copy" | "none">("none");
  const [copyMode, setCopyMode] = useState<FloorCopyMode>("auto");
  const [excludesText, setExcludesText] = useState("node_modules, target, dist, build, .next, .venv");
  const [copyInfo, setCopyInfo] = useState<FloorCopyInfo | null>(null);
  const [branch, setBranch] = useState(""); const [touched, setTouched] = useState(false);
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [base, setBase] = useState("");
  const [setupCmd, setSetupCmd] = useState("");
  const [runCmd, setRunCmd] = useState("");
  const [teardownCmd, setTeardownCmd] = useState("");
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  useEffect(() => {
    if (!api) return;
    let alive = true;
    void api.floorCopyInfo(ground.workspaceId).then((info) => {
      if (!alive) return;
      setCopyInfo(info);
      setExcludesText(info.excludeDirs.join(", "));
    }).catch(() => {});
    return () => { alive = false; };
  }, [api, ground.workspaceId]);
  const effBranch = touched ? branch : slug(name);
  const ok = name.trim().length > 0 && (type === "none" || effBranch.length > 0);
  const hasHooks = Boolean(setupCmd.trim() || runCmd.trim() || teardownCmd.trim());
  const excludeList = excludesText.split(",").map((x) => x.trim()).filter(Boolean);
  const toggleExclude = (dir: string) => {
    const next = excludeList.includes(dir) ? excludeList.filter((d) => d !== dir) : [...excludeList, dir];
    setExcludesText(next.join(", "));
  };
  const submit = () => ok && onSubmit({
    name: name.trim(), floorType: type, cloneLayout: clone,
    ...(type === "worktree" ? { branch: effBranch, newBranch: mode === "new", ...(mode === "new" && base.trim() ? { base: base.trim() } : {}) } : {}),
    ...(type === "copy" ? { branch: effBranch, copyMode, excludeDirs: excludeList } : {}),
    ...(hasHooks ? { hooks: { ...(setupCmd.trim() ? { setup: setupCmd } : {}), ...(runCmd.trim() ? { run: runCmd } : {}), ...(teardownCmd.trim() ? { teardown: teardownCmd } : {}) } } : {}),
  });
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal floor-modal" data-testid="floor-dialog" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") submit(); }}>
        <h2 className="left">Novo andar</h2>
        <p className="dlg-desc">Crie um andar para trabalhar num ambiente isolado, ou para organizar frentes diferentes neste espaço.</p>
        <div className="form">
          <div className="lbl">Nome do andar</div>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do andar" autoFocus data-testid="floor-name" />
          <label className="switch-row"><span>Clonar layout do térreo</span><button type="button" role="switch" aria-checked={clone} className={`switch ${clone ? "on" : ""}`} onClick={() => setClone((v) => !v)}><span className="knob" /></button></label>
          <button type="button" className="adv-toggle" data-testid="floor-adv-toggle" onClick={() => setAdv((v) => !v)}>{adv ? "▾" : "▸"} Avançado — isolamento git</button>
          {adv && (<>
            <div className="lbl">Isolamento</div>
            <div className="tabs">
              <button type="button" className={type === "none" ? "on" : ""} onClick={() => setType("none")}>Sem isolamento</button>
              <button type="button" className={type === "worktree" ? "on" : ""} onClick={() => setType("worktree")}>Worktree git</button>
              <button type="button" className={type === "copy" ? "on" : ""} data-testid="floor-type-copy" onClick={() => setType("copy")}>Cópia isolada</button>
            </div>
            {type === "worktree" ? (<>
              <div className="row">
                <select value={mode} onChange={(e) => setMode(e.target.value as "new" | "existing")} style={{ width: 160 }}><option value="new">Branch nova</option><option value="existing">Branch existente</option></select>
                <input value={effBranch} onChange={(e) => { setTouched(true); setBranch(e.target.value); }} placeholder="nome-da-branch" data-testid="floor-branch" />
              </div>
              {mode === "new" && <label>Base <input value={base} onChange={(e) => setBase(e.target.value)} placeholder="(branch atual do térreo)" /></label>}
              <div className="mut">Cria um worktree em <code>~/.messai/floors/…</code> com a branch; o térreo continua intocado. Pousar faz merge local.</div>
            </>) : type === "copy" ? (<>
              <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
                <span className="badge" data-testid="floor-cow-badge">
                  {copyInfo?.cowSupported ? "CoW suportado (clone instantâneo)" : "Cópia independente (.git próprio)"}
                </span>
                <select value={copyMode} onChange={(e) => setCopyMode(e.target.value as FloorCopyMode)} data-testid="floor-copy-mode" style={{ width: 200 }}>
                  <option value="auto">Automático (CoW se disponível)</option>
                  <option value="independent">Cópia independente</option>
                  {copyInfo?.cowSupported && <option value="cow">Forçar CoW (reflink)</option>}
                </select>
              </div>
              <label>Pastas excluídas (separadas por vírgula)
                <input value={excludesText} onChange={(e) => setExcludesText(e.target.value)} placeholder="node_modules, target, dist" data-testid="floor-excludes" />
              </label>
              {copyInfo && copyInfo.presentDirs.length > 0 && (
                <div className="row" style={{ flexWrap: "wrap", gap: 4 }}>
                  <span className="mut" style={{ fontSize: 11 }}>No projeto:</span>
                  {copyInfo.presentDirs.map((d) => (
                    <button key={d} type="button" className={`tb ${excludeList.includes(d) ? "on" : ""}`} data-testid={`floor-excl-chip-${d}`} onClick={() => toggleExclude(d)} style={{ fontSize: 11 }}>
                      {excludeList.includes(d) ? `✕ ${d}` : `+ ${d}`}
                    </button>
                  ))}
                </div>
              )}
              <div className="mut">Clona o projeto para <code>~/.messai/floors/…</code> com <code>.git</code> próprio, pulando pastas excluídas.</div>
            </>) : <div className="mut">O andar usa o mesmo diretório do térreo: separa o canvas sem separar o código.</div>}
            <div className="lbl">Hooks do andar (opcional)</div>
            <label>Setup (ao criar) <input value={setupCmd} onChange={(e) => setSetupCmd(e.target.value)} placeholder="ex.: npm ci" data-testid="floor-hook-setup" /></label>
            <label>Run (sob demanda) <input value={runCmd} onChange={(e) => setRunCmd(e.target.value)} placeholder="ex.: npm run dev" data-testid="floor-hook-run" /></label>
            <label>Teardown (ao remover) <input value={teardownCmd} onChange={(e) => setTeardownCmd(e.target.value)} placeholder="ex.: docker compose down" data-testid="floor-hook-teardown" /></label>
          </>)}
        </div>
        <div className="actions right"><button type="button" onClick={onClose}>Cancelar</button><button type="button" className="pri" disabled={!ok} onClick={submit} data-testid="floor-submit">Criar</button></div>
      </div>
    </div>
  );
}
