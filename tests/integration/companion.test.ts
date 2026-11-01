import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// #65 — companheiro: o runtime emite `taskFinished` quando um AGENTE recebe input, trabalha e assenta.
// Agente falso: um script chamado `claude` (agentKind reconhece pelo nome) que só fala depois de receber input.
const ROOT = join(import.meta.dirname, "../..");
const PORT = 47997;
let dir: string; let rt: ChildProcess; let token: string; let ws: string;
const H = () => ({ authorization: `Bearer ${token}`, "content-type": "application/json" });
const api = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: H(), body: body ? JSON.stringify(body) : null });
  return { status: r.status, json: r.status === 204 ? null : await r.json().catch(() => null) };
};
type Ev = { type: string; event?: { nodeId: string; agentType: string; screen: string; at: string } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "mess-comp-"));
  // Agente falso: espera uma linha, "trabalha" (várias saídas em ~0,8 s), responde e fica ocioso.
  writeFileSync(join(dir, "claude"), `#!/bin/sh\nread line\nsleep 0.2\ni=1\nwhile [ $i -le 6 ]; do echo "trabalhando passo $i no pedido: $line"; sleep 0.1; i=$((i+1)); done\necho "pronto: resultado-final-42"\nsleep 120\n`);
  chmodSync(join(dir, "claude"), 0o755);
  // Ollama apontado para uma porta morta: esta suíte valida a DEGRADAÇÃO (#66) — sem modelo, nada quebra e nenhum resumo sai.
  rt = spawn("node", [join(ROOT, "apps/runtime/dist/index.js")], { env: { ...process.env, MESS_DATA_DIR: dir, MESS_PORT: String(PORT), SHELL: "/bin/sh", MESS_OLLAMA_URL: "http://127.0.0.1:1" }, stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 100 && !up; i++) { await sleep(200); try { token = readFileSync(join(dir, "runtime.token"), "utf8").trim(); up = (await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: H() })).ok; } catch { /* subindo */ } }
  if (!up) throw new Error(`runtime de teste não subiu na porta ${PORT} (porta ocupada? veja ${dir}/runtime.log)`);
  const created = (await api("POST", "/v1/workspaces", { name: "Comp", cwd: dir })).json as { workspaceId?: string } | null;
  if (!created?.workspaceId) throw new Error(`não criou o espaço de teste: ${JSON.stringify(created)}`);
  ws = created.workspaceId;
}, 40_000);
afterAll(async () => {
  // SIGTERM gracioso; se o runtime não sair (ex.: WS ainda aberto), SIGKILL — nunca deixar zumbi segurando a porta.
  try { rt?.kill(); } catch { /* já morreu */ }
  for (let i = 0; i < 15 && rt && rt.exitCode === null && !rt.killed; i++) await sleep(100);
  if (rt && rt.exitCode === null) { try { rt.kill("SIGKILL"); } catch { /* */ } }
  rmSync(dir, { recursive: true, force: true });
});

/** Abre um WS inscrito no espaço e anexado à sessão; devolve coletor de eventos + envio de input. */
async function client(sessionId: string) {
  const events: Ev[] = [];
  const sock = new WebSocket(`ws://127.0.0.1:${PORT}/v1/ws?token=${token}`);
  await new Promise<void>((res) => { sock.onopen = () => { sock.send(JSON.stringify({ type: "subscribe", workspaceId: ws })); sock.send(JSON.stringify({ type: "attach", sessionId })); res(); }; });
  sock.onmessage = (e) => { events.push(JSON.parse(e.data as string) as Ev); };
  const input = (data: string) => { sock.send(JSON.stringify({ type: "acquireLease", sessionId })); sock.send(JSON.stringify({ type: "input", sessionId, data })); };
  return { events, input, close: () => sock.close() };
}
const finishedFor = (events: Ev[], nodeId: string) => events.filter((e) => e.type === "taskFinished" && e.event?.nodeId === nodeId);

describe("companheiro: detectar tarefa concluída (#65)", () => {
  it("agente: nada antes do input; após input + trabalho + assentar, emite taskFinished com a tela", async () => {
    const r = (await api("POST", `/v1/workspaces/${ws}/nodes`, { expectedRevision: 0, kind: "terminal", title: "Agente", command: join(dir, "claude"), geometry: { x: 0, y: 0, w: 400, h: 300 } })).json as { node: { nodeId: string }; session: { sessionId: string } };
    expect(r.session?.sessionId, `nó não criado: ${JSON.stringify(r)}`).toBeTruthy();
    const c = await client(r.session.sessionId);
    try {
      await sleep(1800); // sem input, nenhum turno → nenhum evento (guarda contra o banner de boot)
      expect(finishedFor(c.events, r.node.nodeId)).toHaveLength(0);
      c.input("faz o relatório\r");
      let got: Ev[] = [];
      for (let i = 0; i < 40 && got.length === 0; i++) { await sleep(250); got = finishedFor(c.events, r.node.nodeId); } // ~0,8 s de trabalho + 1,5 s de quiescência
      expect(got).toHaveLength(1);
      expect(got[0]!.event!.agentType).toBe("claudeCode");
      expect(got[0]!.event!.screen).toContain("resultado-final-42"); // última tela vem no evento
      await sleep(2000); // ocioso de novo: NÃO repete (um evento por turno)
      expect(finishedFor(c.events, r.node.nodeId)).toHaveLength(1);
      // #66 degradação: Ollama indisponível → nenhum taskSummary, runtime segue saudável, status diz available=false
      expect(c.events.filter((e) => e.type === "taskSummary")).toHaveLength(0);
      const st = (await api("GET", "/v1/companion")).json as { enabled: boolean; available: boolean; url: string };
      expect(st).toMatchObject({ enabled: true, available: false, url: "http://127.0.0.1:1" });
      expect((await api("POST", "/v1/companion/summarize", { nodeId: r.node.nodeId })).status).toBe(501); // sem modelo: UNSUPPORTED (501 na convenção da API), não erro interno
      expect((await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: H() })).ok).toBe(true);
    } finally { c.close(); }
  }, 30_000);

  it("shell cru nunca emite taskFinished, mesmo com input e saída", async () => {
    const rev = ((await api("GET", `/v1/workspaces/${ws}`)).json as { workspace: { revision: number } }).workspace.revision;
    const r = (await api("POST", `/v1/workspaces/${ws}/nodes`, { expectedRevision: rev, kind: "terminal", title: "Shell", command: "/bin/sh", geometry: { x: 0, y: 0, w: 400, h: 300 } })).json as { node: { nodeId: string }; session: { sessionId: string } };
    expect(r.session?.sessionId, `nó não criado: ${JSON.stringify(r)}`).toBeTruthy();
    const c = await client(r.session.sessionId);
    try {
      await sleep(300);
      c.input("echo linha-um-bem-comprida-para-passar-do-minimo && echo linha-dois\r");
      await sleep(3000);
      expect(finishedFor(c.events, r.node.nodeId)).toHaveLength(0);
      expect(c.events.some((e) => e.type === "output")).toBe(true); // o shell respondeu normalmente, só não é "tarefa de agente"
    } finally { c.close(); }
  }, 15_000);
});
