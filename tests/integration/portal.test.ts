import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// #26 — portais com Chromium REAL: o runtime dirige o navegador por CDP (pipe); ações por API/CLI, segurança de URL, ciclo de vida do
// processo, persistência da URL sem mexer na revisão, autorização por capacidade e stream de quadros para o app.
const ROOT = join(import.meta.dirname, "../..");
const PORT = 48038; const PAGES = 48039; const PORT2 = 48040;
let dir: string; let tmp: string; let rt: ChildProcess; let token: string; let pages: Server;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const call = async (port: number, tk: string, method: string, path: string, body?: unknown) => { const r = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { authorization: `Bearer ${tk}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : null }); const t = await r.text(); return { status: r.status, json: t ? JSON.parse(t) : null }; };
const api = (method: string, path: string, body?: unknown) => call(PORT, token, method, path, body);
const waitFor = async <T,>(fn: () => T | null | false | undefined | Promise<T | null | false | undefined>, ms = 15_000): Promise<T> => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v as T; if (Date.now() - t > ms) throw new Error("timeout waitFor"); await sleep(150); } };
const hasBrowser = (() => { for (const b of ["google-chrome-stable", "google-chrome", "chromium", "chromium-browser", "brave-browser"]) { try { execFileSync("which", [b], { stdio: "ignore" }); return true; } catch { /* próximo */ } } return false; })();
const bwrapOk = (() => { try { execFileSync("bwrap", ["--unshare-user", "--ro-bind", "/usr", "/usr", "--symlink", "usr/bin", "/bin", "--symlink", "usr/lib", "/lib", "--symlink", "usr/lib64", "/lib64", "--proc", "/proc", "--dev", "/dev", "--", "/usr/bin/true"], { stdio: "ignore" }); return true; } catch { return false; } })();
const browserProcs = () => { try { return Number(execFileSync("pgrep", ["-fc", "--", `--user-data-dir=${tmp}/mess-portal-.*--remote-debugging-pipe|--remote-debugging-pipe.*--user-data-dir=${tmp}/mess-portal-`], { encoding: "utf8" }).trim()); } catch { return 0; } };
const profiles = () => readdirSync(tmp).filter((f) => f.startsWith("mess-portal-")).length;
const boot = async (port: number, dataDir: string, env: NodeJS.ProcessEnv) => { const p = spawn(process.execPath, [join(ROOT, "apps/runtime/dist/index.js")], { env: { ...process.env, MESS_DATA_DIR: dataDir, MESS_PORT: String(port), SHELL: "/bin/sh", TMPDIR: tmp, ...env }, stdio: "ignore" }); let tk = ""; for (let i = 0; i < 60; i++) { await sleep(200); try { tk = readFileSync(join(dataDir, "runtime.token"), "utf8").trim(); if ((await fetch(`http://127.0.0.1:${port}/v1/health`, { headers: { authorization: `Bearer ${tk}` } })).ok) break; } catch { /* subindo */ } } return { p, tk }; };

const PAGE = (u: string) => {
  if (u.startsWith("/page2")) return `<title>Página dois</title><h1>Dois</h1><p id=who>cheguei</p>`;
  if (u.startsWith("/search")) return `<title>Busca</title><p id=q>q=${new URL(u, "http://x").searchParams.get("q")}</p>`;
  return `<title>Casa</title><h1>Olá portal</h1><a href="/page2">ir para dois</a>
<form action="/search"><input name=q placeholder="buscar"><button id=go>Buscar</button></form>
<button id=pop onclick="window.open('/page2')">popup</button><button id=al onclick="document.title='alertou'+alert('oi')">alerta</button>
<button id=file onclick="location.href='file:///etc/hostname'">arquivo</button><div style="height:4000px">alto</div>`;
};
const created: string[] = [];
afterEach(async () => { for (const id of created.splice(0)) await call(PORT, token, "POST", `/v1/portals/${id}/act`, { action: "close" }).catch(() => {}); }); // um teste que falha no meio não deixa navegadores vazando para o seguinte
let n = 0;
const mkPortal = async (name: string, url = "", wsId?: string) => {
  const ws = wsId ?? ((await api("POST", "/v1/workspaces", { name: `${name}-${++n}`, cwd: dir })).json as { workspaceId: string }).workspaceId;
  const rev = ((await api("GET", `/v1/workspaces/${ws}`)).json as { workspace: { revision: number } }).workspace.revision;
  const r = await api("POST", `/v1/workspaces/${ws}/nodes`, { expectedRevision: rev, kind: "portal", title: name, geometry: { x: 0, y: 0, w: 500, h: 400 }, content: JSON.stringify({ url }) });
  if (r.status === 201) created.push((r.json as { node: { nodeId: string } }).node.nodeId);
  return { ws, status: r.status, json: r.json, nodeId: (r.json as { node?: { nodeId: string } })?.node?.nodeId as string };
};
const act = (nodeId: string, a: Record<string, unknown>) => api("POST", `/v1/portals/${nodeId}/act`, a);
type St = { status: string; url: string; title: string; loading: boolean; canGoBack: boolean; canGoForward: boolean; width: number; height: number; watchers: number; error?: string };

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "mess-portal-test-")); tmp = join(dir, "tmp"); mkdirSync(tmp);
  pages = createServer((req, res) => { res.setHeader("content-type", "text/html; charset=utf-8"); res.end(PAGE(req.url ?? "/")); });
  await new Promise<void>((r) => pages.listen(PAGES, "127.0.0.1", r));
  ({ p: rt, tk: token } = await boot(PORT, join(dir, "data"), {}));
  if (!token) throw new Error("runtime não subiu");
}, 40_000);
afterAll(async () => {
  try { rt?.kill("SIGKILL"); } catch { /* */ } pages?.close();
  try { execFileSync("pkill", ["-9", "-f", `--user-data-dir=${tmp}`], { stdio: "ignore" }); } catch { /* nenhum */ }
  await sleep(300);
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* o SO limpa /tmp; limpeza não reprova a suíte */ }
}, 30_000);

