import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const PORT = 47960;
let dir: string; let rt: ChildProcess; let token: string;
const H = () => ({ authorization: `Bearer ${token}`, "content-type": "application/json" });
const api = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: H(), body: body ? JSON.stringify(body) : null });
  return { status: r.status, json: r.status === 204 ? null : await r.json() };
};
const cli = (args: string[], env: Record<string, string>) => new Promise<{ code: number; out: string }>((res) => {
  const p = spawn(join(ROOT, "apps/cli/bin/mess"), args, { env: { ...process.env, ...env } }); let out = "";
  p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d)); p.on("exit", (code) => res({ code: code ?? 1, out }));
});

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "mess-int-"));
  rt = spawn("node", [join(ROOT, "apps/runtime/dist/index.js")], { env: { ...process.env, MESS_DATA_DIR: dir, MESS_PORT: String(PORT), SHELL: "/bin/sh" }, stdio: "ignore" });
  for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 200)); try { token = readFileSync(join(dir, "runtime.token"), "utf8").trim(); if ((await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: H() })).ok) break; } catch { /* subindo */ } }
}, 30_000);
afterAll(() => { rt?.kill(); rmSync(dir, { recursive: true, force: true }); });

describe("mensagens entre agentes", () => {
  let ws: string, a: { nodeId: string; sessionId: string }, b: { nodeId: string; sessionId: string }, envA: Record<string, string>, envB: Record<string, string>;
  it("prepara dois terminais (cat como agente) e uma nota", async () => {
    ws = ((await api("POST", "/v1/workspaces", { name: "Msg", cwd: dir })).json as { workspaceId: string }).workspaceId;
    const mk = async (rev: number, title: string) => { const r = (await api("POST", `/v1/workspaces/${ws}/nodes`, { expectedRevision: rev, kind: "terminal", title, command: "cat", geometry: { x: 0, y: 0, w: 400, h: 300 } })).json as { node: { nodeId: string }; session: { sessionId: string } }; return { nodeId: r.node.nodeId, sessionId: r.session.sessionId }; };
    a = await mk(0, "Dev"); b = await mk(1, "Revisor");
    const sock = join(dir, "agent.sock");
    envA = { MESS_SOCKET: sock, MESS_TOKEN: token, MESS_WORKSPACE_ID: ws, MESS_NODE_ID: a.nodeId };
    envB = { ...envA, MESS_NODE_ID: b.nodeId };
    expect((await api("GET", `/v1/workspaces/${ws}`)).json).toMatchObject({ workspace: { revision: 2 } });
  });

  it("recusa mensagem sem conexão", async () => {
    const r = await cli(["ask", "Revisor", "oi"], envA);
    expect(r.code).toBe(1); expect(r.out).toContain("FORBIDDEN");
  });

  it("conecta pela CLI e entrega a mensagem no PTY do destino", async () => {
    expect((await cli(["connect", "Revisor"], envA)).out).toContain("ligado");
    // observa a saída do terminal B pelo WS
    const seen: string[] = [];
    const wsock = new WebSocket(`ws://127.0.0.1:${PORT}/v1/ws?token=${token}`);
    await new Promise<void>((res) => { wsock.onopen = () => { wsock.send(JSON.stringify({ type: "attach", sessionId: b.sessionId })); res(); }; });
    wsock.onmessage = (e) => { const m = JSON.parse(e.data as string); if (m.type === "output") seen.push(m.data); };
    const r = await cli(["ask", "Revisor", "você revisou o login?"], envA);
    expect(r.code).toBe(0);
    expect(r.out).toContain("você revisou o login?"); // ask bloqueante devolve a tela (cat ecoa)
    const out = seen.join("");
    expect(out).toContain('Mensagem de "Dev"'); expect(out).toContain("você revisou o login?"); // cat ecoa o que recebeu
    wsock.close();
  });

  it("inbox lista e marca como lida; reply volta ao remetente", async () => {
    const inbox = await cli(["inbox"], envB);
    expect(inbox.out).toContain('de "Dev"'); expect(inbox.out).toContain("você revisou o login?");
    const id = /\[([0-9a-f]{8})\]/.exec(inbox.out)![1]!;
    expect((await cli(["inbox"], envB)).out).toContain("Sem mensagens novas");
    const rep = await cli(["reply", id, "sim, 2 bugs"], envB);
    expect(rep.code).toBe(0); expect(rep.out).toContain("respondida");
    const inA = await cli(["inbox"], envA);
    expect(inA.out).toContain('de "Revisor"'); expect(inA.out).toContain("resposta a"); expect(inA.out).toContain("sim, 2 bugs");
    const unread = (await api("GET", `/v1/workspaces/${ws}/unread`)).json as Record<string, number>;
    expect(Object.keys(unread).length).toBe(0);
  });

  it("--no-wait só dispara; check lê a tela sem enviar", async () => {
    const nw = await cli(["ask", "Revisor", "--no-wait", "disparo-xyz"], envA);
    expect(nw.code).toBe(0); expect(nw.out).toContain("enviada");
    await new Promise((res) => setTimeout(res, 300));
    const c = await cli(["check", "Revisor"], envA); // Dev checa a tela do Revisor
    expect(c.code).toBe(0); expect(c.out).toContain("disparo-xyz"); // o eco ficou na tela
  });

  it("ask a um shell roda o comando e devolve a saída", async () => {
    const rev = ((await api("GET", `/v1/workspaces/${ws}`)).json as { workspace: { revision: number } }).workspace.revision;
    await api("POST", `/v1/workspaces/${ws}/nodes`, { expectedRevision: rev, kind: "terminal", title: "Shell", command: "/bin/sh", geometry: { x: 0, y: 0, w: 400, h: 300 } });
    expect((await cli(["connect", "Shell"], envA)).out).toContain("ligado");
    await new Promise((res) => setTimeout(res, 400)); // sh pronto
    const r = await cli(["ask", "Shell", "echo ola-mundo-123"], envA);
    expect(r.code).toBe(0); expect(r.out).toContain("ola-mundo-123"); // saída do comando volta pro quem perguntou
    expect(r.out).not.toContain("[MessAI]"); // cabeçalho (linha própria num shell real) é filtrado
  });

  it("peers lista terminais conectados com o tipo", async () => {
    const p = await cli(["peers"], envB);
    expect(p.out).toContain("Dev"); expect(p.out).toContain("shell"); // cat/sh = shell cru
  });

  it("chat ignora o papel enviado pelo cliente (MESS-03)", async () => {
    await api("POST", `/v1/nodes/${a.nodeId}/chat`, { text: "msg-forjada", role: "system" }); // cliente tenta forjar
    const ms = (await api("GET", `/v1/nodes/${a.nodeId}/chat?limit=10`)).json as { role: string; text: string }[];
    const mine = ms.find((m) => m.text === "msg-forjada");
    expect(mine?.role).toBe("user"); // http → user; o 'system' pedido é ignorado
  });
});
