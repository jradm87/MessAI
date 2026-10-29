import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const PORT = 47966;
let dir: string; let repo: string; let rt: ChildProcess; let token: string;
// git isolado da configuração do usuário (assinatura GPG, hooks, etc.)
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const git = (...a: string[]) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", env: GIT_ENV }).trim();
const api = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : null });
  return { status: r.status, json: r.status === 204 ? null : await r.json() };
};
const wait = async (pred: () => Promise<boolean>, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await pred()) return true; await new Promise((r) => setTimeout(r, 150)); } return false; };
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "mess-floors-")); repo = join(dir, "repo"); mkdirSync(repo);
  git("init", "-q", "-b", "main"); writeFileSync(join(repo, "README.md"), "# projeto\n"); git("add", "."); git("commit", "-q", "-m", "inicial");
  rt = spawn("node", [join(ROOT, "apps/runtime/dist/index.js")], { env: { ...GIT_ENV, MESS_DATA_DIR: dir, MESS_PORT: String(PORT), SHELL: "/bin/sh" }, stdio: "ignore" });
  for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 200)); try { token = readFileSync(join(dir, "runtime.token"), "utf8").trim(); if ((await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: { authorization: `Bearer ${token}` } })).ok) break; } catch { /* subindo */ } }
}, 30_000);
afterAll(() => { rt?.kill(); rmSync(dir, { recursive: true, force: true }); });

type W = { workspaceId: string; name: string; cwd: string; branch?: string; parentId?: string; status?: string; statusText?: string; revision: number; floorType?: string };
describe("andares (floors)", () => {
  let ground: string, floor: W;
  it("cria andar como worktree com branch nova a partir do térreo", async () => {
    ground = ((await api("POST", "/v1/workspaces", { name: "Projeto", cwd: repo, icon: "rocket", color: "#5aa9ff" })).json as W).workspaceId;
    const r = await api("POST", `/v1/workspaces/${ground}/floors`, { name: "Login único", cloneLayout: true });
    expect(r.status).toBe(201); floor = r.json as W;
    expect(floor).toMatchObject({ parentId: ground, branch: "login-unico", floorType: "worktree", status: "working" });
    expect(floor.cwd).toBe(join(dir, "floors", ground, "login-unico"));
    expect(existsSync(join(floor.cwd, "README.md"))).toBe(true);
    expect(git("worktree", "list")).toContain(floor.cwd);
    expect(git("branch", "--list", "login-unico")).toContain("login-unico");
    expect(((await api("GET", `/v1/workspaces/${ground}/floors`)).json as W[]).map((f) => f.name)).toEqual(["Login único"]);
    // andar de andar não existe; nome repetido → branch repetida → conflito
    expect((await api("POST", `/v1/workspaces/${floor.workspaceId}/floors`, { name: "x" })).status).toBe(400);
    expect((await api("POST", `/v1/workspaces/${ground}/floors`, { name: "Login único" })).status).toBe(409);
  });
  it("terminal no andar recebe MESS_FLOOR_NAME/BRANCH/PATH/ROOT_PATH", async () => {
    const out = join(dir, "floor-env.txt");
    const r = await api("POST", `/v1/workspaces/${floor.workspaceId}/nodes`, { expectedRevision: 0, kind: "terminal", title: "T", command: "sh", args: ["-c", `printf '%s|%s|%s|%s|%s' "$MESS_FLOOR_NAME" "$MESS_BRANCH_NAME" "$MESS_FLOOR_PATH" "$MESS_ROOT_PATH" "$MESS_PROJECT_NAME" > ${out}`], geometry: { x: 0, y: 0, w: 300, h: 200 } });
    expect(r.status).toBe(201);
    expect(await wait(async () => existsSync(out))).toBe(true);
    expect(readFileSync(out, "utf8")).toBe(`Login único|login-unico|${floor.cwd}|${repo}|Projeto`);
  });
  it("status do andar e branch existente", async () => {
    const f = (await api("GET", `/v1/workspaces/${floor.workspaceId}`)).json as { workspace: W };
    const p = await api("PATCH", `/v1/workspaces/${floor.workspaceId}`, { expectedRevision: f.workspace.revision, status: "review", statusText: "pronto para olhar" });
    expect(p.status).toBe(200); expect(p.json).toMatchObject({ status: "review", statusText: "pronto para olhar" });
    git("branch", "hotfix"); // branch existente
    const r = await api("POST", `/v1/workspaces/${ground}/floors`, { name: "Hotfix", branch: "hotfix", newBranch: false });
    expect(r.status).toBe(201); expect((r.json as W).branch).toBe("hotfix");
    expect((await api("POST", `/v1/workspaces/${ground}/floors`, { name: "Nada", branch: "nao-existe", newBranch: false })).status).toBe(404);
    await api("DELETE", `/v1/workspaces/${(r.json as W).workspaceId}`);
    expect(git("worktree", "list")).not.toContain("hotfix");
  });
  it("pousar: merge limpo remove o andar e o worktree; conflito aborta e lista arquivos", async () => {
    // commit no andar
    writeFileSync(join(floor.cwd, "feature.txt"), "ok\n");
    execFileSync("git", ["-C", floor.cwd, "add", "."], { env: GIT_ENV });
    execFileSync("git", ["-C", floor.cwd, "commit", "-q", "-m", "feature"], { env: GIT_ENV });
    // térreo sujo bloqueia
    writeFileSync(join(repo, "sujo.txt"), "x"); 
    expect((await api("POST", `/v1/workspaces/${floor.workspaceId}/land`, {})).status).toBe(409);
    rmSync(join(repo, "sujo.txt"));
    const land = (await api("POST", `/v1/workspaces/${floor.workspaceId}/land`, {})).json as { ok: boolean; merged: boolean; removed: boolean };
    expect(land).toMatchObject({ ok: true, merged: true, removed: true });
    expect(existsSync(join(repo, "feature.txt"))).toBe(true);
    expect(existsSync(floor.cwd)).toBe(false);
    expect((await api("GET", `/v1/workspaces/${floor.workspaceId}`)).status).toBe(404);
    // conflito: mesmo arquivo alterado nos dois lados
    const c = (await api("POST", `/v1/workspaces/${ground}/floors`, { name: "Conflito" })).json as W;
    writeFileSync(join(c.cwd, "README.md"), "# andar\n"); execFileSync("git", ["-C", c.cwd, "commit", "-qam", "andar"], { env: GIT_ENV });
    writeFileSync(join(repo, "README.md"), "# terreo\n"); git("commit", "-qam", "terreo");
    const r2 = (await api("POST", `/v1/workspaces/${c.workspaceId}/land`, { keepFloor: true })).json as { ok: boolean; conflicts: string[] };
    expect(r2.ok).toBe(false); expect(r2.conflicts).toEqual(["README.md"]);
    expect(git("status", "--porcelain")).toBe(""); // merge abortado, térreo limpo
    expect(((await api("GET", `/v1/workspaces/${c.workspaceId}`)).json as { workspace: W }).workspace.status).toBe("working");
    // apagar o térreo leva os andares junto, inclusive worktree e branch
    await api("DELETE", `/v1/workspaces/${ground}?deleteBranch=1`);
    expect(git("worktree", "list").split("\n").length).toBe(1);
    expect(git("branch", "--list", "conflito")).toBe("");
  });
});
