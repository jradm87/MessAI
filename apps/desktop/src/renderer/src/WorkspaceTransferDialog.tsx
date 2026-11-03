import { useEffect, useState } from "react";
import { Download, Upload, X, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { Workspace, WorkspaceBundle, WorkspaceBundlePreview } from "@messai/contracts";
import { slugify } from "@messai/domain";
import type { Api } from "./api.js";

export type WorkspaceTransferProps = {
  api: Api;
  mode: "export" | "import";
  workspace?: Workspace;
  onImported?: (w: Workspace) => void;
  onClose: () => void;
};

/** #83 — Diálogo para exportar um espaço (.messai) ou importar um arquivo .messai com tela de revisão. */
export function WorkspaceTransferDialog({ api, mode, workspace, onImported, onClose }: WorkspaceTransferProps) {
  const [bundle, setBundle] = useState<WorkspaceBundle | null>(null);
  const [rawJson, setRawJson] = useState("");
  const [preview, setPreview] = useState<WorkspaceBundlePreview | null>(null);
  const [name, setName] = useState("");
  const [cwd, setCwd] = useState("");
  const [includeEnv, setIncludeEnv] = useState(true);
  const [err, setErr] = useState("");
  const [savedMsg, setSavedMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  useEffect(() => {
    if (mode === "export" && workspace) {
      setBusy(true);
      api.exportWorkspace(workspace.workspaceId)
        .then((b) => {
          setBundle(b);
          setRawJson(JSON.stringify(b, null, 2));
        })
        .catch((e) => setErr(String(e instanceof Error ? e.message : e)))
        .finally(() => setBusy(false));
    }
  }, [api, mode, workspace]);

  const handleSaveFile = async () => {
    if (!bundle) return;
    const fname = `${slugify(bundle.workspace.name)}.messai`;
    const path = await window.messai.saveText?.(fname, rawJson);
    if (path) setSavedMsg(`Salvo em ${path}`);
  };

  const handleParsePreview = async (text: string) => {
    setErr("");
    setPreview(null);
    let parsed: WorkspaceBundle;
    try {
      parsed = JSON.parse(text) as WorkspaceBundle;
    } catch {
      setErr("Arquivo ou JSON inválido.");
      return;
    }
    setBusy(true);
    try {
      const prev = await api.previewWorkspaceImport(parsed);
      setBundle(parsed);
      setPreview(prev);
      setName(prev.name);
      setCwd(prev.cwd);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmImport = async () => {
    if (!bundle) return;
    setBusy(true);
    setErr("");
    try {
      const created = await api.importWorkspace({
        bundle,
        name: name.trim() || bundle.workspace.name,
        cwd: cwd.trim() || bundle.workspace.cwd,
        includeEnv,
      });
      onImported?.(created);
      onClose();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" style={{ width: 580, maxWidth: "94vw" }} data-testid="ws-transfer-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="row" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
            {mode === "export" ? <><Download size={18} /> Exportar espaço (.messai)</> : <><Upload size={18} /> Importar espaço (.messai)</>}
          </h2>
          <span className="sp" />
          <button type="button" className="tb" onClick={onClose} title="Fechar"><X size={15} /></button>
        </div>

        {mode === "export" && (
          <>
            {busy && <div className="mut">Gerando pacote do espaço…</div>}
            {bundle && (
              <>
                <div className="pf-status" data-testid="export-summary" style={{ marginBottom: 8 }}>
                  Espaço <b>{bundle.workspace.name}</b> · {bundle.nodes.length} nó(s) · {bundle.connections.length} conexão(ões) · {bundle.groups.length} grupo(s) · {bundle.bands.length} banda(s) · {bundle.envVars.length} variável(is)
                </div>
                <textarea
                  readOnly
                  rows={10}
                  value={rawJson}
                  data-testid="export-ws-json"
                  style={{ width: "100%", fontFamily: "var(--mono)", fontSize: 11 }}
                />
                {savedMsg && <div className="pf-status" style={{ marginTop: 6 }}>{savedMsg}</div>}
                <div className="actions" style={{ marginTop: 12 }}>
                  <button type="button" onClick={onClose}>Fechar</button>
                  <button type="button" onClick={() => void navigator.clipboard?.writeText(rawJson).then(() => setSavedMsg("JSON copiado para a área de transferência."))} data-testid="export-copy-btn">Copiar JSON</button>
                  <button type="button" className="pri" onClick={() => void handleSaveFile()} data-testid="export-save-btn">Salvar .messai…</button>
                </div>
              </>
            )}
          </>
        )}

        {mode === "import" && !preview && (
          <>
            <div className="lbl">Selecionar arquivo .messai ou colar o conteúdo</div>
            <input
              type="file"
              accept=".messai,.json"
              data-testid="import-file-input"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                void f.text().then((t) => {
                  setRawJson(t);
                  void handleParsePreview(t);
                });
              }}
              style={{ marginBottom: 8 }}
            />
            <textarea
              rows={8}
              placeholder="Ou cole aqui o conteúdo do arquivo .messai…"
              value={rawJson}
              data-testid="import-json-input"
              onChange={(e) => setRawJson(e.target.value)}
              style={{ width: "100%", fontFamily: "var(--mono)", fontSize: 11 }}
            />
            {err && <div className="pf-status" data-testid="import-error" style={{ color: "var(--danger, #ff6b6b)", marginTop: 6 }}>{err}</div>}
            <div className="actions" style={{ marginTop: 12 }}>
              <button type="button" onClick={onClose}>Cancelar</button>
              <button
                type="button"
                className="pri"
                disabled={!rawJson.trim() || busy}
                data-testid="import-preview-btn"
                onClick={() => void handleParsePreview(rawJson)}
              >
                Revisar conteúdo →
              </button>
            </div>
          </>
        )}

        {mode === "import" && preview && (
          <div data-testid="import-review">
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, color: "var(--ok, #4cd964)", fontSize: 13 }}>
              <CheckCircle2 size={15} /> <b>Revisão antes de importar</b>
            </div>
            <div className="lbl">Nome do espaço importado</div>
            <input value={name} onChange={(e) => setName(e.target.value)} data-testid="import-ws-name" style={{ width: "100%", marginBottom: 8 }} />
            <div className="lbl">Diretório de trabalho</div>
            <div className="row" style={{ marginBottom: 10 }}>
              <input value={cwd} onChange={(e) => setCwd(e.target.value)} data-testid="import-ws-cwd" style={{ flex: 1 }} />
              <button type="button" onClick={() => void window.messai.pickDirectory?.().then((d) => d && setCwd(d))}>Procurar…</button>
            </div>

            <div className="lbl">Resumo do que será importado</div>
            <div data-testid="import-counts" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, fontSize: 12, padding: 8, background: "var(--bg-2, rgba(255,255,255,0.04))", borderRadius: 6, marginBottom: 10 }}>
              <div><b>{preview.counts.nodes}</b> nó(s) ({preview.counts.terminals} terminais, {preview.counts.notes} notas, {preview.counts.binders} fichários)</div>
              <div><b>{preview.counts.connections}</b> conexão(ões) · <b>{preview.counts.groups}</b> grupo(s)</div>
              <div><b>{preview.counts.bands}</b> banda(s) · <b>{preview.counts.drawings}</b> desenho(s)</div>
              <div><b>{preview.counts.roles}</b> papel(is) · <b>{preview.counts.skills}</b> habilidade(s)</div>
              <div><b>{preview.counts.envVars}</b> variável(is) ({preview.counts.secrets} segredo(s))</div>
            </div>

            {preview.nodeTitles.length > 0 && (
              <div style={{ fontSize: 12, marginBottom: 8 }}>
                <span className="mut">Nós: </span>
                <span data-testid="import-node-titles">{preview.nodeTitles.join(", ")}</span>
              </div>
            )}

            {preview.warnings.length > 0 && (
              <div data-testid="import-warnings" style={{ fontSize: 12, padding: 8, borderRadius: 6, background: "rgba(246, 195, 68, 0.12)", marginBottom: 10 }}>
                {preview.warnings.map((w, i) => (
                  <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <AlertTriangle size={13} /> <span>{w}</span>
                  </div>
                ))}
              </div>
            )}

            {preview.counts.envVars > 0 && (
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginBottom: 10 }}>
                <input type="checkbox" checked={includeEnv} data-testid="import-include-env" onChange={(e) => setIncludeEnv(e.target.checked)} />
                Importar também as {preview.counts.envVars} variável(is) de ambiente do pacote ({preview.envKeys.join(", ")})
              </label>
            )}

            {err && <div className="pf-status" data-testid="import-error" style={{ color: "var(--danger, #ff6b6b)", marginBottom: 8 }}>{err}</div>}

            <div className="actions">
              <button type="button" onClick={() => setPreview(null)}>← Voltar</button>
              <button type="button" className="pri" disabled={busy || !name.trim()} data-testid="import-confirm-btn" onClick={() => void handleConfirmImport()}>
                Confirmar importação
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
