import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// #79 anexos do chat como cards: anexar pela CLI, ler os bytes, copiar para o espaço (árvore) e excluir.
const ROOT = join(import.meta.dirname, "../..");
const PORT = 48011;
let dir: string; let rt: ChildProcess; let token: string;
const H = () => ({ authorization: `Bearer ${token}`, "content-type": "application/json" });
const api = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: H(), body: body ? JSON.stringify(body) : null });
  const ct = r.headers.get("content-type") ?? "";
  return { status: r.status, ct, json: r.status === 204 || !ct.includes("json") ? null : await r.json(), text: ct.includes("json") || r.status === 204 ? "" : await r.text() };
};
const cli = (args: string[], env: Record<string, string>) => new Promise<{ code: number; out: string }>((res) => {
  const p = spawn(join(ROOT, "apps/cli/bin/mess"), args, { env: { ...process.env, ...env } }); let out = "";
  p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d)); p.on("exit", (code) => res({ code: code ?? 1, out }));
});
type Chat = { chatId: string; role: string; text: string; attachments?: { attachmentId: string; name: string; size: number; mime: string; path: string }[] };

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "mess-int-"));
  rt = spawn("node", [join(ROOT, "apps/runtime/dist/index.js")], { env: { ...process.env, MESS_DATA_DIR: dir, MESS_PORT: String(PORT), SHELL: "/bin/sh" }, stdio: "ignore" });
  for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 200)); try { token = readFileSync(join(dir, "runtime.token"), "utf8").trim(); if ((await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: H() })).ok) break; } catch { /* subindo */ } }
}, 30_000);
afterAll(() => { rt?.kill(); rmSync(dir, { recursive: true, force: true }); });

describe("#79 anexos do chat", () => {
  let ws: string, node: string, env: Record<string, string>, att: NonNullable<Chat["attachments"]>[number], cwd: string;
  it("mess say --attach copia o arquivo e a mensagem traz o card (nome, tamanho, tipo)", async () => {
    cwd = join(dir, "proj"); mkdirSync(cwd, { recursive: true });
    ws = ((await api("POST", "/v1/workspaces", { name: "Anexos", cwd })).json as { workspaceId: string }).workspaceId;
    node = ((await api("POST", `/v1/workspaces/${ws}/nodes`, { expectedRevision: 0, kind: "terminal", title: "Ag", command: "cat", geometry: { x: 0, y: 0, w: 300, h: 200 } })).json as { node: { nodeId: string } }).node.nodeId;
    env = { MESS_SOCKET: join(dir, "agent.sock"), MESS_TOKEN: token, MESS_WORKSPACE_ID: ws, MESS_NODE_ID: node };
    const f = join(dir, "relatorio.md"); writeFileSync(f, "# Relatório\n\nok\n");
    const r = await cli(["say", "segue o relatório", "--attach", f], env);
    expect(r.code).toBe(0); expect(r.out).toContain("1 anexo");
    const chat = (await api("GET", `/v1/nodes/${node}/chat`)).json as Chat[];
    const m = chat.find((x) => x.role === "agent")!;
    expect(m.attachments).toHaveLength(1);
    att = m.attachments![0]!;
    expect(att).toMatchObject({ name: "relatorio.md", size: 17, mime: "text/markdown" });
    expect(att.path).not.toBe(f); expect(existsSync(att.path)).toBe(true); // cópia, original intacto
    expect(readFileSync(f, "utf8")).toContain("Relatório");
  });
  it("recusa caminho inexistente, relativo e arquivo vazio; mensagem não é criada", async () => {
    const before = ((await api("GET", `/v1/nodes/${node}/chat`)).json as Chat[]).length;
    expect((await api("POST", `/v1/nodes/${node}/chat`, { text: "x", attachments: [{ path: join(dir, "nao-existe.png") }] })).status).toBe(404);
    expect((await api("POST", `/v1/nodes/${node}/chat`, { text: "x", attachments: [{ path: "relativo.png" }] })).status).toBe(400);
    writeFileSync(join(dir, "vazio.txt"), "");
    expect((await api("POST", `/v1/nodes/${node}/chat`, { text: "x", attachments: [{ path: join(dir, "vazio.txt") }] })).status).toBe(400);
    expect(((await api("GET", `/v1/nodes/${node}/chat`)).json as Chat[]).length).toBe(before);
  });
  it("serve os bytes com o tipo certo (abrir)", async () => {
    const r = await api("GET", `/v1/chat-attachments/${att.attachmentId}/raw`);
    expect(r.status).toBe(200); expect(r.ct).toContain("text/markdown"); expect(r.text).toContain("# Relatório");
    expect((await api("GET", `/v1/chat-attachments/naoexiste/raw`)).status).toBe(404);
  });
  it("copia para uma pasta do espaço sem sobrescrever; recusa sair do espaço", async () => {
    const a = await api("POST", `/v1/chat-attachments/${att.attachmentId}/export`, { workspaceId: ws, dir: "docs" });
    expect(a.status).toBe(201); expect((a.json as { path: string }).path).toBe("docs/relatorio.md");
    const b = await api("POST", `/v1/chat-attachments/${att.attachmentId}/export`, { workspaceId: ws, dir: "docs" });
    expect((b.json as { path: string }).path).toBe("docs/relatorio-1.md");
    expect(readFileSync(join(cwd, "docs/relatorio-1.md"), "utf8")).toContain("Relatório");
    expect((await api("POST", `/v1/chat-attachments/${att.attachmentId}/export`, { workspaceId: ws, dir: "../fora" })).status).toBe(400);
  });
  it("excluir remove o arquivo e o card da mensagem", async () => {
    expect((await api("DELETE", `/v1/chat-attachments/${att.attachmentId}`, {})).status).toBe(204);
    expect(existsSync(att.path)).toBe(false);
    const chat = (await api("GET", `/v1/nodes/${node}/chat`)).json as Chat[];
    expect(chat.find((x) => x.role === "agent")?.attachments).toBeUndefined();
    expect((await api("GET", `/v1/chat-attachments/${att.attachmentId}/raw`)).status).toBe(404);
  });
});
