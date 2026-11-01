import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// #57/#38 — Preferências → Agentes com Electron real: Skills (criar e anexar pelo nó), Prompts (criar → compositor vê),
// Papéis (busca), Contas (lista + botão abre terminal de login), Uso (provedores, desligar some da barra).
const ROOT = join(import.meta.dirname, "../..");
const PORT = 47973;
let dataDir: string; let runtime: ChildProcess; let app: ElectronApplication; let page: Page; let token: string;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const api = async (method: string, path: string, body?: unknown) => (await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : null })).json();

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "mess-aprefs-"));
  mkdirSync(join(dataDir, "providers")); writeFileSync(join(dataDir, "providers", "meu.json"), JSON.stringify({ id: "meu", label: "Meu CLI", binary: "sh", color: "#123456" }));
  runtime = spawn("node", [join(ROOT, "apps/runtime/dist/index.js")], { env: { ...process.env, MESS_DATA_DIR: dataDir, MESS_PORT: String(PORT), SHELL: "/bin/sh" }, stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { await sleep(250); try { token = readFileSync(join(dataDir, "runtime.token"), "utf8").trim(); up = (await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: { authorization: `Bearer ${token}` } })).ok; } catch { /* subindo */ } }
  if (!up) throw new Error(`runtime de teste não subiu na porta ${PORT}`);
  app = await electron.launch({ args: ["."], cwd: join(ROOT, "apps/desktop"), env: { ...process.env, MESS_DATA_DIR: dataDir, MESS_PORT: String(PORT) } });
  page = await app.firstWindow();
  await page.waitForSelector(".side h1");
}, 60_000);

afterAll(async () => {
  await app?.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
  await app?.close().catch(() => {});
  try { runtime?.kill(); } catch { /* */ }
  for (let i = 0; i < 15 && runtime && runtime.exitCode === null; i++) await sleep(100);
  if (runtime && runtime.exitCode === null) { try { runtime.kill("SIGKILL"); } catch { /* */ } }
  rmSync(dataDir, { recursive: true, force: true });
}, 30_000);

const openAgents = async (sub: string) => {
  if (!(await page.locator('[data-testid="prefs"]').count())) { await page.click('[data-testid="settings"]'); await page.waitForSelector('[data-testid="prefs"]'); }
  await page.click('[data-testid="prefs-tab-agents"]');
  await page.click(`[data-testid="agents-tab-${sub}"]`);
};
const closePrefs = async () => { await page.keyboard.press("Escape"); await page.waitForSelector('[data-testid="prefs"]', { state: "detached" }); };

