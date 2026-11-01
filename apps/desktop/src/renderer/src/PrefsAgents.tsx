import { useEffect, useState } from "react";
import { Bookmark, Copy, ExternalLink, FolderOpen, LogIn, Plus, RefreshCw, Trash2 } from "lucide-react";
import type { Skill } from "@messai/contracts";
import type { Api } from "./api.js";
import { RolesPanel } from "./RolesDialog.js";
import { Toggle } from "./Preferences.js";
import { AgentIcon } from "./agentIcons.js";
import { loadPrompts, onPrompts, promptTitle, savePrompts, type SavedPrompt } from "./prompts.js";
import { setPref, usePref } from "./prefs.js";

/** #57 — Preferências → Agentes: Papéis, Prompts, Skills, Contas e Uso (#38). */
export type AgentsSub = "roles" | "prompts" | "skills" | "accounts" | "usage";
const SUBS: { id: AgentsSub; label: string }[] = [{ id: "roles", label: "Papéis" }, { id: "prompts", label: "Prompts" }, { id: "skills", label: "Skills" }, { id: "accounts", label: "Contas" }, { id: "usage", label: "Uso" }];
export type OpenTerminal = (t: { title: string; command: string }) => void;
type Props = { api: Api; workspaceCwd: string; onRolesChanged: () => void; onOpenTerminal: OpenTerminal; onOpenUsage: () => void };

function PromptsPanel() {
  const [list, setList] = useState<SavedPrompt[]>(() => loadPrompts());
  useEffect(() => onPrompts(() => setList(loadPrompts())), []);
  const [sel, setSel] = useState<number | "new" | null>(null);
  const [title, setTitle] = useState(""); const [text, setText] = useState("");
  const pick = (i: number | "new") => { setSel(i); if (i === "new") { setTitle(""); setText(""); } else { setTitle(list[i]!.title); setText(list[i]!.text); } };
  const save = () => {
    const t = text.trim(); if (!t) return;
    const p = { title: title.trim() || promptTitle(t), text: t };
    const next = sel === "new" ? [p, ...list] : list.map((x, i) => (i === sel ? p : x));
    savePrompts(next); setSel(sel === "new" ? 0 : sel);
  };
  const del = (i: number) => { savePrompts(list.filter((_, j) => j !== i)); setSel(null); };
  return (
    <div className="roles-body">
      <div className="roles-list">
        <div className="mut hint">Prompts reutilizáveis do compositor (Ctrl+Shift+P → 🔖). Ficam neste computador.</div>
        {list.map((p, i) => <div key={`${p.title}-${i}`} className={`mi ${sel === i ? "on" : ""}`} title={p.text} onClick={() => pick(i)} data-testid="prompt-row"><Bookmark size={13} /><span className="rn">{p.title}</span></div>)}
        {list.length === 0 && <div className="mi mut">Nenhum prompt salvo ainda</div>}
        <div className={`mi ${sel === "new" ? "on" : ""}`} onClick={() => pick("new")} data-testid="prompt-new"><Plus size={14} /> Novo prompt</div>
      </div>
      <div className="roles-edit">
        {sel !== null ? (<>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título (vazio = primeira linha)" data-testid="prompt-title" />
          <textarea className="role-instr" value={text} onChange={(e) => setText(e.target.value)} placeholder="Texto do prompt…" data-testid="prompt-text" autoFocus />
          <div className="actions left">
            <button className="pri" disabled={!text.trim()} onClick={save} data-testid="prompt-save">{sel === "new" ? "Salvar" : "Atualizar"}</button>
            {sel !== "new" && <button className="danger" onClick={() => del(sel)}><Trash2 size={14} /> Apagar</button>}
          </div>
        </>) : <div className="mut empty-roles">Selecione um prompt ou crie um novo. No compositor, o ícone 🔖 insere o texto na mensagem.</div>}
      </div>
    </div>
  );
}

