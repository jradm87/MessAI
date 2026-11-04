import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, GitBranch, GitCommitHorizontal, GitMerge, RefreshCw } from "lucide-react";
import type { GitCommitEntry, GitInfo, GitOpResult } from "@messai/contracts";
import type { Api } from "./api.js";
import { DiffView } from "./FilePreview.js";

const CODE_TITLE: Record<string, string> = { M: "modificado", A: "adicionado", D: "apagado", R: "renomeado", "?": "novo (não rastreado)", U: "em conflito" };

/** #30 — Git do espaço: branch atual/trocar/criar, pull (só avanço)/push, merge (com abort), arquivos alterados com diff, commit e histórico. */
export function GitPanel({ api, workspaceId, onClose, onOpenFile, onChanged }: { api: Api; workspaceId: string; onClose: () => void; onOpenFile?: (p: string) => void; onChanged?: () => void }) {
  const [info, setInfo] = useState<GitInfo | null>(null); const [log, setLog] = useState<GitCommitEntry[]>([]);
  const [checked, setChecked] = useState<Record<string, boolean>>({}); const [sel, setSel] = useState<string | null>(null); const [diff, setDiff] = useState<string | null>(null);
  const [message, setMessage] = useState(""); const [newBranch, setNewBranch] = useState(""); const [mergeFrom, setMergeFrom] = useState("");
  const [busy, setBusy] = useState(false); const [res, setRes] = useState<(GitOpResult & { what: string }) | null>(null);
  const load = async () => {
    const i = await api.gitInfo(workspaceId).catch(() => null); setInfo(i);
    if (i?.isRepo) { setLog(await api.gitLog(workspaceId, 30).catch(() => [])); setChecked((c) => { const n: Record<string, boolean> = {}; for (const f of i.files) n[f.path] = c[f.path] ?? true; return n; }); }
  };
  useEffect(() => { void load(); }, [workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !(e.target as HTMLElement | null)?.closest?.("textarea,input,select")) { e.stopPropagation(); onClose(); } }; window.addEventListener("keydown", k, true); return () => window.removeEventListener("keydown", k, true); }, [onClose]);
  useEffect(() => { setDiff(null); if (sel) void api.gitDiff(workspaceId, sel).then((d) => setDiff(d.text)).catch((e) => setDiff(`(erro: ${e instanceof Error ? e.message : String(e)})`)); }, [sel, api, workspaceId, info]);
  const run = async (what: string, fn: () => Promise<GitOpResult>) => {
    setBusy(true);
    try { const r = await fn(); setRes({ ...r, what }); await load(); onChanged?.(); return r; }
    catch (e) { setRes({ ok: false, output: e instanceof Error ? e.message : String(e), what }); return null; }
    finally { setBusy(false); }
  };
  const localBranches = useMemo(() => (info?.branches ?? []).filter((b) => !b.remote), [info]);
  const others = localBranches.filter((b) => !b.current);
  const picked = (info?.files ?? []).filter((f) => checked[f.path]);
  const commit = async () => {
    if (!info) return;
    // durante um merge o git recusa commit parcial: commita tudo
    const r = await run("commit", () => api.gitCommit(workspaceId, { message: message.trim(), ...(!info.merging && picked.length !== info.files.length ? { paths: picked.map((f) => f.path) } : {}) }));
    if (r?.ok) setMessage("");
  };
  const noUpstream = !!info?.isRepo && !info.upstream;
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal git-modal" data-testid="git-panel" onMouseDown={(e) => e.stopPropagation()}>
        <h2><GitBranch size={15} /> Git do espaço <button className="ib" title="Atualizar" data-testid="git-refresh" onClick={() => void load()}><RefreshCw size={13} /></button></h2>
        {info === null && <div className="mut">Carregando…</div>}
        {info && !info.isRepo && <div className="mut" data-testid="git-norepo">Esta pasta não é um repositório git (rode <code>git init</code> no terminal).</div>}
        {info?.isRepo && <>
          <div className="git-head">
            <label>Branch <select data-testid="git-branch-select" value={info.branch ?? ""} disabled={busy} onChange={(e) => void run("checkout", () => api.gitCheckout(workspaceId, e.target.value))}>
              {info.detached && <option value="">(HEAD solto)</option>}
              {localBranches.map((b) => <option key={b.name} value={b.name}>{b.name}</option>)}
            </select></label>
            {info.upstream && <span className="mut" data-testid="git-sync" title={`upstream ${info.upstream}`}><ArrowUp size={11} />{info.ahead} <ArrowDown size={11} />{info.behind}</span>}
            <button data-testid="git-pull" disabled={busy || !info.upstream} title={info.upstream ? "git pull --ff-only (só avanço rápido)" : "sem upstream configurado"} onClick={() => void run("pull", () => api.gitPull(workspaceId))}><ArrowDown size={12} /> Pull</button>
            <button data-testid="git-push" disabled={busy} title={noUpstream ? "git push -u origin <branch>" : "git push"} onClick={() => void run("push", () => api.gitPush(workspaceId, noUpstream))}><ArrowUp size={12} /> Push{noUpstream ? " (definir upstream)" : ""}</button>
          </div>
          <div className="git-head">
            <input data-testid="git-newbranch" placeholder="nova branch (ex.: feature/x)" value={newBranch} onChange={(e) => setNewBranch(e.target.value)} />
            <button data-testid="git-branch-create" disabled={busy || !newBranch.trim()} onClick={async () => { const r = await run("branch", () => api.gitBranch(workspaceId, newBranch.trim())); if (r?.ok) setNewBranch(""); }}>Criar e mudar</button>
            <select data-testid="git-merge-from" value={mergeFrom} onChange={(e) => setMergeFrom(e.target.value)}><option value="">mesclar de…</option>{others.map((b) => <option key={b.name} value={b.name}>{b.name}</option>)}</select>
            <button data-testid="git-merge" disabled={busy || !mergeFrom} onClick={() => void run("merge", () => api.gitMerge(workspaceId, { branch: mergeFrom }))}><GitMerge size={12} /> Mesclar</button>
            {info.merging && <button data-testid="git-merge-abort" disabled={busy} onClick={() => void run("merge --abort", () => api.gitMerge(workspaceId, { abort: true }))}>Abortar merge</button>}
          </div>
          {info.merging && <div className="err" data-testid="git-merging">Merge em andamento{info.files.some((f) => f.code === "U") ? ": resolva os conflitos (arquivos marcados U), edite e faça o commit — ou aborte." : ": faça o commit para concluir ou aborte."}</div>}
          {res && <pre className={`git-out ${res.ok ? "ok" : "bad"}`} data-testid="git-output">{res.ok ? "✓" : "✗"} {res.what}{res.output ? `\n${res.output}` : ""}{res.conflicts?.length ? `\nConflitos: ${res.conflicts.join(", ")}` : ""}</pre>}
          <div className="git-cols">
            <div className="git-files" data-testid="git-files">
              <div className="lbl">Alterações ({info.files.length})</div>
              {info.files.length === 0 && <div className="mut" data-testid="git-clean">Nada para commitar.</div>}
              {info.files.map((f) => (
                <div key={f.path} className={`git-file ${sel === f.path ? "on" : ""}`} data-testid="git-file">
                  <input type="checkbox" checked={!!checked[f.path]} onChange={(e) => setChecked((c) => ({ ...c, [f.path]: e.target.checked }))} />
                  <span className={`gc gc-${f.code}`} title={CODE_TITLE[f.code] ?? f.code}>{f.code}</span>
                  <span className="gp" title={f.path} onClick={() => setSel(f.path)} onDoubleClick={() => onOpenFile?.(f.path)}>{f.path}</span>
                </div>
              ))}
              <textarea data-testid="git-message" placeholder="Mensagem do commit" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
              <button className="pri" data-testid="git-commit" disabled={busy || !message.trim() || picked.length === 0} onClick={() => void commit()}><GitCommitHorizontal size={12} /> Commit ({picked.length})</button>
            </div>
            <div className="git-diffcol">{sel ? (diff === null ? <div className="mut">Carregando…</div> : <DiffView text={diff} />) : <div className="mut">Clique num arquivo para ver o diff; duplo clique abre no editor.</div>}</div>
          </div>
          <div className="lbl">Histórico</div>
          <div className="git-log" data-testid="git-log">{log.length === 0 ? <div className="mut">Sem commits ainda.</div> : log.map((c) => <div key={c.hash} className="git-log-row" title={c.hash}><code>{c.short}</code> <span>{c.subject}</span> <span className="mut">{c.author} · {new Date(c.date).toLocaleString()}</span></div>)}</div>
        </>}
        <div className="actions"><button onClick={onClose}>Fechar</button></div>
      </div>
    </div>
  );
}
