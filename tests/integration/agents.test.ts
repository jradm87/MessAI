import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// #57/#38 — skills: CRUD, anexar ao nó reinicia o processo e injeta no system prompt (claude) + MESS_SKILLS;
// provedores: embutidos + JSON extra em <dataDir>/providers; contas: lidas de um HOME sintético (nunca tokens).
const ROOT = join(import.meta.dirname, "../..");
const PORT = 47969;
let dir: string; let home: string; let rt: ChildProcess; let token: string; let out: string;
const H = (json = false) => ({ authorization: `Bearer ${token}`, ...(json ? { "content-type": "application/json" } : {}) });
const api = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: H(body !== undefined), body: body !== undefined ? JSON.stringify(body) : null });
  return { status: r.status, json: r.status === 204 ? null : await r.json().catch(() => null) };
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const b64url = (s: string) => Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "mess-ag-")); home = join(dir, "home"); out = join(dir, "argv.txt");
  // "claude" falso: grava argv + MESS_SKILLS num arquivo e fica vivo (o nome importa: agentKind/applySkills olham o binário)
  writeFileSync(join(dir, "claude"), `#!/bin/sh\n{ printf '%s\\n' "$@"; echo "MESS_SKILLS=$MESS_SKILLS"; echo "MESS_SKILLS_TEXT=$MESS_SKILLS_TEXT"; } > "${out}"\nsleep 120\n`);
  chmodSync(join(dir, "claude"), 0o755);
  // provedor extra + um inválido
  mkdirSync(join(dir, "providers"), { recursive: true });
  writeFileSync(join(dir, "providers", "meu.json"), JSON.stringify({ id: "meu", label: "Meu CLI", binary: "sh", color: "#123456" }));
  writeFileSync(join(dir, "providers", "quebrado.json"), "{nope");
  // HOME sintético para as contas
  mkdirSync(join(home, ".claude"), { recursive: true }); mkdirSync(join(home, ".codex"), { recursive: true });
  writeFileSync(join(home, ".claude", ".credentials.json"), JSON.stringify({ claudeAiOauth: { accessToken: "SEGREDO", subscriptionType: "pro", expiresAt: Date.now() + 3_600_000 } }));
  writeFileSync(join(home, ".claude.json"), JSON.stringify({ oauthAccount: { emailAddress: "eu@exemplo.com" } }));
  writeFileSync(join(home, ".codex", "auth.json"), JSON.stringify({ tokens: { id_token: `${b64url("{}")}.${b64url(JSON.stringify({ email: "codex@exemplo.com" }))}.x` } }));
  rt = spawn("node", [join(ROOT, "apps/runtime/dist/index.js")], { env: { ...process.env, HOME: home, MESS_DATA_DIR: dir, MESS_PORT: String(PORT), SHELL: "/bin/sh" }, stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { await sleep(200); try { token = readFileSync(join(dir, "runtime.token"), "utf8").trim(); up = (await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: H() })).ok; } catch { /* subindo */ } }
  if (!up) throw new Error(`runtime não subiu na ${PORT}`);
}, 30_000);
afterAll(() => { try { rt?.kill("SIGKILL"); } catch { /* */ } rmSync(dir, { recursive: true, force: true }); });

