import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

// #93 [MESS-09] — modo isolado com bubblewrap de VERDADE: ambiente limpo, nada fora do cwd, sistema somente leitura, .git/hooks protegido,
// rede none × host, CLI `mess` funcionando dentro do sandbox, aprovações humanas e guardas contra fuga por um agente isolado.
const ROOT = join(import.meta.dirname, "../..");
const PORT = 48031; const PORT2 = 48033;
let dir: string; let rt: ChildProcess; let token: string;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const H = (json = false, tk = () => token) => ({ authorization: `Bearer ${tk()}`, ...(json ? { "content-type": "application/json" } : {}) });
const call = async (port: number, tk: string, method: string, path: string, body?: unknown) => { const r = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { authorization: `Bearer ${tk}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : null }); const t = await r.text(); return { status: r.status, json: t ? JSON.parse(t) : null }; };
const api = (method: string, path: string, body?: unknown) => call(PORT, token, method, path, body);
const waitFor = async <T,>(fn: () => T | null | false | undefined | Promise<T | null | false | undefined>, ms = 15_000): Promise<T> => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v as T; if (Date.now() - t > ms) throw new Error("timeout waitFor"); await sleep(150); } };
const bwrapOk = (() => { try { execFileSync("bwrap", ["--unshare-user", "--ro-bind", "/usr", "/usr", "--symlink", "usr/bin", "/bin", "--symlink", "usr/lib", "/lib", "--symlink", "usr/lib64", "/lib64", "--proc", "/proc", "--dev", "/dev", "--", "/usr/bin/true"], { stdio: "ignore" }); return true; } catch { return false; } })();
const boot = async (port: number, dataDir: string, env: NodeJS.ProcessEnv) => { const p = spawn(process.execPath, [join(ROOT, "apps/runtime/dist/index.js")], { env: { ...process.env, MESS_DATA_DIR: dataDir, MESS_PORT: String(port), SHELL: "/bin/sh", ...env }, stdio: "ignore" }); let tk = ""; for (let i = 0; i < 60; i++) { await sleep(200); try { tk = readFileSync(join(dataDir, "runtime.token"), "utf8").trim(); if ((await fetch(`http://127.0.0.1:${port}/v1/health`, { headers: { authorization: `Bearer ${tk}` } })).ok) break; } catch { /* subindo */ } } return { p, tk }; };

/** Espaço com cwd próprio (git init para ter .git/hooks e .git/config) e um nó terminal rodando `probe.sh`. */
async function mkProbe(name: string, iso: unknown, scriptBody: string) {
  const cwd = join(dir, `proj-${name}`); mkdirSync(cwd, { recursive: true });
  execFileSync("git", ["init", "-q", cwd], { env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" } });
  const script = join(dir, "scripts", `${name}.sh`); mkdirSync(join(dir, "scripts"), { recursive: true });
  writeFileSync(script, `#!/bin/bash\nexec > result.txt 2>&1\n${scriptBody}\ntouch done\nsleep 60\n`); chmodSync(script, 0o755);
  const ws = (await api("POST", "/v1/workspaces", { name, cwd })).json as { workspaceId: string };
  const r = (await api("POST", `/v1/workspaces/${ws.workspaceId}/nodes`, { expectedRevision: 0, kind: "terminal", title: name, command: script, geometry: { x: 0, y: 0, w: 400, h: 300 }, ...(iso ? { isolation: iso } : {}) })).json as { node: { nodeId: string }; session: { sessionId: string } };
  return { cwd, ws: ws.workspaceId, nodeId: r.node.nodeId, sessionId: r.session.sessionId, result: async () => { await waitFor(() => existsSync(join(cwd, "done")), 20_000); return readFileSync(join(cwd, "result.txt"), "utf8"); } };
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "mess-iso-"));
  mkdirSync(join(dir, "secret"), { recursive: true }); writeFileSync(join(dir, "secret", "outside.txt"), "segredo-fora");
  ({ p: rt, tk: token } = await boot(PORT, dir, { MESS_TEST_SECRET: "topsecret", MESS_OLLAMA_URL: "http://127.0.0.1:1" }));
  if (!token) throw new Error("runtime não subiu");
}, 40_000);
afterAll(() => { try { rt?.kill("SIGKILL"); } catch { /* */ } rmSync(dir, { recursive: true, force: true }); });

const PROBE = `echo "env=\${MESS_TEST_SECRET:-vazio}"
echo "home=$HOME"
echo "ler-fora=$(cat ${"${SECRET}"} 2>&1 | head -1)"
touch /usr/x 2>/dev/null && echo "escreve-usr=sim" || echo "escreve-usr=nao"
touch ${"${SIBLING}"}/x 2>/dev/null && echo "escreve-fora=sim" || echo "escreve-fora=nao"
echo ok > inside.txt && echo "escreve-cwd=sim"
echo x > .git/hooks/pre-commit 2>/dev/null && echo "hooks=gravou" || echo "hooks=protegido"
echo x >> .git/config 2>/dev/null && echo "gitconfig=gravou" || echo "gitconfig=protegido"
(exec 3<>/dev/tcp/127.0.0.1/${"${PORT}"}) 2>/dev/null && echo "rede=aberta" || echo "rede=bloqueada"
echo "procs=$(ls /proc | grep -c '^[0-9]')"
mess nodes 2>&1 | head -3`;
const probeBody = (port: number, cwdHint = "") => PROBE.replace("${SECRET}", join(dir, "secret", "outside.txt")).replace("${SIBLING}", join(dir, "secret")).replace("${PORT}", String(port)) + cwdHint;

describe.skipIf(!bwrapOk)("modo isolado (#93)", () => {
  it("GET /v1/isolation: disponível; terminal CONFIÁVEL de controle enxerga tudo (prova que o teste é significativo)", async () => {
    expect(((await api("GET", "/v1/isolation")).json as { available: boolean }).available).toBe(true);
    const t = await mkProbe("trusted", undefined, probeBody(PORT));
    const out = await t.result();
    expect(out).toContain("env=topsecret"); expect(out).toContain("ler-fora=segredo-fora"); expect(out).toContain("escreve-fora=sim"); expect(out).toContain("hooks=gravou"); expect(out).toContain("rede=aberta");
  }, 40_000);

  it("terminal ISOLADO (rede none): ambiente limpo, nada fora do cwd, sistema só leitura, hooks/config protegidos, sem rede, poucos processos, CLI funciona", async () => {
    const t = await mkProbe("isolado", { network: "none" }, probeBody(PORT));
    const out = await t.result();
    expect(out).toContain("env=vazio"); // o segredo do ambiente do runtime NÃO chega
    expect(out).toContain("home=/home/agent");
    expect(out).toMatch(/ler-fora=.*(No such file|Permission denied)/); expect(out).not.toContain("segredo-fora");
    expect(out).toContain("escreve-usr=nao"); expect(out).toContain("escreve-fora=nao");
    expect(out).toContain("escreve-cwd=sim"); expect(readFileSync(join(t.cwd, "inside.txt"), "utf8").trim()).toBe("ok"); // gravou de verdade no cwd real
    expect(out).toContain("hooks=protegido"); expect(out).toContain("gitconfig=protegido");
    expect(existsSync(join(t.cwd, ".git/hooks/pre-commit"))).toBe(false);
    expect(out).toContain("rede=bloqueada");
    expect(Number(/procs=(\d+)/.exec(out)![1])).toBeLessThan(15); // pid namespace próprio (o host tem centenas)
    expect(out).toContain("isolado"); // `mess nodes` dentro do sandbox lista o próprio nó: socket + credencial + CLI funcionam
  }, 40_000);

  it("rede host: o terminal isolado ALCANÇA a rede (mas continua sem arquivos nem segredos de fora)", async () => {
    const t = await mkProbe("isohost", { network: "host" }, probeBody(PORT));
    const out = await t.result();
    expect(out).toContain("rede=aberta"); expect(out).toContain("env=vazio"); expect(out).toContain("escreve-fora=nao");
  }, 40_000);

  it("caminhos liberados: rw/ro do nó e das configurações globais aparecem no sandbox; o home e a raiz são recusados", async () => {
    const extra = join(dir, "extra-rw"); mkdirSync(extra); writeFileSync(join(extra, "a.txt"), "do-extra");
    const ro = join(dir, "extra-ro"); mkdirSync(ro); writeFileSync(join(ro, "b.txt"), "so-leitura");
    const t = await mkProbe("liberados", { network: "none", rw: [extra], ro: [ro] }, `cat ${extra}/a.txt; echo novo > ${extra}/n.txt && echo "rw-grava=sim"; cat ${ro}/b.txt; echo x > ${ro}/c.txt 2>/dev/null && echo "ro-grava=sim" || echo "ro-grava=nao"`);
    const out = await t.result();
    expect(out).toContain("do-extra"); expect(out).toContain("rw-grava=sim"); expect(readFileSync(join(extra, "n.txt"), "utf8").trim()).toBe("novo");
    expect(out).toContain("so-leitura"); expect(out).toContain("ro-grava=nao");
    // validações: nunca a raiz/home/ancestral
    const mk = async (iso: unknown) => (await api("POST", `/v1/workspaces/${t.ws}/nodes`, { expectedRevision: ((await api("GET", `/v1/workspaces/${t.ws}`)).json as { workspace: { revision: number } }).workspace.revision, kind: "terminal", title: "x", command: "/bin/sh", geometry: { x: 0, y: 0, w: 100, h: 100 }, isolation: iso })).status;
    expect(await mk({ network: "none", rw: ["/"] })).toBe(400); expect(await mk({ network: "none", ro: [homedir()] })).toBe(400); expect(await mk({ network: "none", rw: ["relativo"] })).toBe(400);
    expect((await api("PATCH", "/v1/settings", { isolationRw: [homedir()] })).status).toBe(400);
    const okSet = (await api("PATCH", "/v1/settings", { isolationRo: [ro] })).json as { isolationRo?: string[] }; expect(okSet.isolationRo).toEqual([ro]);
    await api("PATCH", "/v1/settings", { isolationRo: [] });
  }, 40_000);

  it("aprovação humana: agente isolado leva 403 sem a capacidade, PEDE com `mess request`, o usuário aprova e passa a valer sem reiniciar; capacidade perigosa nem é aprovável", async () => {
    const t = await mkProbe("aprova", { network: "none" }, `mess note write NotaAntes texto > antes.txt 2>&1
mess request workspace:manage "quero criar hooks" > perigosa.txt 2>&1
mess request nodes:write "criar nota do plano" --wait 40 > pedido.txt 2>&1
mess note write NotaDepois texto > depois.txt 2>&1`);
    const pending = await waitFor(async () => ((await api("GET", "/v1/approvals?status=pending")).json as { approvalId: string; capability: string; nodeTitle: string; reason: string }[]).find((a) => a.capability === "nodes:write"));
    expect(pending).toMatchObject({ nodeTitle: "aprova", reason: "criar nota do plano" });
    expect(((await api("GET", "/v1/attention")).json as { kind: string; nodeId: string }[]).some((a) => a.kind === "approval" && a.nodeId === t.nodeId)).toBe(true); // aparece na atenção global
    expect(((await api("POST", `/v1/approvals/${pending.approvalId}/decide`, { approve: true })).json as { status: string }).status).toBe("approved");
    expect((await api("POST", `/v1/approvals/${pending.approvalId}/decide`, { approve: false })).status).toBe(409); // já decidido
    const out = await t.result();
    const read = (f: string) => readFileSync(join(t.cwd, f), "utf8");
    expect(read("antes.txt")).toMatch(/capacidade|FORBIDDEN|nodes:write/i); // antes: negado
    expect(read("perigosa.txt")).toMatch(/não pode ser concedida|FORBIDDEN/i); // workspace:manage não é aprovável para isolado
    expect(read("pedido.txt")).toContain("APROVADO");
    expect(read("depois.txt")).not.toMatch(/FORBIDDEN|capacidade/i);
    const nodes = ((await api("GET", `/v1/workspaces/${t.ws}`)).json as { nodes: { title: string }[] }).nodes.map((n) => n.title);
    expect(nodes).toContain("NotaDepois"); expect(nodes).not.toContain("NotaAntes");
    void out;
  }, 60_000);

  it("guardas de fuga: com credencial do agente isolado (mesmo com nodes:write) NÃO cria/duplica terminal, NÃO altera o próprio isolamento/Maestro; negar não concede", async () => {
    const t = await mkProbe("fuga", { network: "none" }, "sleep 1");
    const tk = (await api("POST", `/v1/nodes/${t.nodeId}/token`, { capabilities: ["nodes:read", "nodes:write", "files:read"] })).json as { token: string };
    const me = (id: string, m: string, p: string, b?: unknown) => call(PORT, tk.token, m, p, b);
    const rev = async () => ((await api("GET", `/v1/workspaces/${t.ws}`)).json as { workspace: { revision: number } }).workspace.revision;
    expect((await me(t.ws, "POST", `/v1/workspaces/${t.ws}/nodes`, { expectedRevision: await rev(), kind: "terminal", title: "evil", command: "/bin/sh", geometry: { x: 0, y: 0, w: 100, h: 100 } })).status).toBe(403);
    expect((await me(t.ws, "POST", `/v1/workspaces/${t.ws}/nodes`, { expectedRevision: await rev(), kind: "note", title: "ok", content: "", geometry: { x: 0, y: 0, w: 100, h: 100 } })).status).toBe(201); // nota pode (tem nodes:write)
    expect((await me(t.nodeId, "POST", `/v1/nodes/${t.nodeId}/duplicate`, { expectedRevision: await rev() })).status).toBe(403);
    expect((await me(t.nodeId, "PATCH", `/v1/nodes/${t.nodeId}`, { expectedRevision: await rev(), isolation: null })).status).toBe(403); // não se solta do sandbox
    expect((await me(t.nodeId, "PATCH", `/v1/nodes/${t.nodeId}`, { expectedRevision: await rev(), maestro: true })).status).toBe(403);
    expect((await me(t.nodeId, "PATCH", `/v1/nodes/${t.nodeId}`, { expectedRevision: await rev(), memLimitMb: 0 })).status).toBe(403);
    expect((await me(t.nodeId, "GET", "/v1/approvals")).status).toBe(403); // lista de pedidos é só do app
    // o app pode: soltar o isolamento reinicia e muda o modo
    const n = (await api("PATCH", `/v1/nodes/${t.nodeId}`, { expectedRevision: await rev(), isolation: null })).json as { isolation?: unknown };
    expect(n.isolation).toBeUndefined();
    // pedido negado não concede
    const t2 = await mkProbe("nega", { network: "none" }, "sleep 20");
    const tk2 = (await api("POST", `/v1/nodes/${t2.nodeId}/token`, {})).json as { token: string };
    const ap = (await call(PORT, tk2.token, "POST", "/v1/approvals", { capability: "nodes:write", reason: "x" })).json as { approvalId: string; status: string };
    expect(ap.status).toBe("pending");
    expect(((await call(PORT, tk2.token, "POST", "/v1/approvals", { capability: "nodes:write" })).json as { approvalId: string }).approvalId).toBe(ap.approvalId); // mesmo pedido pendente: reaproveita
    await api("POST", `/v1/approvals/${ap.approvalId}/decide`, { approve: false });
    expect(((await call(PORT, tk2.token, "GET", `/v1/approvals/${ap.approvalId}`)).json as { status: string }).status).toBe("denied");
    expect((await call(PORT, tk2.token, "POST", `/v1/workspaces/${t2.ws}/nodes`, { expectedRevision: ((await api("GET", `/v1/workspaces/${t2.ws}`)).json as { workspace: { revision: number } }).workspace.revision, kind: "note", title: "n", content: "", geometry: { x: 0, y: 0, w: 1, h: 1 } })).status).toBe(403);
    // o PATCH acima reiniciou o terminal `fuga` (credencial antiga revogada): emite outra e confirma que outro terminal não lê o pedido alheio
    const other = (await api("POST", `/v1/nodes/${t.nodeId}/token`, {})).json as { token: string };
    expect((await call(PORT, other.token, "GET", `/v1/approvals/${ap.approvalId}`)).status).toBe(403);
  }, 60_000);

  it("shell padrão (/bin/sh, caminho por link do sistema) isolado SOBE e continua rodando (regressão: /bin é link usr-merged, não montável)", async () => {
    const cwd = join(dir, "proj-sh"); mkdirSync(cwd, { recursive: true });
    const ws = (await api("POST", "/v1/workspaces", { name: "sh", cwd })).json as { workspaceId: string };
    const r = (await api("POST", `/v1/workspaces/${ws.workspaceId}/nodes`, { expectedRevision: 0, kind: "terminal", title: "sh", command: "/bin/sh", isolation: { network: "none" }, geometry: { x: 0, y: 0, w: 100, h: 100 } })).json as { session: { sessionId: string } };
    await sleep(1500);
    expect(((await api("GET", `/v1/sessions/${r.session.sessionId}`)).json as { state: string }).state).toBe("running");
  }, 30_000);

  it("persistente (tmux por fora do bwrap) também isola; sem bwrap o terminal NÃO sobe sem isolamento (falha fechada, 501)", async () => {
    const hasTmux = (() => { try { execFileSync("tmux", ["-V"], { stdio: "ignore" }); return true; } catch { return false; } })();
    if (hasTmux) {
      const cwd = join(dir, "proj-tmux"); mkdirSync(cwd, { recursive: true });
      const script = join(dir, "scripts", "tmuxprobe.sh"); writeFileSync(script, `#!/bin/bash\necho "env=\${MESS_TEST_SECRET:-vazio}" > ${cwd}/r.txt\nsleep 20\n`); chmodSync(script, 0o755);
      const ws = (await api("POST", "/v1/workspaces", { name: "tmuxiso", cwd })).json as { workspaceId: string };
      const r = await api("POST", `/v1/workspaces/${ws.workspaceId}/nodes`, { expectedRevision: 0, kind: "terminal", title: "tmuxiso", command: script, persistent: true, isolation: { network: "none" }, geometry: { x: 0, y: 0, w: 100, h: 100 } });
      expect(r.status).toBe(201);
      expect((await waitFor(() => existsSync(join(cwd, "r.txt")) && readFileSync(join(cwd, "r.txt"), "utf8"), 15_000)).trim()).toBe("env=vazio");
    }
    // runtime sem bwrap no PATH
    const d2 = mkdtempSync(join(tmpdir(), "mess-iso2-"));
    const { p, tk } = await boot(PORT2, d2, { PATH: "/nonexistent" });
    try {
      expect(((await call(PORT2, tk, "GET", "/v1/isolation")).json as { available: boolean; reason?: string })).toMatchObject({ available: false });
      const ws = (await call(PORT2, tk, "POST", "/v1/workspaces", { name: "sem", cwd: d2 })).json as { workspaceId: string };
      const r = await call(PORT2, tk, "POST", `/v1/workspaces/${ws.workspaceId}/nodes`, { expectedRevision: 0, kind: "terminal", title: "t", command: "/bin/sh", isolation: { network: "none" }, geometry: { x: 0, y: 0, w: 100, h: 100 } });
      expect(r.status).toBe(501); expect(JSON.stringify(r.json)).toMatch(/bubblewrap|bwrap/i);
    } finally { try { p.kill("SIGKILL"); } catch { /* */ } rmSync(d2, { recursive: true, force: true }); }
  }, 60_000);
});
