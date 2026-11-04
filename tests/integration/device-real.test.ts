import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// #73 — validação contra um emulador/aparelho Android REAL (opt-in): rode com um emulador já ligado e
//   MESS_TEST_ADB_SERIAL=emulator-5554 npx vitest run tests/integration/device-real.test.ts
// (opcional MESS_TEST_AVD=<nome do AVD que já está rodando> para provar o reaproveitamento). Não instala nada nem altera dados do aparelho:
// só abre Configurações, digita na busca, rola e volta.
const SERIAL = process.env["MESS_TEST_ADB_SERIAL"]; const AVD = process.env["MESS_TEST_AVD"];
const ROOT = join(import.meta.dirname, "../..");
const PORT = 48045;
let dir: string; let rt: ChildProcess; let token: string;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const api = async (method: string, path: string, body?: unknown) => { const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : null }); const t = await r.text(); return { status: r.status, json: t ? JSON.parse(t) : null }; };
const waitFor = async <T,>(fn: () => T | null | false | undefined | Promise<T | null | false | undefined>, ms = 20_000): Promise<T> => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v as T; if (Date.now() - t > ms) throw new Error("timeout waitFor"); await sleep(250); } };
type UiNode = { text: string; desc: string; cls: string; pkg: string; clickable: boolean; bounds: { x1: number; y1: number; x2: number; y2: number } };
const center = (n: UiNode) => ({ x: (n.bounds.x1 + n.bounds.x2) / 2, y: (n.bounds.y1 + n.bounds.y2) / 2 });

beforeAll(async () => {
  if (!SERIAL) return;
  dir = mkdtempSync(join(tmpdir(), "mess-device-real-"));
  rt = spawn(process.execPath, [join(ROOT, "apps/runtime/dist/index.js")], { env: { ...process.env, MESS_DATA_DIR: dir, MESS_PORT: String(PORT), SHELL: "/bin/sh" }, stdio: "ignore" });
  for (let i = 0; i < 60; i++) { await sleep(200); try { token = readFileSync(join(dir, "runtime.token"), "utf8").trim(); if ((await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: { authorization: `Bearer ${token}` } })).ok) break; } catch { /* subindo */ } }
}, 40_000);
afterAll(() => { try { rt?.kill("SIGKILL"); } catch { /* */ } if (dir) rmSync(dir, { recursive: true, force: true }); });

describe.skipIf(!SERIAL)("dispositivo Android REAL (opt-in)", () => {
  it("liga, captura a tela de verdade, lê a árvore de UI, abre Configurações, busca digitando, rola e volta", async () => {
    const ws = ((await api("POST", "/v1/workspaces", { name: "real", cwd: dir })).json as { workspaceId: string }).workspaceId;
    const nd = (await api("POST", `/v1/workspaces/${ws}/nodes`, { expectedRevision: 0, kind: "device", geometry: { x: 0, y: 0, w: 360, h: 640 } })).json as { node: { nodeId: string } }; const id = nd.node.nodeId;
    const act = (a: Record<string, unknown>) => api("POST", `/v1/devices/${id}/act`, a);
    const ui = async () => ((await api("GET", `/v1/devices/${id}/ui`)).json as { nodes: UiNode[] }).nodes;
    const sel = await act({ action: "select", serial: SERIAL }); expect(sel.status, JSON.stringify(sel.json)).toBe(200);
    expect(sel.json.state).toMatchObject({ status: "connected", serial: SERIAL }); expect(sel.json.state.width).toBeGreaterThan(300); expect(sel.json.state.height).toBeGreaterThan(300);
    const shot = (await api("GET", `/v1/devices/${id}/screenshot`)).json as { data: string; width: number; height: number }; const png = Buffer.from(shot.data, "base64");
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a"); expect(png.length).toBeGreaterThan(5000); expect(shot.width).toBe(sel.json.state.width); expect(shot.height).toBe(sel.json.state.height);
    await act({ action: "key", key: "home" }); await sleep(1200);
    expect((await ui()).length).toBeGreaterThan(3);
    const apps = (await api("GET", `/v1/devices/${id}/apps`)).json as string[]; expect(Array.isArray(apps)).toBe(true);
    // abre Configurações e confere o app em primeiro plano
    expect((await act({ action: "launch", package: "com.android.settings" })).status).toBe(200);
    await waitFor(async () => ((await api("GET", `/v1/devices/${id}`)).json as { foreground?: string }).foreground?.startsWith("com.android.settings/"));
    // toca na busca e digita (ASCII), a árvore de UI mostra o que foi digitado
    const search = await waitFor(async () => (await ui()).find((n) => /search/i.test(n.text) || /search/i.test(n.desc)));
    const c = center(search); expect((await act({ action: "tap", x: c.x, y: c.y })).status).toBe(200); await sleep(1500);
    expect((await act({ action: "text", text: "wifi" })).status).toBe(200);
    await waitFor(async () => (await ui()).some((n) => n.text.toLowerCase() === "wifi"), 15_000);
    await act({ action: "key", key: "back" }); await act({ action: "key", key: "back" }); await sleep(800);
    // rolar muda a tela
    const before = ((await api("GET", `/v1/devices/${id}/screenshot`)).json as { data: string }).data;
    const w = sel.json.state.width as number, h = sel.json.state.height as number;
    expect((await act({ action: "swipe", x1: w / 2, y1: h * 0.75, x2: w / 2, y2: h * 0.25, ms: 400 })).status).toBe(200); await sleep(1200);
    expect(((await api("GET", `/v1/devices/${id}/screenshot`)).json as { data: string }).data).not.toBe(before);
    expect((await act({ action: "stop", package: "com.android.settings" })).status).toBe(200); await act({ action: "key", key: "home" });
    // reconexão pelo serial salvo depois de desligar o nó do aparelho
    expect(((await act({ action: "disconnect" })).json as { state: { status: string } }).state.status).toBe("stopped");
    expect((await act({ action: "key", key: "home" })).json.state).toMatchObject({ status: "connected", serial: SERIAL });
    // injeção continua recusada com adb de verdade
    expect((await act({ action: "launch", package: "com.android.settings; reboot" })).status).toBe(400);
    expect((await act({ action: "text", text: "olá" })).status).toBe(400);
    // shutdown de aparelho que NÃO foi iniciado por nós é recusado (não derruba o emulador do usuário)
    expect((await act({ action: "shutdown" })).status).toBe(400);
  }, 180_000);

  it.skipIf(!AVD)("boot do AVD que já está rodando ATACHA (não sobe segundo emulador) e mantém tudo intacto", async () => {
    const ws = ((await api("POST", "/v1/workspaces", { name: "real2", cwd: dir })).json as { workspaceId: string }).workspaceId;
    const nd = (await api("POST", `/v1/workspaces/${ws}/nodes`, { expectedRevision: 0, kind: "device", geometry: { x: 0, y: 0, w: 360, h: 640 } })).json as { node: { nodeId: string } };
    const t0 = Date.now(); const r = await api("POST", `/v1/devices/${nd.node.nodeId}/act`, { action: "boot", avd: AVD });
    expect(r.status, JSON.stringify(r.json)).toBe(200); expect(r.json.state).toMatchObject({ status: "connected", serial: SERIAL, avd: AVD }); expect(Date.now() - t0).toBeLessThan(30_000);
  }, 60_000);
});
