import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Workspace } from "@messai/contracts";

// #83 — Exportar/importar espaço (.messai) com tela de revisão e duplicar espaço na barra lateral.
const ROOT = join(import.meta.dirname, "../..");
const PORT = 48029;
let dataDir: string;
let runtime: ChildProcess;
let app: ElectronApplication;
let page: Page;
let token: string;
let wsId: string;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const api = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : null,
  });
  return r.status === 204 ? null : r.json();
};

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "mess-e2e-wsx-"));
  const wsDir = join(dataDir, "ws");
  mkdirSync(wsDir);

  runtime = spawn("node", [join(ROOT, "apps/runtime/dist/index.js")], {
    env: { ...process.env, MESS_DATA_DIR: dataDir, MESS_PORT: String(PORT), SHELL: "/bin/sh" },
    stdio: "ignore",
  });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    await sleep(250);
    try {
      token = readFileSync(join(dataDir, "runtime.token"), "utf8").trim();
      up = (await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: { authorization: `Bearer ${token}` } })).ok;
    } catch { /* subindo */ }
  }
  if (!up) throw new Error(`runtime de teste não subiu na porta ${PORT}`);

  wsId = ((await api("POST", "/v1/workspaces", { name: "AlphaSpace", cwd: wsDir })) as Workspace).workspaceId;
  await api("POST", `/v1/workspaces/${wsId}/nodes`, {
    expectedRevision: 0,
    kind: "note",
    title: "Nota Portátil",
    geometry: { x: 60, y: 60, w: 260, h: 160 },
    content: "# Nota Portátil\nConteúdo exportado",
  });

  app = await electron.launch({
    args: ["."],
    cwd: join(ROOT, "apps/desktop"),
    env: { ...process.env, MESS_DATA_DIR: dataDir, MESS_PORT: String(PORT) },
  });
  page = await app.firstWindow();
  await page.waitForSelector(".side li.ws:has-text('AlphaSpace')");
  await page.click(".side li.ws:has-text('AlphaSpace')");
}, 60_000);

afterAll(async () => {
  await app?.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
  await app?.close().catch(() => {});
  try { runtime?.kill(); } catch { /* */ }
  for (let i = 0; i < 15 && runtime && runtime.exitCode === null; i++) await sleep(100);
  if (runtime && runtime.exitCode === null) { try { runtime.kill("SIGKILL"); } catch { /* */ } }
  rmSync(dataDir, { recursive: true, force: true });
});

describe("Exportar/importar espaço (.messai) e duplicar na interface (#83)", () => {
  it("duplica um espaço pelo menu de contexto, exporta (.messai) e importa após tela de revisão", async () => {
    // 1. Duplicar espaço pelo menu de contexto da sidebar
    await page.click(".side li.ws:has-text('AlphaSpace')", { button: "right" });
    await page.waitForSelector('[data-testid="ctx-ws-duplicate"]');
    await page.click('[data-testid="ctx-ws-duplicate"]');
    await page.waitForSelector(".side li.ws:has-text('AlphaSpace (cópia)')");

    // 2. Exportar espaço (.messai) pelo menu de contexto
    await page.click(".side li.ws:has-text('AlphaSpace')", { button: "right" });
    await page.waitForSelector('[data-testid="ctx-ws-export"]');
    await page.click('[data-testid="ctx-ws-export"]');
    await page.waitForSelector('[data-testid="export-ws-json"]');
    const exportedJson = await page.inputValue('[data-testid="export-ws-json"]');
    expect(exportedJson).toContain('"messai.workspace.v1"');
    expect(exportedJson).toContain('"Nota Portátil"');
    await page.keyboard.press("Escape");

    // 3. Importar espaço (.messai) com tela de revisão
    await page.click('[data-testid="ws-import"]');
    await page.waitForSelector('[data-testid="import-json-input"]');
    await page.fill('[data-testid="import-json-input"]', exportedJson);
    await page.click('[data-testid="import-preview-btn"]');

    await page.waitForSelector('[data-testid="import-review"]');
    expect(await page.textContent('[data-testid="import-node-titles"]')).toContain("Nota Portátil (note)");

    await page.fill('[data-testid="import-ws-name"]', "BetaImportado");
    await page.click('[data-testid="import-confirm-btn"]');

    await page.waitForSelector(".side li.ws:has-text('BetaImportado')");
  });
});
