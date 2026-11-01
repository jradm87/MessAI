import { useEffect, useState } from "react";
import { AlertTriangle, Archive, FolderOpen, FolderInput, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import type { Api, DataInfo } from "./api.js";

/** #62 — Preferências → Dados: armazenamento (local, uso, mudar, abrir), backups (criar/restaurar/apagar), portais (futuro), reset. */
export const fmtBytes = (n: number): string => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${(n / 1e3).toFixed(0)} kB` : `${n} B`);
const SOURCE: Record<DataInfo["source"], string> = { env: "definida por MESS_DATA_DIR", pointer: "escolhida em Preferências (~/.messai/datadir)", default: "padrão" };

export function PrefsData({ api }: { api: Api }) {
  const [info, setInfo] = useState<DataInfo | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<string | null>(null); // texto da operação em andamento (tela de bloqueio)
  const [confirmRestore, setConfirmRestore] = useState<{ path: string; typed: string } | null>(null);
  const [resetTyped, setResetTyped] = useState("");
  const [moveTarget, setMoveTarget] = useState<{ dir: string; typed: string } | null>(null);
  const load = () => api.dataInfo().then((d) => { setInfo(d); setErr(""); }).catch((e) => setErr(String(e)));
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const fail = (e: unknown) => { setErr(e instanceof Error ? e.message : String(e)); setBusy(null); };
  /** Operações que derrubam o runtime: pede ao processo principal para subir outro e recarrega a janela. */
  const restartAndReload = async (label: string) => {
    setBusy(`${label} — reiniciando o runtime…`);
    const ok = await window.messai.runtimeRestart?.().catch(() => false);
    if (ok === false) { setErr("O runtime não voltou sozinho. Feche e abra o MessAI."); setBusy(null); return; }
    location.reload();
  };
  const backup = async (dir?: string) => { setBusy("Criando backup…"); try { await api.createBackup(dir); await load(); } catch (e) { fail(e); return; } setBusy(null); };
  const backupTo = async () => { const d = await window.messai.pickDirectory?.(); if (d) await backup(d); };
  const del = async (name: string) => { if (!confirm(`Apagar o backup ${name}?`)) return; try { await api.deleteBackup(name); await load(); } catch (e) { fail(e); } };
  const restore = async () => { if (!confirmRestore || confirmRestore.typed !== "RESTAURAR") return; try { await api.restoreData(confirmRestore.path); } catch (e) { fail(e); return; } setConfirmRestore(null); await restartAndReload("Restaurando"); };
  const restoreFrom = async () => { const d = await window.messai.pickDirectory?.(); if (d) setConfirmRestore({ path: d, typed: "" }); };
  const pickMove = async () => { const d = await window.messai.pickDirectory?.(); if (d) setMoveTarget({ dir: d, typed: "" }); };
  const move = async () => { if (!moveTarget || moveTarget.typed !== "MOVER") return; try { await api.moveData(moveTarget.dir); } catch (e) { fail(e); return; } setMoveTarget(null); await restartAndReload("Movendo os dados"); };
  const reset = async () => { if (resetTyped !== "APAGAR") return; if (!confirm("Última chance: apagar TODOS os espaços, terminais, notas, chats, papéis, skills e presets? Backups, provedores extras e a identidade desta máquina ficam.")) return; try { await api.resetData(); } catch (e) { fail(e); return; } await restartAndReload("Apagando os dados"); };
  const open = (p: string) => void window.messai.openPath?.(p).then((r) => { if (r) setErr(r); });

  return (<>
    {busy && <div className="pf-busy" data-testid="data-busy"><RefreshCw size={16} className="spin" /> {busy}</div>}
    {err && <div className="err">{err}</div>}
    <section className="pf-section">
      <h3>Armazenamento</h3>
      <div className="pf-field"><div className="pf-lbl"><span>Local</span><small className="mono" data-testid="data-dir">{info?.dir ?? "…"}</small><small>{info ? SOURCE[info.source] : ""}</small></div>
        <div className="pf-ctl">
          <button onClick={() => info && open(info.dir)} disabled={!info}><FolderOpen size={14} /> Abrir pasta</button>
          <button onClick={() => void pickMove()} disabled={!info || info.source === "env"} title={info?.source === "env" ? "A pasta vem da variável MESS_DATA_DIR; mude a variável." : "Copia os dados para uma pasta vazia e passa a usá-la (a antiga fica)"} data-testid="data-move"><FolderInput size={14} /> Mudar…</button>
        </div></div>
      {moveTarget && <div className="pf-confirm" data-testid="move-confirm">
        <div>Mover os dados para <code>{moveTarget.dir}</code>? O MessAI copia tudo (menos backups), reinicia e passa a usar a nova pasta; a antiga é mantida. Digite <b>MOVER</b> para confirmar.</div>
        <div className="row"><input value={moveTarget.typed} onChange={(e) => setMoveTarget({ ...moveTarget, typed: e.target.value })} placeholder="MOVER" /><button className="pri" disabled={moveTarget.typed !== "MOVER"} onClick={() => void move()}>Mover e reiniciar</button><button onClick={() => setMoveTarget(null)}>Cancelar</button></div>
      </div>}
      <div className="pf-field"><div className="pf-lbl"><span>Uso</span><small data-testid="data-usage">{info ? `${fmtBytes(info.bytes)} no total · banco ${fmtBytes(info.dbBytes)} · notas ${fmtBytes(info.notesBytes)} · backups ${fmtBytes(info.backupsBytes)}` : "…"}</small><small>{info ? `${info.counts.workspaces} espaço(s) · ${info.counts.nodes} nó(s) · ${info.counts.notes} nota(s) · ${info.counts.sessions} sessão(ões)` : ""}</small></div>
        <div className="pf-ctl"><button className="tb" title="Atualizar" onClick={() => void load()}><RefreshCw size={14} /></button></div></div>
    </section>

    <section className="pf-section">
      <h3>Backups</h3>
      <div className="mut hint">Um backup é uma pasta com uma cópia consistente do banco (espaços, nós, sessões, chats, papéis, skills, presets, configurações), as notas, os provedores extras e um manifesto. Tokens não entram.</div>
      <div className="row">
        <button className="pri" onClick={() => void backup()} disabled={!!busy} data-testid="backup-create"><Archive size={14} /> Criar backup</button>
        <button onClick={() => void backupTo()} disabled={!!busy}><Archive size={14} /> Criar em outra pasta…</button>
        <button onClick={() => void restoreFrom()} disabled={!!busy} data-testid="restore-from"><RotateCcw size={14} /> Restaurar de uma pasta…</button>
        {info && <button onClick={() => open(info.backupsDir)}><FolderOpen size={14} /> Abrir pasta de backups</button>}
      </div>
      <div className="pt-list" data-testid="backup-list">
        {info?.backups.map((b) => (
          <div key={b.name} className="pt-row" data-testid="backup-row">
            <Archive size={16} />
            <span className="pt-name"><span>{b.manifest ? new Date(b.manifest.createdAt).toLocaleString() : b.name}</span><small>{fmtBytes(b.bytes)}{b.manifest ? ` · ${b.manifest.counts.workspaces} espaço(s), ${b.manifest.counts.nodes} nó(s), ${b.manifest.counts.notes} nota(s) · build ${b.manifest.buildVersion}` : " · sem manifesto (incompleto?)"}</small></span>
            <button onClick={() => setConfirmRestore({ path: b.path, typed: "" })} disabled={!b.manifest || !!busy} data-testid={`backup-restore-${b.name}`}><RotateCcw size={14} /> Restaurar</button>
            <button className="tb danger" title="Apagar backup" onClick={() => void del(b.name)}><Trash2 size={14} /></button>
          </div>
        ))}
        {info && info.backups.length === 0 && <div className="mut">Nenhum backup ainda.</div>}
      </div>
      {confirmRestore && <div className="pf-confirm" data-testid="restore-confirm">
        <div><AlertTriangle size={14} /> Restaurar substitui <b>todos</b> os dados atuais pelos de <code>{confirmRestore.path}</code> e <b>encerra os terminais abertos</b>. Faça um backup do estado atual antes, se precisar. Digite <b>RESTAURAR</b> para confirmar.</div>
        <div className="row"><input value={confirmRestore.typed} onChange={(e) => setConfirmRestore({ ...confirmRestore, typed: e.target.value })} placeholder="RESTAURAR" data-testid="restore-typed" /><button className="pri" disabled={confirmRestore.typed !== "RESTAURAR"} onClick={() => void restore()} data-testid="restore-go">Restaurar e reiniciar</button><button onClick={() => setConfirmRestore(null)}>Cancelar</button></div>
      </div>}
    </section>

    <section className="pf-section">
      <h3>Armazenamento dos portais</h3>
      <div className="pf-soon">Portais (webviews no canvas) ainda não existem — chegam com a issue <b>#26</b>; o armazenamento deles aparece aqui quando houver.</div>
    </section>

    <section className="pf-section">
      <h3>Reset</h3>
      <div className="pf-field danger-field"><div className="pf-lbl"><span>Apagar todos os dados</span><small>Remove espaços, terminais (encerra os agentes), notas, chats, papéis, skills, presets e configurações do runtime. <b>Mantém</b> backups, provedores extras e a identidade/token desta máquina. Digite <b>APAGAR</b> para liberar o botão.</small></div>
        <div className="pf-ctl"><input value={resetTyped} onChange={(e) => setResetTyped(e.target.value)} placeholder="APAGAR" className="pt-input" data-testid="reset-typed" /><button className="danger" disabled={resetTyped !== "APAGAR" || !!busy} onClick={() => void reset()} data-testid="reset-go"><Trash2 size={14} /> Apagar tudo</button></div></div>
    </section>
  </>);
}
