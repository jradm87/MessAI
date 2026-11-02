import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// #76 Arquivos de instrução do projeto (CLAUDE.md / AGENTS.md) sincronizados.
const ROOT = join(import.meta.dirname, "../..");
const PORT = 48014;
let dir: string; let rt: ChildProcess; let token: string;
const H = () => ({ authorization: `Bearer ${token}`, "content-type": "application/json" });
const api = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: H(), body: body ? JSON.stringify(body) : null });
  return { status: r.status, json: r.status === 204 ? null : await r.json() };
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "mess-int-"));
  rt = spawn("node", [join(ROOT, "apps/runtime/dist/index.js")], { env: { ...process.env, MESS_DATA_DIR: dir, MESS_PORT: String(PORT), SHELL: "/bin/sh" }, stdio: "ignore" });
  for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 200)); try { token = readFileSync(join(dir, "runtime.token"), "utf8").trim(); if ((await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: H() })).ok) break; } catch { /* subindo */ } }
}, 30_000);
afterAll(() => { rt?.kill(); rmSync(dir, { recursive: true, force: true }); });

describe("#76 instruções do projeto (CLAUDE.md / AGENTS.md)", () => {
  let ws: string, cwd: string;
  it("detecta quando nenhum existe (missing) e quando só um existe", async () => {
    cwd = join(dir, "proj"); mkdirSync(cwd, { recursive: true });
    ws = ((await api("POST", "/v1/workspaces", { name: "Instr", cwd })).json as { workspaceId: string }).workspaceId;
    const r0 = (await api("GET", `/v1/workspaces/${ws}/instructions`)).json as { status: string; claude: { exists: boolean }; agents: { exists: boolean } };
    expect(r0.status).toBe("missing");
    expect(r0.claude.exists).toBe(false); expect(r0.agents.exists).toBe(false);

    writeFileSync(join(cwd, "CLAUDE.md"), "# Regras\nUse pt-BR.\n");
    const r1 = (await api("GET", `/v1/workspaces/${ws}/instructions`)).json as { status: string; claude: { exists: boolean; text: string } };
    expect(r1.status).toBe("only-claude");
    expect(r1.claude.text).toContain("Use pt-BR.");
  });
  it("sincroniza CLAUDE.md → AGENTS.md e detecta divergência quando mudam", async () => {
    const s1 = (await api("POST", `/v1/workspaces/${ws}/instructions/sync`, { direction: "claude-to-agents" })).json as { status: string; agents: { exists: boolean; text: string } };
    expect(s1.status).toBe("synced");
    expect(readFileSync(join(cwd, "AGENTS.md"), "utf8")).toContain("Use pt-BR.");

    await api("PUT", `/v1/workspaces/${ws}/instructions`, { target: "AGENTS.md", text: "# Outras regras\n" });
    const s2 = (await api("GET", `/v1/workspaces/${ws}/instructions`)).json as { status: string };
    expect(s2.status).toBe("diverged");

    const s3 = (await api("POST", `/v1/workspaces/${ws}/instructions/sync`, { direction: "agents-to-claude" })).json as { status: string; claude: { text: string } };
    expect(s3.status).toBe("synced");
    expect(s3.claude.text).toBe("# Outras regras\n");
  });
  it("salvar em 'both' grava nos dois arquivos ao mesmo tempo", async () => {
    const r = (await api("PUT", `/v1/workspaces/${ws}/instructions`, { target: "both", text: "# Unificado\n123\n" })).json as { status: string };
    expect(r.status).toBe("synced");
    expect(readFileSync(join(cwd, "CLAUDE.md"), "utf8")).toBe("# Unificado\n123\n");
    expect(readFileSync(join(cwd, "AGENTS.md"), "utf8")).toBe("# Unificado\n123\n");
  });
});