function SkillsPanel({ api }: { api: Api }) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [sel, setSel] = useState<string | "new" | null>(null);
  const [name, setName] = useState(""); const [desc, setDesc] = useState(""); const [instr, setInstr] = useState(""); const [msg, setMsg] = useState("");
  const load = () => api.skills().then(setSkills).catch(() => setSkills([]));
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const say = (t: string) => { setMsg(t); setTimeout(() => setMsg(""), 2500); };
  const pick = (k: Skill | "new") => { if (k === "new") { setSel("new"); setName(""); setDesc(""); setInstr(""); } else { setSel(k.skillId); setName(k.name); setDesc(k.description); setInstr(k.instructions); } };
  const save = async () => {
    try {
      if (sel === "new") { const k = await api.createSkill({ name: name.trim(), description: desc.trim(), instructions: instr }); await load(); pick(k); }
      else if (sel) { await api.patchSkill(sel, { name: name.trim(), description: desc.trim(), instructions: instr }); await load(); }
      say("salvo");
    } catch (e) { say(String(e)); }
  };
  const del = async () => { if (sel && sel !== "new" && confirm("Apagar esta habilidade? Ela sai dos terminais que a usam.")) { await api.deleteSkill(sel); setSel(null); await load(); } };
  return (
    <div className="roles-body">
      <div className="roles-list">
        <div className="mut hint">Conjuntos de instruções anexáveis a um terminal (vários por terminal). Anexe pela pílula de papel do nó → Habilidades.</div>
        {skills.map((k) => <div key={k.skillId} className={`mi ${sel === k.skillId ? "on" : ""}`} title={k.description} onClick={() => pick(k)} data-testid="skill-row"><span className="rn">{k.name}</span></div>)}
        <div className={`mi ${sel === "new" ? "on" : ""}`} onClick={() => pick("new")} data-testid="skill-new"><Plus size={14} /> Nova habilidade</div>
      </div>
      <div className="roles-edit">
        {sel ? (<>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome (ex.: Revisão de código)" data-testid="skill-name" autoFocus />
          <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Descrição curta (opcional)" data-testid="skill-desc" />
          <textarea className="role-instr" value={instr} onChange={(e) => setInstr(e.target.value)} placeholder="Instruções (entram no system prompt do Claude Code e em MESS_SKILLS_TEXT)…" data-testid="skill-instr" />
          <div className="actions left">
            <button className="pri" disabled={!name.trim()} onClick={() => void save()} data-testid="skill-save">{sel === "new" ? "Criar" : "Salvar"}</button>
            {sel !== "new" && <button className="danger" onClick={() => void del()}><Trash2 size={14} /> Apagar</button>}
            <span className="mut">{msg}</span>
          </div>
        </>) : <div className="mut empty-roles">Selecione uma habilidade ou crie uma nova.</div>}
      </div>
    </div>
  );
}

type Account = { id: string; label: string; status: "logged" | "none" | "unknown"; identity?: string; plan?: string; detail?: string; loginCommand: string };
function AccountsPanel({ api, onOpenTerminal }: { api: Api; onOpenTerminal: OpenTerminal }) {
  const [list, setList] = useState<Account[] | null>(null);
  const load = () => api.accounts().then((r) => setList(r.accounts)).catch(() => setList([]));
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const STATUS: Record<Account["status"], string> = { logged: "conectado", none: "sem login", unknown: "não exposto" };
  return (
    <section className="pf-section">
      <div className="row"><div className="mut hint">Estado de login lido dos arquivos das próprias CLIs — só identidade/plano, nunca tokens. Entrar ou trocar de conta é feito na CLI, num terminal.</div><button className="tb" title="Atualizar" onClick={load}><RefreshCw size={14} /></button></div>
      {list === null && <div className="mut">carregando…</div>}
      {list?.map((a) => (
        <div key={a.id} className="pf-field pa-acc" data-testid={`acc-${a.id}`}>
          <div className="pa-acc-main">
            <AgentIcon id={a.id} size={22} />
            <div className="pf-lbl"><span>{a.label} <span className={`pa-chip ${a.status}`}>{STATUS[a.status]}</span>{a.plan && <span className="pa-chip plan">{a.plan}</span>}</span><small>{[a.identity, a.detail].filter(Boolean).join(" — ")}</small></div>
          </div>
          <div className="pf-ctl"><button onClick={() => onOpenTerminal({ title: `${a.label} · login`, command: a.loginCommand })} title={`Abre um terminal com: ${a.loginCommand}`} data-testid={`acc-login-${a.id}`}><LogIn size={14} /> {a.status === "logged" ? "Trocar conta" : "Entrar"}</button></div>
        </div>
      ))}
    </section>
  );
}

