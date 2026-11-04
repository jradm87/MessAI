import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// #30 — editor de código na árvore + git, com Electron real: abrir arquivo (CodeMirror com destaque), editar e salvar (Ctrl+S),
// detectar mudança externa (conflito), diff/histórico do arquivo, descartar alterações, e o painel Git (status, diff, commit, nova branch).
const ROOT = join(import.meta.dirname, "../..");
const PORT = 48037;
const GENV = { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@t", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };
const git = (...a: string[]) => execFileSync("git", ["-C", repo, ...a], { env: GENV, encoding: "utf8" });
let dataDir: string; let repo: string; let runtime: ChildProcess; let app: ElectronApplication; let page: Page; let token: string; let WS: string;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const api = async (method: string, path: string, body?: unknown) => (await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : null })).json();
const disk = () => readFileSync(join(repo, "app.ts"), "utf8");

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "mess-edgit-")); repo = join(dataDir, "repo"); mkdirSync(repo);
  execFileSync("git", ["init", "-q", "-b", "main", repo], { env: GENV });
  writeFileSync(join(repo, "app.ts"), "export const x: number = 1;\n"); git("add", "-A"); git("commit", "-q", "-m", "inicial");
  runtime = spawn("node", [join(ROOT, "apps/runtime/dist/index.js")], { env: { ...GENV, MESS_DATA_DIR: join(dataDir, "data"), MESS_PORT: String(PORT), SHELL: "/bin/sh" }, stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { await sleep(250); try { token = readFileSync(join(dataDir, "data", "runtime.token"), "utf8").trim(); up = (await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: { authorization: `Bearer ${token}` } })).ok; } catch { /* subindo */ } }
  if (!up) throw new Error(`runtime de teste não subiu na porta ${PORT}`);
  app = await electron.launch({ args: ["."], cwd: join(ROOT, "apps/desktop"), env: { ...GENV, MESS_DATA_DIR: join(dataDir, "data"), MESS_PORT: String(PORT) } });
  page = await app.firstWindow();
  await page.waitForSelector(".side h1");
  WS = ((await api("POST", "/v1/workspaces", { name: "Cod", cwd: repo })) as { workspaceId: string }).workspaceId;
  await api("POST", `/v1/workspaces/${WS}/nodes`, { expectedRevision: 0, kind: "tree", title: "Arquivos", content: "", geometry: { x: 20, y: 20, w: 420, h: 360 } });
  await page.waitForSelector(".side li.ws:has-text('Cod')");
  await page.click(".side li.ws:has-text('Cod')");
  await page.waitForSelector(".side li.ws.on:has-text('Cod')");
}, 60_000);

afterAll(async () => {
  await app?.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
  await app?.close().catch(() => {});
  try { runtime?.kill(); } catch { /* */ }
  for (let i = 0; i < 15 && runtime && runtime.exitCode === null; i++) await sleep(100);
  if (runtime && runtime.exitCode === null) { try { runtime.kill("SIGKILL"); } catch { /* */ } }
  rmSync(dataDir, { recursive: true, force: true });
}, 30_000);