describe("skills (#57)", () => {
  it("CRUD com nome único; anexar ao nó reinicia o processo e injeta --append-system-prompt + MESS_SKILLS; apagar tira dos nós", async () => {
    const a = (await api("POST", "/v1/skills", { name: "Revisão", description: "revisa PRs", instructions: "Revise com rigor." })).json as { skillId: string };
    expect(a.skillId).toBeTruthy();
    expect((await api("POST", "/v1/skills", { name: "revisão", instructions: "x" })).status).toBe(409); // nome repetido (case-insensitive)
    const b = (await api("POST", "/v1/skills", { name: "Testes", instructions: "Sempre rode os testes." })).json as { skillId: string };
    expect(((await api("GET", "/v1/skills")).json as { name: string }[]).map((k) => k.name)).toEqual(["Revisão", "Testes"]);
    expect(((await api("PATCH", `/v1/skills/${a.skillId}`, { description: "revisa código" })).json as { description: string }).description).toBe("revisa código");
    expect((await api("PATCH", `/v1/skills/${b.skillId}`, { name: "Revisão" })).status).toBe(409);

    const ws = ((await api("POST", "/v1/workspaces", { name: "Sk", cwd: dir })).json as { workspaceId: string }).workspaceId;
    const r = (await api("POST", `/v1/workspaces/${ws}/nodes`, { expectedRevision: 0, kind: "terminal", title: "Claude", command: join(dir, "claude"), args: ["--append-system-prompt", "base"], geometry: { x: 0, y: 0, w: 300, h: 200 } })).json as { node: { nodeId: string }; revision: number };
    for (let i = 0; i < 30 && !existsSync(out); i++) await sleep(100);
    expect(readFileSync(out, "utf8")).toContain("MESS_SKILLS=\n"); // sem skills ainda
    rmSync(out);
    // anexa as duas: processo reinicia e o novo argv traz o texto das skills depois do "base"
    const p = (await api("PATCH", `/v1/nodes/${r.node.nodeId}`, { expectedRevision: r.revision, skillIds: [a.skillId, b.skillId] })).json as { skillIds?: string[] };
    expect(p.skillIds).toEqual([a.skillId, b.skillId]);
    for (let i = 0; i < 50 && !existsSync(out); i++) await sleep(100);
    const argv = readFileSync(out, "utf8");
    expect(argv).toContain("base\n\nHabilidades anexadas a este terminal:");
    expect(argv).toContain("## Revisão\nRevise com rigor.");
    expect(argv).toContain("## Testes\nSempre rode os testes.");
    expect(argv).toContain("MESS_SKILLS=Revisão, Testes");
    expect(argv).toContain("MESS_SKILLS_TEXT=Habilidades anexadas");
    // id inexistente → 404 sem mexer
    const rev = ((await api("GET", `/v1/workspaces/${ws}`)).json as { workspace: { revision: number } }).workspace.revision;
    expect((await api("PATCH", `/v1/nodes/${r.node.nodeId}`, { expectedRevision: rev, skillIds: ["nao-existe"] })).status).toBe(404);
    // apagar a skill A tira do nó
    expect((await api("DELETE", `/v1/skills/${a.skillId}`)).status).toBe(204);
    const snap = (await api("GET", `/v1/workspaces/${ws}`)).json as { nodes: { nodeId: string; skillIds?: string[] }[] };
    expect(snap.nodes.find((n) => n.nodeId === r.node.nodeId)!.skillIds).toEqual([b.skillId]);
    expect((await api("DELETE", `/v1/skills/${a.skillId}`)).status).toBe(404);
  }, 30_000);
});

describe("provedores (#38) e contas (#57) via API", () => {
  it("GET /v1/providers: embutidos + extra do JSON (com caminho resolvido) + erro do arquivo quebrado", async () => {
    const r = (await api("GET", "/v1/providers")).json as { dir: string; providers: { id: string; builtin: boolean; path: string | null; color: string }[]; errors: { file: string }[] };
    expect(r.dir).toBe(join(dir, "providers"));
    expect(r.providers.filter((p) => p.builtin).map((p) => p.id)).toEqual(["claude", "codex", "opencode", "antigravity"]);
    const meu = r.providers.find((p) => p.id === "meu")!;
    expect(meu).toMatchObject({ builtin: false, color: "#123456" }); expect(meu.path).toMatch(/\/sh$/);
    expect(r.errors.map((e) => e.file.split("/").pop())).toEqual(["quebrado.json"]);
    // agent-usage segue os provedores (sem gemini; extra aparece)
    const u = (await api("GET", "/v1/agent-usage")).json as { agents: { id: string }[] };
    expect(u.agents.map((a) => a.id)).toEqual(["claude", "codex", "opencode", "antigravity", "meu"]);
  });
  it("GET /v1/accounts: lê o HOME do runtime; nunca devolve tokens", async () => {
    const r = (await api("GET", "/v1/accounts")).json as { accounts: { id: string; status: string; identity?: string; plan?: string }[] };
    const by = Object.fromEntries(r.accounts.map((a) => [a.id, a]));
    expect(by["claude"]).toMatchObject({ status: "logged", plan: "pro", identity: "eu@exemplo.com" });
    expect(by["codex"]).toMatchObject({ status: "logged", identity: "codex@exemplo.com" });
    expect(by["opencode"]!.status).toBe("none");
    expect(JSON.stringify(r)).not.toContain("SEGREDO");
  });
});
