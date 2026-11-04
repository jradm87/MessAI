import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// #30 — git do espaço pela API, com repositórios REAIS: status/commit/log/diff/branch/checkout/merge (inclusive conflito e abort),
// pull/push contra um remote local, validação de nomes/caminhos, leitura liberada a agente e escrita só do app, edição com detecção de conflito.
const ROOT = join(import.meta.dirname, "../..");
const PORT = 48036;
let dir: string; let rt: ChildProcess; let token: string;
const GENV = { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@t", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };
const git = (cwd: string, ...a: string[]) => execFileSync("git", ["-C", cwd, ...a], { env: GENV, encoding: "utf8" });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const call = async (tk: string, method: string, path: string, body?: unknown) => { const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: { authorization: `Bearer ${tk}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : null }); const t = await r.text(); return { status: r.status, json: t ? JSON.parse(t) : null }; };
const api = (method: string, path: string, body?: unknown) => call(token, method, path, body);
type Info = { isRepo: boolean; branch?: string; upstream?: string; ahead: number; behind: number; merging: boolean; files: { path: string; code: string; staged: boolean; unstaged: boolean }[]; branches: { name: string; current: boolean; remote: boolean }[] };
type Op = { ok: boolean; output: string; conflicts?: string[] };
const mkWs = async (name: string, cwd: string) => ((await api("POST", "/v1/workspaces", { name, cwd })).json as { workspaceId: string }).workspaceId;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "mess-git-"));
  rt = spawn(process.execPath, [join(ROOT, "apps/runtime/dist/index.js")], { env: { ...GENV, MESS_DATA_DIR: join(dir, "data"), MESS_PORT: String(PORT), SHELL: "/bin/sh" }, stdio: "ignore" });
  for (let i = 0; i < 60; i++) { await sleep(200); try { token = readFileSync(join(dir, "data", "runtime.token"), "utf8").trim(); if ((await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: { authorization: `Bearer ${token}` } })).ok) break; } catch { /* subindo */ } }
  if (!token) throw new Error("runtime não subiu");
}, 40_000);
afterAll(() => { try { rt?.kill("SIGKILL"); } catch { /* */ } rmSync(dir, { recursive: true, force: true }); });

describe("git do espaço (#30)", () => {
  it("fora de repositório: isRepo=false, escrita recusada com 400", async () => {
    const cwd = join(dir, "plain"); mkdirSync(cwd); const ws = await mkWs("plain", cwd);
    expect(((await api("GET", `/v1/workspaces/${ws}/git`)).json as Info)).toMatchObject({ isRepo: false, files: [] });
    expect((await api("POST", `/v1/workspaces/${ws}/git/commit`, { message: "x" })).status).toBe(400);
    expect((await api("GET", `/v1/workspaces/${ws}/git/log`)).json).toEqual([]);
  });

  it("status → commit (tudo e só alguns caminhos) → log → diff", async () => {
    const cwd = join(dir, "repo"); mkdirSync(cwd); git(cwd, "init", "-q", "-b", "main"); const ws = await mkWs("repo", cwd);
    writeFileSync(join(cwd, "a.txt"), "um\n"); writeFileSync(join(cwd, "b.txt"), "dois\n");
    let info = (await api("GET", `/v1/workspaces/${ws}/git`)).json as Info;
    expect(info).toMatchObject({ isRepo: true, branch: "main" }); expect(info.files.map((f) => `${f.code}:${f.path}`).sort()).toEqual(["?:a.txt", "?:b.txt"]);
    const c1 = (await api("POST", `/v1/workspaces/${ws}/git/commit`, { message: "primeiro" })).json as Op; expect(c1.ok, c1.output).toBe(true);
    info = (await api("GET", `/v1/workspaces/${ws}/git`)).json as Info; expect(info.files).toEqual([]);
    writeFileSync(join(cwd, "a.txt"), "um\nmais\n"); writeFileSync(join(cwd, "b.txt"), "dois\nmais\n");
    info = (await api("GET", `/v1/workspaces/${ws}/git`)).json as Info; expect(info.files.find((f) => f.path === "a.txt")).toMatchObject({ code: "M", unstaged: true, staged: false });
    const d = (await api("GET", `/v1/workspaces/${ws}/git/diff?path=a.txt`)).json as { text: string }; expect(d.text).toContain("+mais"); expect(d.text).not.toContain("b.txt");
    const c2 = (await api("POST", `/v1/workspaces/${ws}/git/commit`, { message: "só a", paths: ["a.txt"] })).json as Op; expect(c2.ok, c2.output).toBe(true);
    info = (await api("GET", `/v1/workspaces/${ws}/git`)).json as Info; expect(info.files.map((f) => f.path)).toEqual(["b.txt"]); // b ficou de fora
    const log = (await api("GET", `/v1/workspaces/${ws}/git/log`)).json as { subject: string; short: string }[]; expect(log.map((l) => l.subject)).toEqual(["só a", "primeiro"]); expect(log[0]!.short).toHaveLength(8);
    expect(((await api("GET", `/v1/workspaces/${ws}/git/log?path=b.txt`)).json as { subject: string }[]).map((l) => l.subject)).toEqual(["primeiro"]); // histórico do arquivo
    // arquivo novo não rastreado aparece no diff como adição
    writeFileSync(join(cwd, "novo.txt"), "oi\n"); expect(((await api("GET", `/v1/workspaces/${ws}/git/diff?path=novo.txt`)).json as { text: string }).text).toContain("+oi");
    // mensagem vazia / nada para commitar → ok=false com a saída do git (não estoura)
    git(cwd, "add", "-A"); git(cwd, "commit", "-q", "-m", "limpa");
    const none = (await api("POST", `/v1/workspaces/${ws}/git/commit`, { message: "nada" })).json as Op; expect(none.ok).toBe(false);
  }, 30_000);

  it("branch/checkout/merge: avanço, conflito (lista arquivos), abort", async () => {
    const cwd = join(dir, "merge"); mkdirSync(cwd); git(cwd, "init", "-q", "-b", "main"); const ws = await mkWs("merge", cwd);
    writeFileSync(join(cwd, "f.txt"), "base\n"); git(cwd, "add", "-A"); git(cwd, "commit", "-q", "-m", "base");
    expect(((await api("POST", `/v1/workspaces/${ws}/git/branch`, { name: "feature/x" })).json as Op).ok).toBe(true);
    let info = (await api("GET", `/v1/workspaces/${ws}/git`)).json as Info; expect(info.branch).toBe("feature/x"); expect(info.branches.filter((b) => !b.remote).map((b) => b.name).sort()).toEqual(["feature/x", "main"]);
    writeFileSync(join(cwd, "f.txt"), "feature\n"); git(cwd, "commit", "-aq", "-m", "feat");
    expect(((await api("POST", `/v1/workspaces/${ws}/git/checkout`, { branch: "main" })).json as Op).ok).toBe(true);
    const ff = (await api("POST", `/v1/workspaces/${ws}/git/merge`, { branch: "feature/x" })).json as Op; expect(ff.ok, ff.output).toBe(true);
    expect(readFileSync(join(cwd, "f.txt"), "utf8")).toBe("feature\n");
    // conflito: duas branches mexem na mesma linha
    git(cwd, "checkout", "-q", "-b", "a"); writeFileSync(join(cwd, "f.txt"), "A\n"); git(cwd, "commit", "-aq", "-m", "A");
    git(cwd, "checkout", "-q", "main"); writeFileSync(join(cwd, "f.txt"), "M\n"); git(cwd, "commit", "-aq", "-m", "M");
    const cf = (await api("POST", `/v1/workspaces/${ws}/git/merge`, { branch: "a" })).json as Op;
    expect(cf.ok).toBe(false); expect(cf.conflicts).toEqual(["f.txt"]);
    info = (await api("GET", `/v1/workspaces/${ws}/git`)).json as Info; expect(info.merging).toBe(true); expect(info.files.find((f) => f.path === "f.txt")!.code).toBe("U");
    const ab = (await api("POST", `/v1/workspaces/${ws}/git/merge`, { abort: true })).json as Op; expect(ab.ok, ab.output).toBe(true);
    info = (await api("GET", `/v1/workspaces/${ws}/git`)).json as Info; expect(info.merging).toBe(false); expect(readFileSync(join(cwd, "f.txt"), "utf8")).toBe("M\n");
    // checkout com alteração local em conflito → recusa, sem perder nada
    git(cwd, "checkout", "-q", "a"); writeFileSync(join(cwd, "f.txt"), "suja\n");
    const bad = (await api("POST", `/v1/workspaces/${ws}/git/checkout`, { branch: "main" })).json as Op; expect(bad.ok).toBe(false); expect(readFileSync(join(cwd, "f.txt"), "utf8")).toBe("suja\n");
  }, 30_000);

  it("pull (só avanço) e push contra um remote local; push -u define o upstream", async () => {
    const bare = join(dir, "remote.git"); execFileSync("git", ["init", "-q", "--bare", "-b", "main", bare], { env: GENV });
    const cwd = join(dir, "local"); mkdirSync(cwd); git(cwd, "init", "-q", "-b", "main"); git(cwd, "remote", "add", "origin", bare); const ws = await mkWs("local", cwd);
    writeFileSync(join(cwd, "x.txt"), "1\n"); git(cwd, "add", "-A"); git(cwd, "commit", "-q", "-m", "c1");
    const noUp = (await api("POST", `/v1/workspaces/${ws}/git/push`, {})).json as Op; expect(noUp.ok).toBe(false); // sem upstream
    const up = (await api("POST", `/v1/workspaces/${ws}/git/push`, { setUpstream: true })).json as Op; expect(up.ok, up.output).toBe(true);
    let info = (await api("GET", `/v1/workspaces/${ws}/git`)).json as Info; expect(info.upstream).toBe("origin/main"); expect(info).toMatchObject({ ahead: 0, behind: 0 });
    // outro clone publica um commit → ficamos "behind" depois do fetch; pull avança
    const other = join(dir, "other"); execFileSync("git", ["clone", "-q", bare, other], { env: GENV });
    writeFileSync(join(other, "y.txt"), "2\n"); git(other, "add", "-A"); git(other, "commit", "-q", "-m", "c2"); git(other, "push", "-q");
    git(cwd, "fetch", "-q");
    info = (await api("GET", `/v1/workspaces/${ws}/git`)).json as Info; expect(info.behind).toBe(1);
    const pl = (await api("POST", `/v1/workspaces/${ws}/git/pull`)).json as Op; expect(pl.ok, pl.output).toBe(true);
    expect(existsSync(join(cwd, "y.txt"))).toBe(true);
    // ahead: commit local, push simples
    writeFileSync(join(cwd, "z.txt"), "3\n"); git(cwd, "add", "-A"); git(cwd, "commit", "-q", "-m", "c3");
    expect(((await api("GET", `/v1/workspaces/${ws}/git`)).json as Info).ahead).toBe(1);
    expect(((await api("POST", `/v1/workspaces/${ws}/git/push`, {})).json as Op).ok).toBe(true);
    expect(git(bare, "log", "--format=%s", "main").trim().split("\n")).toEqual(["c3", "c2", "c1"]);
    // divergiu: pull --ff-only recusa (nada de merge às escondidas)
    git(other, "pull", "-q", "--ff-only"); writeFileSync(join(other, "w.txt"), "4\n"); git(other, "add", "-A"); git(other, "commit", "-q", "-m", "c4"); git(other, "push", "-q");
    writeFileSync(join(cwd, "v.txt"), "5\n"); git(cwd, "add", "-A"); git(cwd, "commit", "-q", "-m", "c5"); git(cwd, "fetch", "-q");
    expect(((await api("POST", `/v1/workspaces/${ws}/git/pull`)).json as Op).ok).toBe(false);
    expect(git(cwd, "log", "--format=%s", "-1").trim()).toBe("c5"); // histórico intacto
  }, 40_000);

  it("validação: nomes de branch perigosos e caminhos fora do espaço são recusados (nada vira opção do git)", async () => {
    const cwd = join(dir, "valid"); mkdirSync(cwd); git(cwd, "init", "-q", "-b", "main"); writeFileSync(join(cwd, "a"), "1"); git(cwd, "add", "-A"); git(cwd, "commit", "-q", "-m", "i"); const ws = await mkWs("valid", cwd);
    for (const name of ["--help", "-x", "a..b", "x.lock", "a b", "a;rm", "$(id)", "/abs", "a//b", "x@{1}", ""]) {
      const r = await api("POST", `/v1/workspaces/${ws}/git/branch`, { name }); expect(r.status, name).toBe(400);
    }
    expect((await api("POST", `/v1/workspaces/${ws}/git/checkout`, { branch: "--orphan" })).status).toBe(400);
    expect((await api("POST", `/v1/workspaces/${ws}/git/merge`, { branch: "-s" })).status).toBe(400);
    expect((await api("POST", `/v1/workspaces/${ws}/git/commit`, { message: "x", paths: ["../fora"] })).status).toBeGreaterThanOrEqual(400);
    expect((await api("GET", `/v1/workspaces/${ws}/git/diff?path=../../etc/passwd`)).status).toBeGreaterThanOrEqual(400);
    expect(git(cwd, "branch", "--list").trim()).toBe("* main");
  });

  it("agente com files:read LÊ o git (status/log/diff); commit/pull/push/branch/merge são só do app (403)", async () => {
    const cwd = join(dir, "authz"); mkdirSync(cwd); git(cwd, "init", "-q", "-b", "main"); const ws = await mkWs("authz", cwd);
    const n = (await api("POST", `/v1/workspaces/${ws}/nodes`, { expectedRevision: 0, kind: "terminal", title: "ag", command: "/bin/sh", geometry: { x: 0, y: 0, w: 100, h: 100 } })).json as { node: { nodeId: string } };
    const tk = ((await api("POST", `/v1/nodes/${n.node.nodeId}/token`, { capabilities: ["files:read"] })).json as { token: string }).token;
    expect((await call(tk, "GET", `/v1/workspaces/${ws}/git`)).status).toBe(200);
    expect((await call(tk, "GET", `/v1/workspaces/${ws}/git/log`)).status).toBe(200);
    for (const [p, b] of [["commit", { message: "x" }], ["branch", { name: "y" }], ["checkout", { branch: "main" }], ["merge", { branch: "main" }], ["pull", {}], ["push", {}]] as const) expect((await call(tk, "POST", `/v1/workspaces/${ws}/git/${p}`, b)).status, p).toBe(403);
    const other = (await api("POST", "/v1/workspaces", { name: "o", cwd: join(dir, "plain") })).json as { workspaceId: string };
    expect((await call(tk, "GET", `/v1/workspaces/${other.workspaceId}/git`)).status).toBe(403); // escopo do próprio espaço
  });

  it("edição segura: write devolve mtime; expectedMtimeMs velho → 409 e o arquivo no disco não é sobrescrito", async () => {
    const cwd = join(dir, "edit"); mkdirSync(cwd); const ws = await mkWs("edit", cwd); writeFileSync(join(cwd, "e.txt"), "original\n");
    const f = (await api("GET", `/v1/workspaces/${ws}/file?path=e.txt`)).json as { text: string; mtimeMs: number; truncated: boolean };
    expect(f.text).toBe("original\n"); expect(f.mtimeMs).toBeGreaterThan(0);
    const w1 = await api("POST", `/v1/workspaces/${ws}/fs`, { op: "write", path: "e.txt", text: "editado\n", expectedMtimeMs: f.mtimeMs }); expect(w1.status).toBe(200); expect(w1.json.mtimeMs).toBe(statSync(join(cwd, "e.txt")).mtimeMs);
    await sleep(20); writeFileSync(join(cwd, "e.txt"), "externo\n"); // outro processo mexeu
    const w2 = await api("POST", `/v1/workspaces/${ws}/fs`, { op: "write", path: "e.txt", text: "meu\n", expectedMtimeMs: w1.json.mtimeMs }); expect(w2.status).toBe(409);
    expect(readFileSync(join(cwd, "e.txt"), "utf8")).toBe("externo\n");
    expect((await api("POST", `/v1/workspaces/${ws}/fs`, { op: "write", path: "e.txt", text: "forçado\n" })).status).toBe(200); // sem expectedMtimeMs: comportamento antigo
  });
});
