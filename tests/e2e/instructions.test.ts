import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// #76 — Instruções do projeto (CLAUDE.md / AGENTS.md) sincronizadas no app.
const ROOT = join(import.meta.dirname, "../..");
const PORT = 48015;
let dataDir: string; let cwd: string; let runtime: ChildProcess; let app: ElectronApplication; let page: Page; let token: string; let WS: string;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const api = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : null });
  return r.status === 204 ? null : r.json();
};

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "mess-ins-"));
  cwd = join(dataDir, "proj"); mkdirSync(cwd, { recursive: true });
  writeFileSync(join(cwd, "CLAUDE.md"), "# Instrucoes Iniciais\n");
  runtime = spawn("node", [join(ROOT, "apps/runtime/dist/index.js")], { env: { ...process.env, MESS_DATA_DIR: dataDir, MESS_PORT: String(PORT), SHELL: "/bin/sh" }, stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { await sleep(250); try { token = readFileSync(join(dataDir, "runtime.token"), "utf8").trim(); up = (await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: { authorization: `Bearer ${token}` } })).ok; } catch { /* subindo */ } }
  if (!up) throw new Error(`runtime de teste não subiu na porta ${PORT}`);
  WS = ((await api("POST", "/v1/workspaces", { name: "ProjInstr", cwd })) as { workspaceId: string }).workspaceId;
  app = await electron.launch({ args: ["."], cwd: join(ROOT, "apps/desktop"), env: { ...process.env, MESS_DATA_DIR: dataDir, MESS_PORT: String(PORT) } });
  page = await app.firstWindow();
  await page.waitForSelector(".side li.ws:has-text('ProjInstr')"); await page.click(".side li.ws:has-text('ProjInstr')");
}, 60_000);
afterAll(async () => {
  await app?.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
  await app?.close().catch(() => {});
  try { runtime?.kill(); } catch { /* */ }
  for (let i = 0; i < 15 && runtime && runtime.exitCode === null; i++) await sleep(100);
  if (runtime && runtime.exitCode === null) { try { runtime.kill("SIGKILL"); } catch { /* */ } }
  rmSync(dataDir, { recursive: true, force: true });
});

describe("Arquivos de instrução CLAUDE.md / AGENTS.md (#76)", () => {
  it("abre pela paleta, mostra status 'Só CLAUDE.md existe', sincroniza para AGENTS.md e salva em ambos", async () => {
    await page.mouse.click(700, 60);
    await page.keyboard.press("Control+k");
    await page.fill('[data-testid="palette-input"]', "instrucoes");
    await page.waitForSelector('[data-testid="palette-item-action"]:has-text("Instruções do projeto")');
    await page.keyboard.press("Enter");
    await page.waitForSelector('[data-testid="instructions-panel"]');
    await page.waitForFunction(() => (document.querySelector('[data-testid="instr-status"]')?.textContent ?? "").includes("CLAUDE.md"));
    expect(await page.inputValue('[data-testid="instr-editor"]')).toContain("Instrucoes Iniciais");

    await page.click('[data-testid="instr-sync-c2a"]');
    await page.waitForFunction(() => (document.querySelector('[data-testid="instr-status"]')?.textContent ?? "").includes("Sincronizados"));
    expect(readFileSync(join(cwd, "AGENTS.md"), "utf8")).toContain("Instrucoes Iniciais");

    await page.fill('[data-testid="instr-editor"]', "# Novo Conteudo Comum\n");
    await page.click('[data-testid="instr-save-both"]');
    await page.waitForSelector('[data-testid="instr-msg"]:has-text("salvo em CLAUDE.md e AGENTS.md")');
    expect(readFileSync(join(cwd, "CLAUDE.md"), "utf8")).toBe("# Novo Conteudo Comum\n");
    expect(readFileSync(join(cwd, "AGENTS.md"), "utf8")).toBe("# Novo Conteudo Comum\n");
  });
});
