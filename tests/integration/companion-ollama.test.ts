import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// #66 com modelo REAL: só roda se houver um Ollama local respondendo (na CI não há → pula, sem fingir).
const OLLAMA = process.env["MESS_OLLAMA_URL"] ?? "http://127.0.0.1:11434";
const ollamaUp = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok).catch(() => false);
const ROOT = join(import.meta.dirname, "../..");
const PORT = 47999;
let dir: string; let rt: ChildProcess; let token: string; let ws: string;
const H = () => ({ authorization: `Bearer ${token}`, "content-type": "application/json" });
const api = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: H(), body: body ? JSON.stringify(body) : null });
  return { status: r.status, json: r.status === 204 ? null : await r.json().catch(() => null) };
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!ollamaUp)("companheiro com Ollama real (#66)", () => {
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "mess-ollama-"));
    writeFileSync(join(dir, "claude"), `#!/bin/sh\nread line\nsleep 0.2\necho "Analisando o pedido: $line"\nsleep 0.1\necho "Criei o arquivo relatorio.md com 3 secoes e 120 linhas."\nsleep 0.1\necho "Testes: 12 passaram, 0 falharam."\nsleep 0.1\necho "pronto: relatorio-concluido"\nsleep 120\n`);
    chmodSync(join(dir, "claude"), 0o755);
    rt = spawn("node", [join(ROOT, "apps/runtime/dist/index.js")], { env: { ...process.env, MESS_DATA_DIR: dir, MESS_PORT: String(PORT), SHELL: "/bin/sh", MESS_OLLAMA_URL: OLLAMA }, stdio: "ignore" });
    let up = false;
    for (let i = 0; i < 100 && !up; i++) { await sleep(200); try { token = readFileSync(join(dir, "runtime.token"), "utf8").trim(); up = (await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: H() })).ok; } catch { /* subindo */ } }
    if (!up) throw new Error(`runtime não subiu na ${PORT}`);
    const created = (await api("POST", "/v1/workspaces", { name: "Oll", cwd: dir })).json as { workspaceId?: string } | null;
    if (!created?.workspaceId) throw new Error(`sem espaço: ${JSON.stringify(created)}`);
    ws = created.workspaceId;
  }, 40_000);
  afterAll(async () => {
    try { rt?.kill(); } catch { /* */ }
    for (let i = 0; i < 15 && rt && rt.exitCode === null; i++) await sleep(100);
    if (rt && rt.exitCode === null) { try { rt.kill("SIGKILL"); } catch { /* */ } }
    rmSync(dir, { recursive: true, force: true });
  });

  it("status reporta disponível com um modelo; taskFinished gera taskSummary em pt-BR; summarize sob demanda funciona", async () => {
    const st = (await api("GET", "/v1/companion")).json as { available: boolean; model: string | null; models: string[] };
    expect(st.available).toBe(true); expect(st.model).toBeTruthy();
    const r = (await api("POST", `/v1/workspaces/${ws}/nodes`, { expectedRevision: 0, kind: "terminal", title: "Agente", command: join(dir, "claude"), geometry: { x: 0, y: 0, w: 400, h: 300 } })).json as { node: { nodeId: string }; session: { sessionId: string } };
    const events: { type: string; summary?: { nodeId: string; summary: string; nextStep: string; model: string } }[] = [];
    const sock = new WebSocket(`ws://127.0.0.1:${PORT}/v1/ws?token=${token}`);
    await new Promise<void>((res) => { sock.onopen = () => { sock.send(JSON.stringify({ type: "subscribe", workspaceId: ws })); sock.send(JSON.stringify({ type: "attach", sessionId: r.session.sessionId })); res(); }; });
    sock.onmessage = (e) => { events.push(JSON.parse(e.data as string)); };
    try {
      sock.send(JSON.stringify({ type: "acquireLease", sessionId: r.session.sessionId }));
      sock.send(JSON.stringify({ type: "input", sessionId: r.session.sessionId, data: "gera o relatório do projeto\r" }));
      let sum = events.find((e) => e.type === "taskSummary" && e.summary?.nodeId === r.node.nodeId);
      for (let i = 0; i < 240 && !sum; i++) { await sleep(500); sum = events.find((e) => e.type === "taskSummary" && e.summary?.nodeId === r.node.nodeId); } // modelo pequeno: até ~2 min no 1º carregamento
      expect(sum, "esperava um taskSummary vindo do Ollama").toBeTruthy();
      expect(sum!.summary!.summary.length).toBeGreaterThan(5);
      expect(sum!.summary!.model).toBe(st.model);
      const od = (await api("POST", "/v1/companion/summarize", { nodeId: r.node.nodeId })).json as { summary: string; nextStep: string };
      expect(od.summary.length).toBeGreaterThan(5);
    } finally { sock.close(); }
  }, 180_000);
});
