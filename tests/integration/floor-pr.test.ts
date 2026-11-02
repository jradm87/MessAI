import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FloorPrState, GitHostEntry, Workspace } from "@messai/contracts";

const ROOT = join(import.meta.dirname, "../..");
const PORT = 48024;
let dir: string; let repo: string; let rt: ChildProcess; let token: string;
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const git = (...a: string[]) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", env: GIT_ENV }).trim();
const api = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : null });
  return { status: r.status, json: r.status === 204 ? null : await r.json() };
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "mess-floor-pr-"));
  repo = join(dir, "repo"); mkdirSync(repo);
  git("init", "-q", "-b", "main");
  git("remote", "add", "origin", "git@git.minhaempresa.local:time/core.git");
  writeFileSync(join(repo, "README.md"), "# core\n");
  git("add", "README.md"); git("commit", "-q", "-m", "init");

  rt = spawn("node", [join(ROOT, "apps/runtime/dist/index.js")], { env: { ...GIT_ENV, MESS_DATA_DIR: dir, MESS_PORT: String(PORT), SHELL: "/bin/sh" }, stdio: "ignore" });
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 200));
    try {
      token = readFileSync(join(dir, "runtime.token"), "utf8").trim();
      if ((await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: { authorization: `Bearer ${token}` } })).ok) break;
    } catch { /* subindo */ }
  }
}, 30_000);
afterAll(() => { rt?.kill(); rmSync(dir, { recursive: true, force: true }); });

describe("Pull request nos andares e hosts Git configuráveis (#31)", () => {
  let ground: Workspace;
  let floor: Workspace;

  it("configura hosts Git customizados e gera URL de comparação para o andar", async () => {
    const putHosts = await api("PUT", "/v1/git-hosts", {
      hosts: [
        { host: "git.minhaempresa.local", kind: "gitlab" },
      ],
    });
    expect(putHosts.status).toBe(200);
    expect(putHosts.json as GitHostEntry[]).toEqual([{ host: "git.minhaempresa.local", kind: "gitlab" }]);

    ground = (await api("POST", "/v1/workspaces", { name: "CoreApp", cwd: repo })).json as Workspace;
    floor = (await api("POST", `/v1/workspaces/${ground.workspaceId}/floors`, { name: "Feature OAuth", branch: "feat/oauth" })).json as Workspace;

    // Cria 1 commit no andar para ficar ahead=1
    writeFileSync(join(floor.cwd, "oauth.ts"), "export const oauth = true;\n");
    execFileSync("git", ["-C", floor.cwd, "add", "oauth.ts"], { env: GIT_ENV });
    execFileSync("git", ["-C", floor.cwd, "commit", "-q", "-m", "feat: oauth"], { env: GIT_ENV });

    const prRes = await api("GET", `/v1/workspaces/${floor.workspaceId}/pr`);
    expect(prRes.status).toBe(200);
    const pr = prRes.json as FloorPrState;
    expect(pr.state).toBe("none");
    expect(pr.host).toBe("git.minhaempresa.local");
    expect(pr.hostKind).toBe("gitlab");
    expect(pr.repoSlug).toBe("time/core");
    expect(pr.ahead).toBe(1);
    expect(pr.behind).toBe(0);
    expect(pr.compareUrl).toContain("https://git.minhaempresa.local/time/core/-/merge_requests/new?");
  });

  it("abre Pull Request do andar, atualiza selos de revisão/checks e executa merge rápido", async () => {
    const createRes = await api("POST", `/v1/workspaces/${floor.workspaceId}/pr`, {
      title: "feat: login com OAuth2",
      body: "Implementa fluxo OAuth2 no andar",
      draft: false,
    });
    expect(createRes.status).toBe(201);
    const created = createRes.json as FloorPrState;
    expect(created.state).toBe("open");
    expect(created.number).toBe(1);
    expect(created.title).toBe("feat: login com OAuth2");
    expect(created.reviewStatus).toBe("review_required");
    expect(created.checksStatus).toBe("passing");
    expect(created.url).toBe("https://git.minhaempresa.local/time/core/-/merge_requests/1");

    // O status do andar passa automaticamente para "review"
    const floorsAfterOpen = (await api("GET", `/v1/workspaces/${ground.workspaceId}/floors`)).json as Workspace[];
    expect(floorsAfterOpen.find((f) => f.workspaceId === floor.workspaceId)?.status).toBe("review");

    // Atualiza selos de revisão e checks e depois faz merge rápido
    const patchReview = await api("PATCH", `/v1/workspaces/${floor.workspaceId}/pr`, {
      reviewStatus: "changes_requested",
      checksStatus: "failing",
    });
    expect(patchReview.status).toBe(200);
    expect((patchReview.json as FloorPrState).reviewStatus).toBe("changes_requested");
    expect((patchReview.json as FloorPrState).checksStatus).toBe("failing");

    const mergeRes = await api("PATCH", `/v1/workspaces/${floor.workspaceId}/pr`, { action: "merge" });
    expect(mergeRes.status).toBe(200);
    const merged = mergeRes.json as FloorPrState;
    expect(merged.state).toBe("merged");
    expect(merged.reviewStatus).toBe("approved");
    expect(merged.checksStatus).toBe("passing");

    const floorsAfterMerge = (await api("GET", `/v1/workspaces/${ground.workspaceId}/floors`)).json as Workspace[];
    expect(floorsAfterMerge.find((f) => f.workspaceId === floor.workspaceId)?.status).toBe("done");
  });

  it("suporta `mess floor pr` e `mess floor hosts` pelo CLI", () => {
    const cli = join(ROOT, "apps/cli/dist/index.js");
    const envFloor = {
      ...process.env,
      MESS_SOCKET: join(dir, "agent.sock"),
      MESS_TOKEN: token,
      MESS_WORKSPACE_ID: floor.workspaceId,
    };
    const outStatus = execFileSync("node", [cli, "floor", "pr", "status"], { encoding: "utf8", env: envFloor }).trim();
    expect(outStatus).toContain('PR #1 [merged] "feat: login com OAuth2"');
    expect(outStatus).toContain("revisão=approved checks=passing");

    const outHosts = execFileSync("node", [cli, "floor", "hosts", "list"], { encoding: "utf8", env: envFloor }).trim();
    expect(outHosts).toContain("git.minhaempresa.local");
  });
});