describe("editor de código + git (#30)", () => {
  it("abre o arquivo no editor com destaque de sintaxe; editar marca como sujo; Ctrl+S grava no disco", async () => {
    await page.click('[data-testid="tree-row"]:has-text("app.ts")');
    await page.waitForSelector('[data-testid="file-preview"] .cm-content');
    await page.waitForFunction(() => document.querySelector(".cm-content")?.textContent?.includes("export const x"));
    expect(await page.locator(".cm-line span").count()).toBeGreaterThan(0); // tokens destacados (palavra-chave, tipo, número…)
    if (process.env["SHOT"]) await page.screenshot({ path: "/tmp/editor.png" });
    await page.click(".cm-content");
    await page.keyboard.press("Control+End"); await page.keyboard.type("export const y = 2;\n");
    await page.waitForSelector('[data-testid="editor-dirty"]');
    expect(disk()).not.toContain("y = 2"); // ainda não salvou
    await page.keyboard.press("Control+s");
    await page.waitForSelector('[data-testid="editor-dirty"]', { state: "detached" });
    expect(disk()).toBe("export const x: number = 1;\nexport const y = 2;\n");
    await page.waitForSelector('[data-testid="editor-msg"]:has-text("Salvo")');
  }, 40_000);

  it("mudança externa no disco → Ctrl+S recusa (conflito) sem sobrescrever; 'Recarregar do disco' traz o conteúdo de fora", async () => {
    await sleep(30); writeFileSync(join(repo, "app.ts"), "// editado por outro processo\n");
    await page.click(".cm-content"); await page.keyboard.press("Control+End"); await page.keyboard.type("// meu\n");
    await page.keyboard.press("Control+s");
    await page.waitForSelector('[data-testid="editor-conflict"]');
    expect(disk()).toBe("// editado por outro processo\n");
    await page.click('[data-testid="editor-conflict"] button:has-text("Recarregar")');
    await page.waitForFunction(() => document.querySelector(".cm-content")?.textContent?.includes("editado por outro processo"));
    await page.waitForSelector('[data-testid="editor-dirty"]', { state: "detached" });
    // restaura o conteúdo versionado + a linha salva, para os próximos passos
    writeFileSync(join(repo, "app.ts"), "export const x: number = 1;\nexport const y = 2;\n");
  }, 40_000);

  it("abas do git no arquivo: diff mostra a linha nova; histórico lista o commit; fechar sujo pede confirmação", async () => {
    await page.click('[data-testid="editor-close"]'); await page.waitForSelector('[data-testid="file-preview"]', { state: "detached" });
    await page.click('[data-testid="tree-row"]:has-text("app.ts")'); await page.waitForSelector('[data-testid="file-preview"] .cm-content');
    await page.click('[data-testid="editor-tab-diff"]');
    await page.waitForSelector('[data-testid="diff-view"] .da:has-text("export const y = 2;")');
    await page.click('[data-testid="editor-tab-history"]');
    await page.waitForSelector('[data-testid="history-list"]:has-text("inicial")');
    await page.click('[data-testid="editor-tab-edit"]');
    await page.waitForSelector(".cm-content");
    await page.click(".cm-content"); await page.keyboard.type("lixo");
    await page.waitForSelector('[data-testid="editor-dirty"]');
    await page.click('[data-testid="editor-close"]');
    await page.waitForSelector('[data-testid="editor-discard"]');
    await page.click('[data-testid="editor-discard-yes"]');
    await page.waitForSelector('[data-testid="file-preview"]', { state: "detached" });
    expect(disk()).not.toContain("lixo");
  }, 40_000);

  it("painel Git: lista a alteração, mostra o diff, commita só o marcado, cria e troca de branch, histórico atualiza", async () => {
    writeFileSync(join(repo, "extra.txt"), "fora do commit\n");
    await page.click('[data-testid="tree-git-btn"]');
    await page.waitForSelector('[data-testid="git-panel"]');
    await page.waitForSelector('[data-testid="git-file"]:has-text("app.ts")');
    await page.click('[data-testid="git-refresh"]');
    await page.waitForSelector('[data-testid="git-file"]:has-text("extra.txt")');
    await page.click('[data-testid="git-file"]:has-text("app.ts") .gp');
    await page.waitForSelector('[data-testid="git-panel"] [data-testid="diff-view"] .da:has-text("y = 2")');
    if (process.env["SHOT"]) await page.screenshot({ path: "/tmp/gitpanel.png" });
    await page.locator('[data-testid="git-file"]:has-text("extra.txt") input[type=checkbox]').uncheck();
    await page.fill('[data-testid="git-message"]', "adiciona y");
    await page.click('[data-testid="git-commit"]');
    await page.waitForSelector('[data-testid="git-output"].ok');
    await page.waitForSelector('[data-testid="git-log"] .git-log-row:has-text("adiciona y")');
    expect(git("log", "-1", "--format=%s").trim()).toBe("adiciona y");
    expect(git("status", "--porcelain").trim()).toBe("?? extra.txt"); // o desmarcado ficou de fora
    await page.fill('[data-testid="git-newbranch"]', "feature/ui");
    await page.click('[data-testid="git-branch-create"]');
    await page.waitForFunction(() => (document.querySelector('[data-testid="git-branch-select"]') as HTMLSelectElement | null)?.value === "feature/ui");
    expect(git("branch", "--show-current").trim()).toBe("feature/ui");
    await page.selectOption('[data-testid="git-branch-select"]', "main");
    await page.waitForFunction(() => (document.querySelector('[data-testid="git-branch-select"]') as HTMLSelectElement | null)?.value === "main");
    expect(git("branch", "--show-current").trim()).toBe("main");
    // pull sem upstream fica desabilitado; push oferece definir upstream
    expect(await page.locator('[data-testid="git-pull"]').isDisabled()).toBe(true);
    await page.click('[data-testid="git-panel"] .actions button');
    await page.waitForSelector('[data-testid="git-panel"]', { state: "detached" });
  }, 60_000);
});