type Provider = { id: string; label: string; binary: string; color: string; path: string | null; builtin: boolean; source?: string };
function UsagePanel({ api, onOpenUsage }: { api: Api; onOpenUsage: () => void }) {
  const enabled = usePref("usageEnabled"); const disabledRaw = usePref("usageDisabled");
  const disabled = new Set(disabledRaw.split(",").filter(Boolean));
  const setDisabled = (id: string, off: boolean) => { const n = new Set(disabled); if (off) n.add(id); else n.delete(id); setPref("usageDisabled", [...n].join(",")); };
  const [data, setData] = useState<{ dir: string; providers: Provider[]; errors: { file: string; error: string }[] } | null>(null);
  const [msg, setMsg] = useState("");
  const load = () => api.providers().then(setData).catch(() => setData(null));
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const say = (t: string) => { setMsg(t); setTimeout(() => setMsg(""), 2000); };
  const copy = (t: string) => navigator.clipboard.writeText(t).then(() => say("copiado")).catch(() => say("não foi possível copiar"));
  return (<>
    <section className="pf-section">
      <h3>Agent Usage</h3>
      <div className="pf-field"><div className="pf-lbl"><span>Mostrar uso dos agentes</span><small>Ícones na barra inferior e o painel de plano/limites/atividade.</small></div><div className="pf-ctl"><button onClick={onOpenUsage} disabled={!enabled}><ExternalLink size={14} /> Abrir painel</button><Toggle on={enabled} onChange={(v) => setPref("usageEnabled", v)} testId="usage-enabled" /></div></div>
    </section>
    <section className="pf-section">
      <h3>Provedores</h3>
      <div className="row"><div className="mut hint">CLIs que o MessAI reconhece. Extras: um JSON por provedor na pasta abaixo — <code>{"{ \"id\": \"meu\", \"label\": \"Meu CLI\", \"binary\": \"meu\", \"color\": \"#5aa9ff\" }"}</code>.</div><button className="tb" title="Atualizar" onClick={load}><RefreshCw size={14} /></button></div>
      {data?.providers.map((p) => (
        <div key={p.id} className={`pf-field pa-prov ${disabled.has(p.id) || !enabled ? "off" : ""}`} data-testid={`prov-${p.id}`}>
          <div className="pa-acc-main">
            <span className="pa-dot" style={{ background: p.color }} /><AgentIcon id={p.id} size={20} />
            <div className="pf-lbl"><span>{p.label}{!p.builtin && <span className="pa-chip">extra</span>}</span><small className="mono" title={p.path ?? ""}>{p.path ?? `${p.binary} — não encontrado no PATH`}</small></div>
          </div>
          <div className="pf-ctl">
            {p.path && <button className="tb" title="Copiar caminho do binário" onClick={() => void copy(p.path!)}><Copy size={14} /></button>}
            <Toggle on={!disabled.has(p.id)} disabled={!enabled} onChange={(v) => setDisabled(p.id, !v)} testId={`prov-enabled-${p.id}`} />
          </div>
        </div>
      ))}
      {data?.errors.map((e) => <div key={e.file} className="err">{e.file.split("/").pop()}: {e.error}</div>)}
      {data && <div className="row">
        <button onClick={() => void window.messai.openPath?.(data.dir).then((r) => { if (r) say(r); })} data-testid="prov-open-dir"><FolderOpen size={14} /> Abrir pasta de provedores</button>
        <button onClick={() => void copy(data.dir)} data-testid="prov-copy-dir"><Copy size={14} /> Copiar caminho</button>
        <span className="mut">{msg || data.dir}</span>
      </div>}
    </section>
  </>);
}

export function PrefsAgents({ api, workspaceCwd, onRolesChanged, onOpenTerminal, onOpenUsage }: Props) {
  const saved = usePref("agentsSub");
  const sub: AgentsSub = SUBS.some((s) => s.id === saved) ? (saved as AgentsSub) : "roles";
  return (<>
    <div className="tabs" data-testid="agents-tabs">{SUBS.map((s) => <button key={s.id} className={sub === s.id ? "on" : ""} data-testid={`agents-tab-${s.id}`} onClick={() => setPref("agentsSub", s.id)}>{s.label}</button>)}</div>
    {sub === "roles" && <RolesPanel api={api} workspaceCwd={workspaceCwd} onChanged={onRolesChanged} />}
    {sub === "prompts" && <PromptsPanel />}
    {sub === "skills" && <SkillsPanel api={api} />}
    {sub === "accounts" && <AccountsPanel api={api} onOpenTerminal={onOpenTerminal} />}
    {sub === "usage" && <UsagePanel api={api} onOpenUsage={onOpenUsage} />}
  </>);
}
