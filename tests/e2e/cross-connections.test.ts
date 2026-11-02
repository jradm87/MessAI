import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConnectedPeer, Node, Workspace } from "@messai/contracts";

// #82 — Conexões entre andares e entre espaços pela UI do terminal.
const ROOT = join(import.meta.dirname, "../..");
const PORT = 48023;
let dataDir: string; let runtime: ChildProcess; let app: ElectronApplication; let page: Page; let token: string;
let wsA: Workspace; let wsB: Workspace; let nodeA: Node; let nodeB: Node;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const api = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : null });
  return r.status === 204 ? null : r.json();
};

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "mess-e2e-cross-"));
  const dirA = join(dataDir, "a"); const dirB = join(dataDir, "b");
  mkdirSync(dirA); mkdirSync(dirB);

  runtime = spawn("node", [join(ROOT, "apps/runtime/dist/index.js")], { env: { ...process.env, MESS_DATA_DIR: dataDir, MESS_PORT: String(PORT), SHELL: "/bin/sh" }, stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    await sleep(250);
    try {
      token = readFileSync(join(dataDir, "runtime.token"), "utf8").trim();
      up = (await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: { authorization: `Bearer ${token}` } })).ok;
    } catch { /* subindo */ }
  }
  if (!up) throw new Error(`runtime de teste não subiu na porta ${PORT}`);

  wsA = (await api("POST", "/v1/workspaces", { name: "EspacoAlpha", cwd: dirA })) as Workspace;
  wsB = (await api("POST", "/v1/workspaces", { name: "EspacoBeta", cwd: dirB })) as Workspace;
  nodeA = ((await api("POST", `/v1/workspaces/${wsA.workspaceId}/nodes`, {
    expectedRevision: 0, kind: "terminal", title: "TermAlpha", geometry: { x: 40, y: 40, w: 460, h: 280 },
  })) as { node: Node }).node;
  nodeB = ((await api("POST", `/v1/workspaces/${wsB.workspaceId}/nodes`, {
    expectedRevision: 0, kind: "terminal", title: "TermBeta", geometry: { x: 40, y: 40, w: 460, h: 280 },
  })) as { node: Node }).node;

  app = await electron.launch({ args: ["."], cwd: join(ROOT, "apps/desktop"), env: { ...process.env, MESS_DATA_DIR: dataDir, MESS_PORT: String(PORT) } });
  page = await app.firstWindow();
  await page.waitForSelector(".side li.ws:has-text('EspacoAlpha')");
  await page.click(".side li.ws:has-text('EspacoAlpha')");
}, 60_000);

afterAll(async () => {
  await app?.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
  await app?.close().catch(() => {});
  try { runtime?.kill(); } catch { /* */ }
  for (let i = 0; i < 15 && runtime && runtime.exitCode === null; i++) await sleep(100);
  if (runtime && runtime.exitCode === null) { try { runtime.kill("SIGKILL"); } catch { /* */ } }
  rmSync(dataDir, { recursive: true, force: true });
});

describe("Conexões entre espaços na interface (#82)", () => {
  it("abre o painel de conexões entre andares/espaços no terminal e conecta a TermBeta @ EspacoBeta", async () => {
    await page.waitForSelector('[data-testid="node-cross-link-btn"]');
    await page.click('[data-testid="node-cross-link-btn"]');
    await page.waitForSelector('[data-testid="cross-link-panel"]');

    await page.waitForSelector(`[data-testid="cross-connect-${nodeB.nodeId}"]`);
    await page.click(`[data-testid="cross-connect-${nodeB.nodeId}"]`);

    await page.waitForSelector('[data-testid="cross-peer-pill"]');
    expect(await page.textContent('[data-testid="cross-peer-pill"]')).toContain("TermBeta @ EspacoBeta");

    const peers = (await api("GET", `/v1/nodes/${nodeA.nodeId}/connected`)) as ConnectedPeer[];
    expect(peers.some((p) => p.node.nodeId === nodeB.nodeId && p.crossWorkspace)).toBe(true);
  });
});
