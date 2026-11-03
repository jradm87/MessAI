import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Workspace } from "@messai/contracts";

// #85 — Notificações do SO + mess notify + Preferências → Geral → Notificações.
const ROOT = join(import.meta.dirname, "../..");
const PORT = 48033;
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
  dataDir = mkdtempSync(join(tmpdir(), "mess-e2e-notify-"));
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

  wsId = ((await api("POST", "/v1/workspaces", { name: "NotifySpace", cwd: wsDir })) as Workspace).workspaceId;

  app = await electron.launch({
    args: ["."],
    cwd: join(ROOT, "apps/desktop"),
    env: { ...process.env, MESS_DATA_DIR: dataDir, MESS_PORT: String(PORT) },
  });
  page = await app.firstWindow();
  await page.waitForSelector(".side li.ws:has-text('NotifySpace')");
  await page.click(".side li.ws:has-text('NotifySpace')");
}, 45_000);

afterAll(async () => {
  await app?.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
  await app?.close().catch(() => {});
  try { runtime?.kill(); } catch { /* */ }
  for (let i = 0; i < 15 && runtime && runtime.exitCode === null; i++) await sleep(100);
  if (runtime && runtime.exitCode === null) { try { runtime.kill("SIGKILL"); } catch { /* */ } }
  rmSync(dataDir, { recursive: true, force: true });
});

describe("E2E #85 — Notificações do SO e Preferências de Notificação", () => {
  it("recebe notificação do runtime no processo principal e permite configurar toggles em Preferências", async () => {
    await api("POST", "/v1/notify", {
      text: "Build concluído com sucesso",
      title: "Agente E2E",
      workspaceId: wsId,
    });

    await sleep(300);
    const hist = await page.evaluate(() => window.messai.notifyHistory?.() ?? []);
    expect(hist.some((h) => h.title === "Agente E2E" && h.body === "Build concluído com sucesso")).toBe(true);

    // Abre Preferências → Geral → Notificações
    await page.click('[data-testid="settings"]');
    await page.waitForSelector('[data-testid="pref-notify-enabled"]');
    expect(await page.getAttribute('[data-testid="pref-notify-enabled"]', "aria-checked")).toBe("true");

    // Desliga notificações e verifica que nova notificação não é entregue ao SO
    await page.click('[data-testid="pref-notify-enabled"]');
    expect(await page.getAttribute('[data-testid="pref-notify-enabled"]', "aria-checked")).toBe("false");
    await page.click('[data-testid="prefs-close"]');

    await api("POST", "/v1/notify", {
      text: "Silenciada",
      title: "Agente Silenciado",
      workspaceId: wsId,
    });
    await sleep(250);
    const histAfter = await page.evaluate(() => window.messai.notifyHistory?.() ?? []);
    expect(histAfter.some((h) => h.title === "Agente Silenciado")).toBe(false);
  }, 30_000);
});
