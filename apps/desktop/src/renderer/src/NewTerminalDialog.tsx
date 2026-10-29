import { useEffect, useState } from "react";
import { SquareTerminal } from "lucide-react";
import { AgentIcon } from "./agentIcons.js";
import type { Preset, Role } from "@messai/contracts";

export type NewTerminalInput = { title: string; command?: string; cwd?: string; presetId?: string; roleId?: string; persistent?: boolean };
const ICON: Record<string, React.ReactNode> = { claude: <AgentIcon id="claude" size={26} />, codex: <AgentIcon id="codex" size={26} />, antigravity: <AgentIcon id="antigravity" size={26} />, opencode: <AgentIcon id="opencode" size={26} />, gemini: <AgentIcon id="gemini" size={26} />, shell: <SquareTerminal size={26} /> };

/** Diálogo "Novo terminal": Início rápido + Detalhes (nome, comando, diretório). Aparência e Papel ficam para depois. */
export function NewTerminalDialog({ presets, roles, defaultCwd, onCreate, onClose, onManageRoles, tmux }: { presets: Preset[]; roles: Role[]; defaultCwd: string; onCreate: (i: NewTerminalInput) => void; onClose: () => void; onManageRoles: () => void; tmux: boolean }) {
  const [roleId, setRoleId] = useState("");
  const [persistent, setPersistent] = useState(tmux);
  const first = presets.find((p) => p.available) ?? presets[0];
  const [sel, setSel] = useState<Preset | undefined>(first);
  const [title, setTitle] = useState(first?.label ?? "Terminal");
  const [command, setCommand] = useState(first ? [first.command, ...first.args.filter((a) => !a.startsWith("--append-system-prompt") && !a.includes("MessAI"))].join(" ") : "");
  const [cwd, setCwd] = useState(defaultCwd);
  const [tab, setTab] = useState<"details" | "appearance" | "role">("details");
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const pick = (p: Preset) => { setSel(p); setTitle(p.label); setCommand(p.command); };
  const submit = () => onCreate({ title: title.trim() || (sel?.label ?? "Terminal"), ...(command.trim() ? { command: command.trim() } : {}), ...(cwd.trim() ? { cwd: cwd.trim() } : {}), ...(sel ? { presetId: sel.id } : {}), ...(roleId ? { roleId } : {}), ...(persistent ? { persistent: true } : {}) });
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "TEXTAREA") submit(); }}>
        <h2>Novo terminal</h2>
        <div className="lbl">Início rápido</div>
        <div className="quick">
          {presets.map((p) => (
            <button key={p.id} className={`qs ${sel?.id === p.id ? "on" : ""} ${p.available ? "" : "off"}`} disabled={!p.available} title={p.available ? p.command : `${p.command} não encontrado no PATH`} onClick={() => pick(p)}>
              <span className="ic">{ICON[p.id] ?? <SquareTerminal size={26} />}</span><span>{p.label}</span>
            </button>
          ))}
        </div>
        <div className="tabs">
          {(["details", "appearance", "role"] as const).map((t) => <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t === "details" ? "Detalhes" : t === "appearance" ? "Aparência" : "Papel"}</button>)}
        </div>
        {tab === "details" ? (
          <div className="form">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Nome" autoFocus />
            <label>Comando <input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="shell padrão" /></label>
            <label className="chk" title={tmux ? "A sessão roda dentro do tmux e sobrevive a reinícios do runtime; reabrir reanexa." : "tmux não encontrado no PATH"}><input type="checkbox" data-testid="nt-persistent" checked={persistent} disabled={!tmux} onChange={(e) => setPersistent(e.target.checked)} /> Sessão persistente (tmux){!tmux && <span className="mut"> — tmux não instalado</span>}</label>
            <label className="chk"><input type="checkbox" checked readOnly /> Monitorar atividade <span className="mut">(em breve)</span></label>
            <label className="chk"><input type="checkbox" disabled /> Maestro <span className="mut">(em breve)</span></label>
            <div className="lbl">Diretório de trabalho</div>
            <div className="row"><input value={cwd} onChange={(e) => setCwd(e.target.value)} /><button onClick={() => void window.messai.pickDirectory?.().then((d) => d && setCwd(d))}>Procurar…</button></div>
          </div>
        ) : tab === "role" ? (
          <div className="form">
            <div className="lbl">Responsabilidade injetada na partida</div>
            <div className="role-grid" data-testid="role-grid">
              <button type="button" className={`qs ${roleId === "" ? "on" : ""}`} onClick={() => setRoleId("")}><span className="role-badge none">—</span><span>Sem papel</span></button>
              {roles.map((r) => <button key={r.roleId} type="button" className={`qs ${roleId === r.roleId ? "on" : ""}`} title={r.instructions.slice(0, 200)} onClick={() => setRoleId(r.roleId)}><span className="role-badge">{r.badge || r.name.slice(0, 2).toUpperCase()}</span><span>{r.name}</span></button>)}
            </div>
            {roleId && <div className="mut role-preview">{roles.find((r) => r.roleId === roleId)?.instructions.slice(0, 300) || "(sem instruções)"}</div>}
            <div><button type="button" onClick={onManageRoles}>Gerenciar responsabilidades…</button></div>
          </div>
        ) : <div className="form mut">Em breve: ícone, cor, tema e fonte por terminal.</div>}
        <div className="actions"><button onClick={onClose}>Cancelar</button><button className="pri" onClick={submit}>Criar</button></div>
      </div>
    </div>
  );
}
