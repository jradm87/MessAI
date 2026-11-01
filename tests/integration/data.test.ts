import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// #62 — Dados: estatísticas, backup consistente (VACUUM INTO + notas + manifesto), restaurar volta ao estado do backup,
// reset apaga só o que deve, mover grava o ponteiro ~/.messai/datadir e o runtime seguinte sobe na pasta nova.
const ROOT = join(import.meta.dirname, "../..");
const PORT = 47979;
let dir: string; let rt: ChildProcess; let token: string;
const H = (json = false) => ({ authorization: `Bearer ${token}`, ...(json ? { "content-type": "application/json" } : {}) });
const api = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: H(body !== undefined), body: body !== undefined ? JSON.stringify(body) : null });
  return { status: r.status, json: r.status === 204 ? null : await r.json().catch(() => null) };
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const up = async (port = PORT) => { try { return (await fetch(`http://127.0.0.1:${port}/v1/health`, { headers: H() })).ok; } catch { return false; } };
const boot = async (env: NodeJS.ProcessEnv, port = PORT, tokenDir = dir) => { const p = spawn("node", [join(ROOT, "apps/runtime/dist/index.js")], { env: { ...process.env, MESS_PORT: String(port), SHELL: "/bin/sh", ...env }, stdio: "ignore" }); for (let i = 0; i < 50; i++) { await sleep(200); try { token = readFileSync(join(tokenDir, "runtime.token"), "utf8").trim(); if (await up(port)) break; } catch { /* subindo */ } } return p; };
const waitDown = async (port = PORT) => { for (let i = 0; i < 40; i++) { if (!(await up(port))) return true; await sleep(150); } return false; };
type Ws = { workspaceId: string; name: string };
const names = async () => ((await api("GET", "/v1/workspaces")).json as Ws[]).map((w) => w.name).sort();

beforeAll(async () => { dir = mkdtempSync(join(tmpdir(), "mess-datat-")); rt = await boot({ MESS_DATA_DIR: dir }); }, 30_000);
afterAll(() => { try { rt?.kill("SIGKILL"); } catch { /* */ } rmSync(dir, { recursive: true, force: true }); });