describe("portais: validação sem navegador", () => {
  it("URL do conteúdo é normalizada; esquemas perigosos recusados na criação e no PATCH", async () => {
    for (const bad of ["file:///etc/passwd", "javascript:alert(1)", "data:text/html,<b>x</b>", "chrome://settings", "https://u:p@a.b"]) expect((await mkPortal("bad", bad)).status, bad).toBe(400);
    const ok = await mkPortal("ok", "exemplo.com/x"); expect(ok.status).toBe(201); expect(JSON.parse((ok.json as { node: { content: string } }).node.content).url).toBe("https://exemplo.com/x");
    const rev = ((await api("GET", `/v1/workspaces/${ok.ws}`)).json as { workspace: { revision: number } }).workspace.revision;
    expect((await api("PATCH", `/v1/nodes/${ok.nodeId}`, { expectedRevision: rev, content: JSON.stringify({ url: "file:///etc/passwd" }) })).status).toBe(400);
    expect(((await api("GET", `/v1/portals/${ok.nodeId}`)).json as St)).toMatchObject({ status: "stopped", url: "https://exemplo.com/x" }); // não abre navegador só por consultar
    expect((await api("GET", "/v1/portals/nao-existe")).status).toBe(404);
    const t0 = Date.now(); const act0 = await act(ok.nodeId, { action: "navigate", url: "file:///etc/passwd" });
    expect(act0.status).toBe(400); expect(act0.json.error.message).toMatch(/esquema não permitido/); expect(Date.now() - t0).toBeLessThan(2000); // recusa ANTES de abrir o navegador (nem tenta ir à URL salva)
    expect(((await api("GET", `/v1/portals/${ok.nodeId}`)).json as St).status).toBe("stopped"); // e continua sem navegador
  });
});