describe("Preferências → Agentes (#57/#38)", () => {
  it("Skills: cria pela aba; anexa pelo menu de papel do terminal; a pílula mostra +1 e o nó grava skillIds", async () => {
    await openAgents("skills");
    await page.click('[data-testid="skill-new"]');
    await page.fill('[data-testid="skill-name"]', "Revisão");
    await page.fill('[data-testid="skill-desc"]', "revisa PRs");
    await page.fill('[data-testid="skill-instr"]', "Revise com rigor.");
    await page.click('[data-testid="skill-save"]');
    await page.waitForSelector('[data-testid="skill-row"]:has-text("Revisão")');
    const skills = (await api("GET", "/v1/skills")) as { skillId: string; name: string }[];
    expect(skills.map((s) => s.name)).toEqual(["Revisão"]);
    await closePrefs();
    // terminal shell via API no espaço atual; anexa pela pílula
    const [ws] = (await api("GET", "/v1/workspaces")) as { workspaceId: string }[];
    const rev = ((await api("GET", `/v1/workspaces/${ws!.workspaceId}`)) as { workspace: { revision: number } }).workspace.revision;
    const r = (await api("POST", `/v1/workspaces/${ws!.workspaceId}/nodes`, { expectedRevision: rev, kind: "terminal", title: "Com skill", command: "/bin/sh", geometry: { x: 0, y: 0, w: 400, h: 300 } })) as { node: { nodeId: string } };
    const node = page.locator(`.react-flow__node[data-id="${r.node.nodeId}"]`);
    await node.locator(".st.running").waitFor({ state: "attached", timeout: 10_000 });
    await node.locator('[data-testid="role-pill"]').click();
    await node.locator(`[data-testid="skill-toggle-${skills[0]!.skillId}"]`).click();
    for (let i = 0; i < 30; i++) { const s = (await api("GET", `/v1/workspaces/${ws!.workspaceId}`)) as { nodes: { nodeId: string; skillIds?: string[] }[] }; if (s.nodes.find((n) => n.nodeId === r.node.nodeId)?.skillIds?.length) break; await sleep(150); }
    const snap = (await api("GET", `/v1/workspaces/${ws!.workspaceId}`)) as { nodes: { nodeId: string; skillIds?: string[] }[] };
    expect(snap.nodes.find((n) => n.nodeId === r.node.nodeId)!.skillIds).toEqual([skills[0]!.skillId]);
    await node.locator('[data-testid="role-pill"] .sk-count:has-text("+1")').waitFor({ state: "attached", timeout: 5000 });
    await page.mouse.move(5, 5); await sleep(200); // sai do menu (fecha no mouseLeave) para não cobrir a barra do nó
    await page.keyboard.press("Escape");
  }, 40_000);

  it("Prompts: criar na aba aparece no compositor; Papéis: busca filtra", async () => {
    await openAgents("prompts");
    await page.click('[data-testid="prompt-new"]');
    await page.fill('[data-testid="prompt-title"]', "Resumo diário");
    await page.fill('[data-testid="prompt-text"]', "Resuma o que você fez hoje em 5 linhas.");
    await page.click('[data-testid="prompt-save"]');
    await page.waitForSelector('[data-testid="prompt-row"]:has-text("Resumo diário")');
    expect(JSON.parse(await page.evaluate(() => localStorage.getItem("mess.prompts") ?? "[]") as string)).toEqual([{ title: "Resumo diário", text: "Resuma o que você fez hoje em 5 linhas." }]);
    // papéis: cria dois e filtra
    await api("POST", "/v1/roles", { name: "Revisor", instructions: "Revise." });
    await api("POST", "/v1/roles", { name: "Arquiteto", instructions: "Desenhe." });
    await page.click('[data-testid="agents-tab-roles"]');
    await page.waitForSelector('.roles-list .mi:has-text("Arquiteto")');
    await page.fill('[data-testid="role-search"]', "rev");
    await page.waitForSelector('.roles-list .mi:has-text("Arquiteto")', { state: "detached" });
    await page.waitForSelector('.roles-list .mi:has-text("Revisor")');
    await closePrefs();
    // compositor vê o prompt salvo
    const node = page.locator(".react-flow__node-terminal", { hasText: "Com skill" });
    await page.mouse.move(5, 5); await sleep(200);
    await node.locator(".term").click({ position: { x: 40, y: 40 } });
    await page.keyboard.press("Control+Shift+P");
    await page.waitForSelector('[data-testid="composer"]');
    await page.click('[data-testid="composer"] button[title="Prompts salvos"]');
    await page.waitForSelector(".cp-pop.prompts .mi:has-text('Resumo diário')");
    await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
  }, 40_000);

  it("Contas: 4 provedores com botão de login que abre um terminal; Uso: provedores (incl. extra) e desligar some da barra", async () => {
    await openAgents("accounts");
    for (const id of ["claude", "codex", "opencode", "antigravity"]) await page.waitForSelector(`[data-testid="acc-${id}"]`);
    await page.click('[data-testid="acc-login-codex"]');
    await page.waitForSelector('[data-testid="prefs"]', { state: "detached" }); // fecha e cria o terminal de login
    await page.locator(".react-flow__node-terminal", { hasText: "Codex · login" }).waitFor({ timeout: 10_000 });
    await openAgents("usage");
    await page.waitForSelector('[data-testid="prov-claude"]');
    await page.waitForSelector('[data-testid="prov-meu"]:has-text("Meu CLI")'); // extra via JSON
    expect(await page.locator('[data-testid="prov-meu"] small').textContent()).toMatch(/\/sh$/);
    // barra inferior: há ícone de uso enquanto ligado; desligar some
    await closePrefs();
    expect(await page.locator('[data-testid="bb-usage"], [data-testid="bb-agent"]').count()).toBeGreaterThan(0);
    await openAgents("usage");
    await page.click('[data-testid="usage-enabled"]');
    await page.waitForSelector('[data-testid="usage-enabled"][aria-checked="false"]');
    await closePrefs();
    expect(await page.locator('[data-testid="bb-usage"], [data-testid="bb-agent"]').count()).toBe(0);
    expect(JSON.parse(await page.evaluate(() => localStorage.getItem("mess.prefs") ?? "{}") as string)).toMatchObject({ usageEnabled: false, agentsSub: "usage" });
  }, 40_000);
});