describe("dados (#62)", () => {
  it("GET /v1/data: pasta, origem env, tamanhos e contagens; backup cria pasta consistente com manifesto; apagar backup", async () => {
    const ws = (await api("POST", "/v1/workspaces", { name: "A", cwd: dir })).json as Ws;
    await api("POST", `/v1/workspaces/${ws.workspaceId}/nodes`, { expectedRevision: 0, kind: "note", title: "Nota A", content: "conteúdo da nota A", geometry: { x: 0, y: 0, w: 200, h: 100 } });
    const d = (await api("GET", "/v1/data")).json as { dir: string; source: string; bytes: number; dbBytes: number; counts: { workspaces: number; nodes: number; notes: number }; backups: unknown[]; backupsDir: string };
    expect(d).toMatchObject({ dir, source: "env" }); expect(d.bytes).toBeGreaterThan(0); expect(d.dbBytes).toBeGreaterThan(0);
    expect(d.counts.notes).toBe(1); expect(d.counts.workspaces).toBeGreaterThanOrEqual(2); // padrão + A
    expect(d.backups).toEqual([]);
    const b = (await api("POST", "/v1/data/backup")).json as { name: string; path: string; bytes: number; manifest: { counts: { notes: number }; buildVersion: number } };
    expect(b.name).toMatch(/^messai-backup-\d{8}-\d{6}$/); expect(b.path).toBe(join(d.backupsDir, b.name));
    expect(existsSync(join(b.path, "runtime.sqlite"))).toBe(true); expect(existsSync(join(b.path, "manifest.json"))).toBe(true); expect(existsSync(join(b.path, "notes"))).toBe(true);
    expect(b.manifest.counts.notes).toBe(1); expect(b.bytes).toBeGreaterThan(0);
    expect(((await api("GET", "/v1/data")).json as { backups: { name: string }[] }).backups.map((x) => x.name)).toEqual([b.name]);
    // destino escolhido fora do padrão
    const other = join(dir, "meus-backups"); mkdirSync(other);
    const b2 = (await api("POST", "/v1/data/backup", { dir: other })).json as { path: string };
    expect(b2.path.startsWith(other)).toBe(true);
    expect((await api("POST", "/v1/data/backup", { dir: "relativo" })).status).toBe(400);
    expect((await api("DELETE", `/v1/data/backups/${b.name}`)).status).toBe(204);
    expect([400, 404]).toContain((await api("DELETE", "/v1/data/backups/../x")).status); // o Fastify normaliza o caminho (404) e o handler recusa nomes fora do padrão (400)
    expect(((await api("GET", "/v1/data")).json as { backups: unknown[] }).backups).toEqual([]);
  }, 30_000);

  it("restaurar exige confirmação e backup válido; volta ao estado do backup (espaço criado depois some); reset apaga tudo e mantém token", async () => {
    const before = await names(); expect(before).toContain("A");
    const b = (await api("POST", "/v1/data/backup")).json as { path: string };
    await api("POST", "/v1/workspaces", { name: "B-depois", cwd: dir });
    expect(await names()).toContain("B-depois");
    expect((await api("POST", "/v1/data/restore", { path: b.path })).status).toBe(400); // sem confirm
    expect((await api("POST", "/v1/data/restore", { path: join(dir, "nao-existe"), confirm: "RESTAURAR" })).status).toBe(400); // não é backup
    expect((await api("POST", "/v1/data/restore", { path: b.path, confirm: "RESTAURAR" })).status).toBe(202);
    expect(await waitDown()).toBe(true); // o runtime sai depois de restaurar
    rt = await boot({ MESS_DATA_DIR: dir });
    expect(await names()).toEqual(before); // B-depois sumiu, A voltou
    // reset
    const tokenBefore = readFileSync(join(dir, "runtime.token"), "utf8");
    expect((await api("POST", "/v1/data/reset", { confirm: "apagar" })).status).toBe(400); // literal exato
    expect((await api("POST", "/v1/data/reset", { confirm: "APAGAR" })).status).toBe(202);
    expect(await waitDown()).toBe(true);
    expect(existsSync(join(dir, "runtime.sqlite"))).toBe(false); expect(existsSync(join(dir, "notes"))).toBe(false);
    expect(existsSync(join(dir, "backups", b.path.split("/").pop()!))).toBe(true); // backups ficam
    rt = await boot({ MESS_DATA_DIR: dir });
    expect(readFileSync(join(dir, "runtime.token"), "utf8")).toBe(tokenBefore); // identidade mantida
    const n = await names(); expect(n).not.toContain("A"); expect(n.length).toBe(1); // só o espaço padrão novo
  }, 60_000);

  it("mover: bloqueado com MESS_DATA_DIR; sem env, copia para a pasta nova, grava o ponteiro e o próximo boot usa a nova", async () => {
    expect((await api("POST", "/v1/data/move", { dir: join(dir, "nova"), confirm: "MOVER" })).status).toBe(400); // origem env
    // runtime 2 com HOME próprio e SEM MESS_DATA_DIR → pasta padrão <home>/.messai
    const home = mkdtempSync(join(tmpdir(), "mess-home-")); const PORT2 = 47981; const def = join(home, ".messai");
    const prevToken = token;
    const env2 = { HOME: home, MESS_DATA_DIR: "" } as NodeJS.ProcessEnv; delete (env2 as Record<string, unknown>)["MESS_DATA_DIR"];
    let rt2 = await boot({ HOME: home, MESS_DATA_DIR: undefined as unknown as string }, PORT2, def);
    try {
      const api2 = async (method: string, path: string, body?: unknown) => { const r = await fetch(`http://127.0.0.1:${PORT2}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : null }); return { status: r.status, json: await r.json().catch(() => null) }; };
      expect(((await api2("GET", "/v1/data")).json as { dir: string; source: string })).toMatchObject({ dir: def, source: "default" });
      await api2("POST", "/v1/workspaces", { name: "Movido", cwd: home });
      const target = join(home, "dados-novos");
      expect((await api2("POST", "/v1/data/move", { dir: join(def, "dentro"), confirm: "MOVER" })).status).toBe(400); // dentro da atual
      expect((await api2("POST", "/v1/data/move", { dir: target, confirm: "MOVER" })).status).toBe(202);
      expect(await waitDown(PORT2)).toBe(true);
      expect(readFileSync(join(def, "datadir"), "utf8").trim()).toBe(target);
      expect(existsSync(join(target, "runtime.sqlite"))).toBe(true); expect(existsSync(join(target, "runtime.token"))).toBe(true);
      expect(existsSync(join(def, "runtime.sqlite"))).toBe(true); // a antiga fica
      rt2 = await boot({ HOME: home, MESS_DATA_DIR: undefined as unknown as string }, PORT2, target);
      const d2 = (await api2("GET", "/v1/data")).json as { dir: string; source: string };
      expect(d2).toMatchObject({ dir: target, source: "pointer" });
      expect(((await api2("GET", "/v1/workspaces")).json as Ws[]).map((w) => w.name)).toContain("Movido");
    } finally { try { rt2.kill("SIGKILL"); } catch { /* */ } rmSync(home, { recursive: true, force: true }); token = prevToken; }
  }, 60_000);
});