describe.skipIf(!hasBrowser)("portais com Chromium real", () => {
  it("navegar, snapshot com refs, digitar+enviar, voltar/avançar, clicar por ref e por coordenada, tecla, rolagem", async () => {
    const p = await mkPortal("web"); const id = p.nodeId;
    const r1 = await act(id, { action: "navigate", url: `127.0.0.1:${PAGES}/` }); expect(r1.status, JSON.stringify(r1.json)).toBe(200);
    expect(r1.json.state).toMatchObject({ status: "running", title: "Casa", loading: false }); expect(r1.json.state.url).toBe(`http://127.0.0.1:${PAGES}/`);
    const snap = (await api("GET", `/v1/portals/${id}/snapshot`)).json as { title: string; text: string; elements: { ref: number; tag: string; name: string; href?: string; rect: { w: number } }[] };
    expect(snap.title).toBe("Casa"); expect(snap.text).toContain("Olá portal");
    const link = snap.elements.find((e) => e.tag === "a")!; const input = snap.elements.find((e) => e.tag === "input")!;
    expect(link).toMatchObject({ name: "ir para dois" }); expect(link.href).toBe(`http://127.0.0.1:${PAGES}/page2`); expect(link.rect.w).toBeGreaterThan(0);
    const t = await act(id, { action: "type", ref: input.ref, text: "gatos", submit: true }); expect(t.json.state.url).toBe(`http://127.0.0.1:${PAGES}/search?q=gatos`);
    expect((await api("GET", `/v1/portals/${id}/snapshot`)).json.text).toContain("q=gatos");
    const b = await act(id, { action: "back" }); expect(b.json.state).toMatchObject({ url: `http://127.0.0.1:${PAGES}/`, canGoForward: true });
    expect((await act(id, { action: "forward" })).json.state.url).toContain("/search?q=gatos"); await act(id, { action: "back" });
    const s2 = (await api("GET", `/v1/portals/${id}/snapshot`)).json as typeof snap;
    const c = await act(id, { action: "click", ref: s2.elements.find((e) => e.tag === "a")!.ref }); expect(c.json.state).toMatchObject({ url: `http://127.0.0.1:${PAGES}/page2`, title: "Página dois" });
    await act(id, { action: "back" });
    const lk = s2.elements.find((e) => e.tag === "a")!.rect; // clique por coordenada no mesmo link
    expect((await act(id, { action: "click", x: lk.x + lk.w / 2, y: lk.y + lk.h / 2 })).json.state.url).toContain("/page2"); await act(id, { action: "back" });
    expect((await act(id, { action: "click", ref: 9999 })).status).toBe(400); // ref inexistente → erro claro
    await act(id, { action: "scroll", dy: 600 }); await sleep(200);
    expect((await act(id, { action: "eval", expression: "window.scrollY" })).json.value).toBeGreaterThan(100);
    const inp = (await api("GET", `/v1/portals/${id}/snapshot`)).json.elements.find((e: { tag: string }) => e.tag === "input");
    await act(id, { action: "type", ref: inp.ref, text: "abc", clear: true }); await act(id, { action: "key", key: "Backspace" }); // clear: o formulário restaura o "gatos" de antes do back
    expect((await act(id, { action: "eval", expression: "document.querySelector('input').value" })).json.value).toBe("ab");
    expect((await act(id, { action: "key", key: "NaoExiste" })).status).toBe(400);
  }, 90_000);

  it("eval (valor, erro), inspect (modo design), waitForText, screenshot PNG, viewport", async () => {
    const p = await mkPortal("ev", `http://127.0.0.1:${PAGES}/`); const id = p.nodeId;
    await waitFor(async () => (await act(id, { action: "eval", expression: "document.readyState" })).json?.value === "complete"); // abre o navegador na URL salva
    expect((await act(id, { action: "eval", expression: "({a: 1, b: [2, 3]})" })).json.value).toEqual({ a: 1, b: [2, 3] });
    expect((await act(id, { action: "eval", expression: "Promise.resolve(40 + 2)" })).json.value).toBe(42);
    const bad = await act(id, { action: "eval", expression: "naoExiste.x" }); expect(bad.status).toBe(400); expect(bad.json.error.message).toMatch(/erro no script/);
    expect((await act(id, { action: "eval", expression: "'x'.repeat(200000)" })).status).toBe(400); // resultado enorme recusado
    const ins = (await act(id, { action: "inspect", x: 40, y: 30 })).json.value as { tag: string; selector: string; text: string; html: string };
    expect(ins.tag).toBe("h1"); expect(ins.text).toBe("Olá portal"); expect(ins.selector).toContain("h1"); expect(ins.html).toContain("<h1>");
    expect((await act(id, { action: "waitForText", text: "Olá portal", timeoutMs: 2000 })).json.ok).toBe(true);
    const miss = await act(id, { action: "waitForText", text: "jamais-aparece", timeoutMs: 400 }); expect(miss.status).toBe(200); expect(miss.json.ok).toBe(false); expect(miss.json.message).toMatch(/não apareceu/);
    const shot = (await api("GET", `/v1/portals/${id}/screenshot`)).json as { mime: string; data: string }; const png = Buffer.from(shot.data, "base64");
    expect(shot.mime).toBe("image/png"); expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a"); expect(png.length).toBeGreaterThan(1000);
    await act(id, { action: "viewport", width: 640, height: 480 });
    expect((await act(id, { action: "eval", expression: "[innerWidth, innerHeight]" })).json.value).toEqual([640, 480]);
    expect(((await api("GET", `/v1/portals/${id}`)).json as St)).toMatchObject({ width: 640, height: 480 });
  }, 60_000);

  it("segurança: file:/javascript:/data: recusados; JS que tenta ir a file: não escapa; popup abre na própria aba; alert não trava", async () => {
    const p = await mkPortal("seg", `http://127.0.0.1:${PAGES}/`); const id = p.nodeId;
    await waitFor(async () => (await act(id, { action: "eval", expression: "document.readyState" })).json?.value === "complete");
    for (const u of ["file:///etc/passwd", "javascript:alert(1)", "data:text/html,<script>1</script>", "chrome://version", "view-source:http://127.0.0.1/"]) expect((await act(id, { action: "navigate", url: u })).status, u).toBe(400);
    const ref = (name: string) => (async () => ((await api("GET", `/v1/portals/${id}/snapshot`)).json as { elements: { ref: number; name: string }[] }).elements.find((e) => e.name === name)!.ref)();
    await act(id, { action: "click", ref: await ref("arquivo") }); await sleep(600); // o script faz location = file:///…
    const st = (await api("GET", `/v1/portals/${id}`)).json as St; expect(st.url.startsWith("file:")).toBe(false);
    expect((await act(id, { action: "eval", expression: "location.protocol" })).json.value).not.toBe("file:");
    await act(id, { action: "navigate", url: `http://127.0.0.1:${PAGES}/` });
    await act(id, { action: "click", ref: await ref("popup") }); // window.open → na própria aba
    await waitFor(async () => ((await api("GET", `/v1/portals/${id}`)).json as St).url.endsWith("/page2"));
    await act(id, { action: "navigate", url: `http://127.0.0.1:${PAGES}/` });
    const al = await act(id, { action: "click", ref: await ref("alerta") }); expect(al.status).toBe(200); // alert() é dispensado, a página segue viva
    expect((await act(id, { action: "eval", expression: "1+1" })).json.value).toBe(2);
  }, 60_000);

  it("a URL atual é gravada no nó SEM mexer na revisão do espaço; reabrir (close) volta na URL salva", async () => {
    const p = await mkPortal("persist"); const id = p.nodeId;
    const revBefore = ((await api("GET", `/v1/workspaces/${p.ws}`)).json as { workspace: { revision: number } }).workspace.revision;
    await act(id, { action: "navigate", url: `http://127.0.0.1:${PAGES}/page2` });
    const snap = async () => (await api("GET", `/v1/workspaces/${p.ws}`)).json as { workspace: { revision: number }; nodes: { nodeId: string; content: string }[] };
    await waitFor(async () => JSON.parse((await snap()).nodes.find((x) => x.nodeId === id)!.content).url === `http://127.0.0.1:${PAGES}/page2`);
    expect((await snap()).workspace.revision).toBe(revBefore);
    await act(id, { action: "close" }); expect(((await api("GET", `/v1/portals/${id}`)).json as St).status).toBe("stopped");
    const again = await act(id, { action: "eval", expression: "location.href" }); expect(again.json.value).toBe(`http://127.0.0.1:${PAGES}/page2`);
  }, 60_000);

  it("ciclo de vida: apagar o nó e apagar o espaço matam o navegador e o perfil temporário; limite de sessões simultâneas", async () => {
    const base = browserProcs(), baseProf = profiles();
    const a = await mkPortal("vida", `http://127.0.0.1:${PAGES}/`);
    await waitFor(async () => (await act(a.nodeId, { action: "eval", expression: "1" })).status === 200);
    expect(browserProcs()).toBeGreaterThan(base); expect(profiles()).toBeGreaterThan(baseProf);
    const rev = ((await api("GET", `/v1/workspaces/${a.ws}`)).json as { workspace: { revision: number } }).workspace.revision;
    expect((await api("DELETE", `/v1/nodes/${a.nodeId}`, { expectedRevision: rev })).status).toBe(204);
    await waitFor(() => browserProcs() === base && profiles() === baseProf, 10_000);
    const b = await mkPortal("vida2", `http://127.0.0.1:${PAGES}/`); await act(b.nodeId, { action: "eval", expression: "1" });
    expect((await api("DELETE", `/v1/workspaces/${b.ws}`)).status).toBe(204);
    await waitFor(() => browserProcs() === base && profiles() === baseProf, 10_000);
    // limite de 6 abertos ao mesmo tempo: o 7º recebe 501 claro
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) { const q = await mkPortal(`lim${i}`); ids.push(q.nodeId); expect((await act(q.nodeId, { action: "eval", expression: "1" })).status, `portal ${i}`).toBe(200); }
    const sete = await mkPortal("lim7"); const r7 = await act(sete.nodeId, { action: "eval", expression: "1" });
    expect(r7.status).toBe(501); expect(r7.json.error.message).toMatch(/limite/);
    for (const id of ids) await act(id, { action: "close" });
    await waitFor(() => browserProcs() === base, 10_000);
  }, 120_000);

  it("autorização: agente com portals:control dirige; sem a capacidade 403; de outro espaço 403; isolado nunca (nem por aprovação)", async () => {
    const p = await mkPortal("auth", `http://127.0.0.1:${PAGES}/`);
    const term = async (ws: string, extra: Record<string, unknown> = {}) => { const rev = ((await api("GET", `/v1/workspaces/${ws}`)).json as { workspace: { revision: number } }).workspace.revision; return ((await api("POST", `/v1/workspaces/${ws}/nodes`, { expectedRevision: rev, kind: "terminal", title: "ag", command: "/bin/sleep", args: ["60"], geometry: { x: 0, y: 0, w: 100, h: 100 }, ...extra })).json as { node: { nodeId: string } }).node.nodeId; };
    const tn = await term(p.ws);
    const full = ((await api("POST", `/v1/nodes/${tn}/token`, {})).json as { token: string }).token; // padrão do agente confiável inclui portals:control
    expect((await call(PORT, full, "POST", `/v1/portals/${p.nodeId}/act`, { action: "eval", expression: "2+3" })).json.value).toBe(5);
    expect((await call(PORT, full, "GET", `/v1/portals/${p.nodeId}/snapshot`)).status).toBe(200);
    const limited = ((await api("POST", `/v1/nodes/${tn}/token`, { capabilities: ["nodes:read", "files:read"] })).json as { token: string }).token;
    expect((await call(PORT, limited, "POST", `/v1/portals/${p.nodeId}/act`, { action: "eval", expression: "1" })).status).toBe(403);
    expect((await call(PORT, limited, "GET", `/v1/portals/${p.nodeId}`)).status).toBe(403);
    const otherWs = ((await api("POST", "/v1/workspaces", { name: "outro", cwd: dir })).json as { workspaceId: string }).workspaceId; const tn2 = await term(otherWs);
    const foreign = ((await api("POST", `/v1/nodes/${tn2}/token`, {})).json as { token: string }).token;
    expect((await call(PORT, foreign, "POST", `/v1/portals/${p.nodeId}/act`, { action: "eval", expression: "1" })).status).toBe(403); // escopo: outro térreo
    if (bwrapOk) {
      const iso = await term(p.ws, { isolation: { network: "none" } });
      const it = ((await api("POST", `/v1/nodes/${iso}/token`, {})).json as { token: string }).token;
      expect((await call(PORT, it, "POST", `/v1/portals/${p.nodeId}/act`, { action: "eval", expression: "1" })).status).toBe(403);
      const ap = await call(PORT, it, "POST", "/v1/approvals", { capability: "portals:control", reason: "quero navegar" });
      expect(ap.status).toBe(403); expect(JSON.stringify(ap.json)).toMatch(/não pode ser concedida|FORBIDDEN/i); // sair do sandbox pela rede nem é pedido aprovável
    }
  }, 60_000);

  it("stream para o app: portalWatch entrega quadros JPEG + estado; portalUnwatch/fechar o socket zera os observadores", async () => {
    const p = await mkPortal("watch", `http://127.0.0.1:${PAGES}/`); const id = p.nodeId;
    const msgs: { type: string; data?: string; width?: number; state?: St }[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/v1/ws?token=${token}`);
    await new Promise<void>((res, rej) => { ws.onopen = () => res(); ws.onerror = () => rej(new Error("ws")); });
    ws.onmessage = (e) => msgs.push(JSON.parse(String(e.data)));
    ws.send(JSON.stringify({ type: "portalWatch", nodeId: id }));
    const frame = await waitFor(() => msgs.find((m) => m.type === "portalFrame"), 20_000);
    expect(frame.data!.startsWith("/9j/")).toBe(true); expect(frame.width).toBeGreaterThan(0); // JPEG em base64
    expect(msgs.some((m) => m.type === "portalState" && m.state!.status === "running")).toBe(true);
    expect(((await api("GET", `/v1/portals/${id}`)).json as St).watchers).toBe(1);
    const before = msgs.filter((m) => m.type === "portalFrame").length;
    await act(id, { action: "navigate", url: `http://127.0.0.1:${PAGES}/page2` });
    await waitFor(() => msgs.filter((m) => m.type === "portalFrame").length > before); // a mudança chega como novo quadro
    ws.send(JSON.stringify({ type: "portalUnwatch", nodeId: id }));
    await waitFor(async () => ((await api("GET", `/v1/portals/${id}`)).json as St).watchers === 0);
    ws.send(JSON.stringify({ type: "portalWatch", nodeId: id })); await waitFor(async () => ((await api("GET", `/v1/portals/${id}`)).json as St).watchers === 1);
    ws.close(); await waitFor(async () => ((await api("GET", `/v1/portals/${id}`)).json as St).watchers === 0); // desconectar libera
    // WS sem token válido não assiste
    const bad = new WebSocket(`ws://127.0.0.1:${PORT}/v1/ws?token=errado`); const closed = await new Promise<boolean>((res) => { bad.onclose = () => res(true); bad.onerror = () => res(true); setTimeout(() => res(false), 4000); }); expect(closed).toBe(true);
  }, 60_000);

  it("CLI dentro de um terminal: portal new/open/snapshot/type/eval/screenshot funcionam com a credencial do agente", async () => {
    const cwd = join(dir, "cli"); mkdirSync(cwd);
    const script = join(dir, "cli.sh");
    writeFileSync(script, `#!/bin/bash
cd ${cwd}
mess portal new http://127.0.0.1:${PAGES}/ --name clip > new.txt 2>&1
mess portal list > list.txt 2>&1
mess portal clip wait-text "Olá portal" --timeout 10 > wait.txt 2>&1
mess portal clip snapshot > snap.txt 2>&1
mess portal clip type 1 "via cli" --submit > type.txt 2>&1
mess portal clip eval "document.querySelector('#q').innerText" > eval.txt 2>&1
mess portal clip screenshot shot.png > shot.txt 2>&1
mess portal clip open file:///etc/passwd > bad.txt 2>&1
mess portal snapshot clip > maestri-order.txt 2>&1
mess portal click clip 0 > maestri-click.txt 2>&1
touch done
sleep 60
`);
    chmodSync(script, 0o755);
    const ws = ((await api("POST", "/v1/workspaces", { name: "cli", cwd })).json as { workspaceId: string }).workspaceId;
    await api("POST", `/v1/workspaces/${ws}/nodes`, { expectedRevision: 0, kind: "terminal", title: "agente", command: script, geometry: { x: 0, y: 0, w: 100, h: 100 } });
    await waitFor(() => existsSync(join(cwd, "done")), 60_000);
    const r = (f: string) => readFileSync(join(cwd, f), "utf8");
    expect(r("new.txt")).toMatch(/portal criado .* "clip" → http:\/\/127\.0\.0\.1:48039\//); expect(r("list.txt")).toContain("clip");
    expect(r("wait.txt")).toContain("encontrado");
    expect(r("snap.txt")).toContain("# Casa"); expect(r("snap.txt")).toMatch(/\[\d+\] a "ir para dois" → http:\/\/127\.0\.0\.1:48039\/page2/); expect(r("snap.txt")).toContain("Olá portal");
    expect(r("type.txt")).toContain("/search?q=via+cli"); expect(r("eval.txt").trim()).toBe("q=via cli");
    expect(r("shot.txt")).toContain("shot.png"); expect(readFileSync(join(cwd, "shot.png")).subarray(0, 4).toString("hex")).toBe("89504e47");
    expect(r("bad.txt")).toMatch(/INVALID.*esquema não permitido/);
    expect(r("maestri-order.txt")).toContain("# Busca"); // ordem `mess portal snapshot <portal>` (a que a skill do Maestri ensina) também funciona
    expect(r("maestri-click.txt")).not.toMatch(/não encontrado/);
  }, 120_000);
});

describe("portais sem navegador instalado", () => {
  it("falha clara (501) e estado de erro; o app continua funcionando", async () => {
    const d2 = join(dir, "data2");
    const { p, tk } = await boot(PORT2, d2, { PATH: "/nonexistent", MESS_BROWSER: "" });
    try {
      const ws = (await call(PORT2, tk, "POST", "/v1/workspaces", { name: "sem", cwd: dir })).json as { workspaceId: string };
      const nd = (await call(PORT2, tk, "POST", `/v1/workspaces/${ws.workspaceId}/nodes`, { expectedRevision: 0, kind: "portal", geometry: { x: 0, y: 0, w: 300, h: 200 }, content: JSON.stringify({ url: "https://exemplo.com" }) })).json as { node: { nodeId: string } };
      const r = await call(PORT2, tk, "POST", `/v1/portals/${nd.node.nodeId}/act`, { action: "navigate", url: "https://exemplo.com" });
      expect(r.status).toBe(501); expect(r.json.error.message).toMatch(/navegador/);
      expect((await call(PORT2, tk, "GET", `/v1/portals/${nd.node.nodeId}`)).json).toMatchObject({ status: "error", error: expect.stringMatching(/navegador/) });
    } finally { try { p.kill("SIGKILL"); } catch { /* */ } }
  }, 30_000);
});
