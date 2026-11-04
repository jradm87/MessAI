import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// #73 — dispositivos Android: o RUNTIME dirige um aparelho/emulador via adb. Aqui com adb/emulator FALSOS (herméticos, rodam no CI) que registram
// as chamadas: prova os comandos exatos, a validação contra injeção no shell do aparelho, o boot/encerramento do emulador, o stream de quadros,
// a autorização e a CLI. A validação contra um emulador REAL fica em device-real.test.ts (opt-in).
const ROOT = join(import.meta.dirname, "../..");
const FIX = join(ROOT, "tests/fixtures/device");
const PORT = 48043; const PORT2 = 48044;
let dir: string; let fake: string; let rt: ChildProcess; let token: string;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const call = async (port: number, tk: string, method: string, path: string, body?: unknown) => { const r = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { authorization: `Bearer ${tk}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : null }); const t = await r.text(); return { status: r.status, json: t ? JSON.parse(t) : null }; };
const api = (method: string, path: string, body?: unknown) => call(PORT, token, method, path, body);
const waitFor = async <T,>(fn: () => T | null | false | undefined | Promise<T | null | false | undefined>, ms = 15_000): Promise<T> => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v as T; if (Date.now() - t > ms) throw new Error("timeout waitFor"); await sleep(120); } };
const bwrapOk = (() => { try { execFileSync("bwrap", ["--unshare-user", "--ro-bind", "/usr", "/usr", "--symlink", "usr/bin", "/bin", "--symlink", "usr/lib", "/lib", "--symlink", "usr/lib64", "/lib64", "--proc", "/proc", "--dev", "/dev", "--", "/usr/bin/true"], { stdio: "ignore" }); return true; } catch { return false; } })();
const calls = (): string[] => (existsSync(join(fake, "calls.log")) ? readFileSync(join(fake, "calls.log"), "utf8").split("\n").filter(Boolean) : []);
const emuStarts = (): string[] => (existsSync(join(fake, "emulator.log")) ? readFileSync(join(fake, "emulator.log"), "utf8").split("\n").filter((l) => l.startsWith("-avd")) : []);
const devicesFile = (): string => (existsSync(join(fake, "devices")) ? readFileSync(join(fake, "devices"), "utf8") : "");
const boot = async (port: number, dataDir: string, env: NodeJS.ProcessEnv) => { const p = spawn(process.execPath, [join(ROOT, "apps/runtime/dist/index.js")], { env: { ...process.env, MESS_DATA_DIR: dataDir, MESS_PORT: String(port), SHELL: "/bin/sh", FAKE_ADB_DIR: fake, MESS_ADB: join(FIX, "fake-adb"), MESS_EMULATOR: join(FIX, "fake-emulator"), ...env }, stdio: "ignore" }); let tk = ""; for (let i = 0; i < 60; i++) { await sleep(200); try { tk = readFileSync(join(dataDir, "runtime.token"), "utf8").trim(); if ((await fetch(`http://127.0.0.1:${port}/v1/health`, { headers: { authorization: `Bearer ${tk}` } })).ok) break; } catch { /* subindo */ } } return { p, tk }; };
let n = 0;
const mkDev = async (name: string, content: Record<string, unknown> | string = {}, wsId?: string) => {
  const ws = wsId ?? ((await api("POST", "/v1/workspaces", { name: `${name}-${++n}`, cwd: dir })).json as { workspaceId: string }).workspaceId;
  const rev = ((await api("GET", `/v1/workspaces/${ws}`)).json as { workspace: { revision: number } }).workspace.revision;
  const r = await api("POST", `/v1/workspaces/${ws}/nodes`, { expectedRevision: rev, kind: "device", title: name, geometry: { x: 0, y: 0, w: 360, h: 640 }, content: typeof content === "string" ? content : JSON.stringify(content) });
  return { ws, status: r.status, json: r.json, nodeId: (r.json as { node?: { nodeId: string } })?.node?.nodeId as string };
};
const act = (id: string, a: Record<string, unknown>) => api("POST", `/v1/devices/${id}/act`, a);
type St = { status: string; serial?: string; avd?: string; model?: string; width: number; height: number; foreground?: string; watchers: number; error?: string; message?: string };
const SER = "R58M123ABC";

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "mess-device-test-")); fake = join(dir, "fake"); mkdirSync(fake);
  writeFileSync(join(fake, "devices"), `${SER} device usb:1-2 product:beyond1 model:Fake_Phone device:beyond1 transport_id:2\nOFFDEV offline\n`);
  ({ p: rt, tk: token } = await boot(PORT, join(dir, "data"), {}));
  if (!token) throw new Error("runtime não subiu");
}, 40_000);
afterAll(async () => {
  try { rt?.kill("SIGKILL"); } catch { /* */ }
  for (const f of existsSync(fake) ? (await import("node:fs")).readdirSync(fake).filter((x) => x.startsWith("pid-")) : []) { try { process.kill(Number(readFileSync(join(fake, f), "utf8").trim()), "SIGKILL"); } catch { /* já morto */ } }
  await sleep(200);
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 }); } catch { /* */ }
}, 30_000);

describe("dispositivos Android com adb falso", () => {
  it("lista aparelhos e AVDs; sem adb instalado: diz claramente e as ações falham com 400", async () => {
    const l = (await api("GET", "/v1/devices")).json as { adb: boolean; emulator: boolean; devices: { serial: string; state: string; kind: string; model?: string }[]; avds: string[] };
    expect(l).toMatchObject({ adb: true, emulator: true, avds: ["Pixel_Fake", "Other_AVD"] });
    expect(l.devices.find((d) => d.serial === SER)).toMatchObject({ state: "device", kind: "usb", model: "Fake Phone" }); expect(l.devices.find((d) => d.serial === "OFFDEV")!.state).toBe("offline");
    const d2 = join(dir, "data2"); const { p, tk } = await boot(PORT2, d2, { MESS_ADB: "/nonexistent/adb", MESS_EMULATOR: "/nonexistent/emulator" });
    try {
      const l2 = (await call(PORT2, tk, "GET", "/v1/devices")).json as { adb: boolean; adbError: string; emulator: boolean };
      expect(l2.adb).toBe(false); expect(l2.adbError).toMatch(/adb não encontrado/); expect(l2.emulator).toBe(false);
      const ws = (await call(PORT2, tk, "POST", "/v1/workspaces", { name: "x", cwd: dir })).json as { workspaceId: string };
      const nd = (await call(PORT2, tk, "POST", `/v1/workspaces/${ws.workspaceId}/nodes`, { expectedRevision: 0, kind: "device", geometry: { x: 0, y: 0, w: 300, h: 500 } })).json as { node: { nodeId: string } };
      const r = await call(PORT2, tk, "POST", `/v1/devices/${nd.node.nodeId}/act`, { action: "select", serial: "x1" }); expect(r.status).toBe(400); expect(r.json.error.message).toMatch(/adb não encontrado/);
    } finally { try { p.kill("SIGKILL"); } catch { /* */ } }
  });

  it("conteúdo do nó validado (serial/AVD bem formados) na criação e no PATCH", async () => {
    expect((await mkDev("bad1", { serial: "a;b" })).status).toBe(400); expect((await mkDev("bad2", { avd: "-no-window" })).status).toBe(400); expect((await mkDev("bad3", "isto não é json")).status).toBe(400);
    const ok = await mkDev("ok", { serial: SER, extra: "ignorado" }); expect(ok.status).toBe(201); expect(JSON.parse((ok.json as { node: { content: string } }).node.content)).toEqual({ serial: SER });
    const rev = ((await api("GET", `/v1/workspaces/${ok.ws}`)).json as { workspace: { revision: number } }).workspace.revision;
    expect((await api("PATCH", `/v1/nodes/${ok.nodeId}`, { expectedRevision: rev, content: JSON.stringify({ serial: "x y" }) })).status).toBe(400);
    expect((await api("GET", "/v1/devices/nao-existe")).status).toBe(404);
  });

  it("select liga ao aparelho, lê modelo/tamanho e grava a escolha no nó SEM mexer na revisão; offline/desconhecido recusados", async () => {
    const d = await mkDev("sel"); const id = d.nodeId;
    expect(((await api("GET", `/v1/devices/${id}`)).json as St).status).toBe("stopped");
    const rev0 = ((await api("GET", `/v1/workspaces/${d.ws}`)).json as { workspace: { revision: number } }).workspace.revision;
    expect((await act(id, { action: "select", serial: "OFFDEV" })).status).toBe(400); // offline
    expect((await act(id, { action: "select", serial: "NAOEXISTE" })).status).toBe(400);
    expect((await act(id, { action: "select", serial: "-s" })).status).toBe(400); // não vira opção do adb
    expect(((await api("GET", `/v1/devices/${id}`)).json as St).status).toBe("error");
    const r = await act(id, { action: "select", serial: SER }); expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.state).toMatchObject({ status: "connected", serial: SER, model: "Fake Phone", width: 270, height: 480 });
    const snap = (await api("GET", `/v1/workspaces/${d.ws}`)).json as { workspace: { revision: number }; nodes: { nodeId: string; content: string }[] };
    expect(JSON.parse(snap.nodes.find((x) => x.nodeId === id)!.content)).toEqual({ serial: SER }); expect(snap.workspace.revision).toBe(rev0);
    await waitFor(async () => ((await api("GET", `/v1/devices/${id}`)).json as St).foreground === "com.fake.app/com.fake.app.Main");
  });

  it("ações estruturadas: o adb recebe os comandos exatos; injeção no shell do aparelho é recusada ANTES de chamar o adb", async () => {
    const d = await mkDev("acoes", { serial: SER }); const id = d.nodeId;
    const sh = () => calls().filter((c) => c.includes(`-s ${SER} shell `)).map((c) => c.replace(`-s ${SER} shell `, "")).filter((c) => /^(input|monkey|am) /.test(c)); // sem as chamadas de sonda (getprop/wm/dumpsys) da reconexão
    const before = sh().length;
    for (const a of [{ action: "tap", x: 100.4, y: 200.6 }, { action: "longpress", x: 100, y: 200 }, { action: "longpress", x: 5, y: 6, ms: 500 }, { action: "swipe", x1: 10, y1: 20, x2: 30, y2: 40 }, { action: "swipe", x1: 1, y1: 2, x2: 3, y2: 4, ms: 800 },
      { action: "key", key: "back" }, { action: "key", key: "KEYCODE_VOLUME_UP" }, { action: "text", text: "ola mundo" }, { action: "text", text: "it's $(id); `x` & \"q\"" },
      { action: "launch", package: "com.fake.app" }, { action: "launch", package: "com.fake.app", activity: ".Main" }, { action: "stop", package: "com.fake.app" }]) { const r = await act(id, a); expect(r.status, JSON.stringify(a) + JSON.stringify(r.json)).toBe(200); }
    expect(sh().slice(before)).toEqual([
      "input tap 100 201", "input swipe 100 200 100 200 800", "input swipe 5 6 5 6 500", "input swipe 10 20 30 40 300", "input swipe 1 2 3 4 800",
      "input keyevent KEYCODE_BACK", "input keyevent KEYCODE_VOLUME_UP", "input text 'ola%smundo'", `input text 'it'\\''s%s$(id);%s\`x\`%s&%s"q"'`,
      "monkey -p com.fake.app -c android.intent.category.LAUNCHER 1", "am start -n com.fake.app/.Main", "am force-stop com.fake.app",
    ]);
    const n0 = calls().length;
    for (const bad of [{ action: "launch", package: "com.a; reboot" }, { action: "launch", package: "com.a.b", activity: "x;y" }, { action: "stop", package: "$(id).x" }, { action: "key", key: "back; reboot" }, { action: "key", key: "keycode_home" },
      { action: "text", text: "olá" }, { action: "text", text: "a\nb" }, { action: "tap", x: -1, y: 5 }, { action: "swipe", x1: 1, y1: 1, x2: 2, y2: 2, ms: 99999 }, { action: "shell", cmd: "reboot" }, { action: "launch", package: "" }]) {
      const r = await act(id, bad); expect(r.status, JSON.stringify(bad)).toBe(400);
    }
    expect(calls().slice(n0).filter((c) => c.includes(" shell "))).toEqual([]); // nada chegou ao adb
  });

  it("árvore de UI, captura PNG e apps; desconectar e agir de novo reconecta pelo serial salvo", async () => {
    const d = await mkDev("leitura", { serial: SER }); const id = d.nodeId;
    const ui = (await api("GET", `/v1/devices/${id}/ui`)).json as { nodes: { ref: number; cls: string; text: string; desc: string; resourceId: string; clickable: boolean; scrollable: boolean; bounds: { x1: number; y2: number } }[] };
    expect(ui.nodes.map((x) => x.cls.split(".").pop())).toEqual(["FrameLayout", "Button", "RecyclerView"]);
    expect(ui.nodes[1]).toMatchObject({ text: "Entrar & sair", desc: "Botão de login", resourceId: "com.fake.app:id/btn_login", clickable: true }); expect(ui.nodes[2]!.scrollable).toBe(true);
    const shot = (await api("GET", `/v1/devices/${id}/screenshot`)).json as { mime: string; data: string; width: number; height: number }; const png = Buffer.from(shot.data, "base64");
    expect(shot).toMatchObject({ mime: "image/png", width: 270, height: 480 }); expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect((await api("GET", `/v1/devices/${id}/apps`)).json).toEqual(["com.fake.app", "org.fake.other"]);
    expect(((await act(id, { action: "disconnect" })).json as { state: St }).state.status).toBe("stopped");
    const again = await act(id, { action: "key", key: "home" }); expect(again.status).toBe(200); expect(again.json.state).toMatchObject({ status: "connected", serial: SER });
    const none = await mkDev("semserial"); const r = await act(none.nodeId, { action: "tap", x: 1, y: 1 }); expect(r.status).toBe(400); expect(r.json.error.message).toMatch(/nenhum dispositivo ligado/);
  });

  it("emulador: boot (efêmero por padrão), aguarda o Android subir, reaproveita o mesmo AVD, persist sem -read-only, encerra só o que o app iniciou", async () => {
    const a = await mkDev("emuA");
    expect((await act(a.nodeId, { action: "boot", avd: "Nao_Existe" })).json.error.message).toMatch(/AVD não encontrado.*Pixel_Fake/);
    expect((await act(a.nodeId, { action: "boot", avd: "-no-window" })).status).toBe(400);
    const t0 = Date.now(); const r = await act(a.nodeId, { action: "boot", avd: "Pixel_Fake", wait: false });
    expect(r.status).toBe(200); expect(r.json.state.status).toBe("starting"); expect(Date.now() - t0).toBeLessThan(3000); // não bloqueia
    const st = await waitFor(async () => { const s = (await api("GET", `/v1/devices/${a.nodeId}`)).json as St; return s.status === "connected" ? s : null; }, 30_000);
    expect(st).toMatchObject({ serial: "emulator-5554", avd: "Pixel_Fake", model: "Fake Phone" });
    expect(emuStarts()).toHaveLength(1); expect(emuStarts()[0]).toBe("-avd Pixel_Fake -port 5554 -no-window -no-audio -no-snapshot -no-boot-anim -gpu swiftshader_indirect -read-only");
    // outro nó pede o MESMO AVD: reaproveita o que já roda
    const b = await mkDev("emuB"); const rb = await act(b.nodeId, { action: "boot", avd: "Pixel_Fake" }); expect(rb.status, JSON.stringify(rb.json)).toBe(200);
    expect(rb.json.state).toMatchObject({ status: "connected", serial: "emulator-5554" }); expect(emuStarts()).toHaveLength(1);
    // persist: outro AVD, porta seguinte, sem -read-only
    const c = await mkDev("emuC"); const rc = await act(c.nodeId, { action: "boot", avd: "Other_AVD", persist: true }); expect(rc.status, JSON.stringify(rc.json)).toBe(200);
    expect(rc.json.state.serial).toBe("emulator-5556"); expect(emuStarts()[1]).toBe("-avd Other_AVD -port 5556 -no-window -no-audio -no-snapshot -no-boot-anim -gpu swiftshader_indirect");
    // só encerra emulador iniciado por NÓS (o nó B apenas se ligou a um que já rodava)
    const sb = await act(b.nodeId, { action: "shutdown" }); expect(sb.status).toBe(400); expect(sb.json.error.message).toMatch(/iniciados por este app/);
    const pidA = Number(readFileSync(join(fake, "pid-emulator-5554"), "utf8").trim());
    expect((await act(a.nodeId, { action: "shutdown" })).status).toBe(200);
    await waitFor(() => !devicesFile().includes("emulator-5554"), 10_000);
    await waitFor(() => { try { process.kill(pidA, 0); return false; } catch { return true; } }, 10_000);
    expect(((await api("GET", `/v1/devices/${a.nodeId}`)).json as St).status).toBe("stopped");
    // apagar o nó que iniciou o emulador encerra o emulador (não deixa RAM órfã)
    const rev = ((await api("GET", `/v1/workspaces/${c.ws}`)).json as { workspace: { revision: number } }).workspace.revision;
    expect((await api("DELETE", `/v1/nodes/${c.nodeId}`, { expectedRevision: rev })).status).toBe(204);
    await waitFor(() => !devicesFile().includes("emulator-5556"), 15_000);
  }, 120_000);

  it("stream para o app: deviceWatch entrega quadros PNG + estado, a ação muda o quadro, unwatch/fechar o socket para a captura", async () => {
    const d = await mkDev("stream", { serial: SER }); const id = d.nodeId;
    const msgs: { type: string; data?: string; width?: number; state?: St }[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/v1/ws?token=${token}`);
    await new Promise<void>((res, rej) => { ws.onopen = () => res(); ws.onerror = () => rej(new Error("ws")); });
    ws.onmessage = (e) => msgs.push(JSON.parse(String(e.data)));
    ws.send(JSON.stringify({ type: "deviceWatch", nodeId: id }));
    const f1 = await waitFor(() => msgs.find((m) => m.type === "deviceFrame"), 20_000);
    expect(f1.data!.startsWith("iVBOR")).toBe(true); expect(f1.width).toBe(270); // PNG em base64
    await waitFor(() => msgs.some((m) => m.type === "deviceState" && m.state!.status === "connected"));
    expect(((await api("GET", `/v1/devices/${id}`)).json as St).watchers).toBe(1);
    const n1 = msgs.filter((m) => m.type === "deviceFrame").length;
    await act(id, { action: "tap", x: 5, y: 5 }); // o fake troca de imagem a cada entrada
    await waitFor(() => new Set(msgs.filter((m) => m.type === "deviceFrame").map((m) => m.data)).size >= 2 && msgs.filter((m) => m.type === "deviceFrame").length > n1, 15_000);
    ws.send(JSON.stringify({ type: "deviceUnwatch", nodeId: id }));
    await waitFor(async () => ((await api("GET", `/v1/devices/${id}`)).json as St).watchers === 0);
    await sleep(1600); const shots = () => calls().filter((c) => c.includes("screencap")).length; const s0 = shots(); await sleep(2800); expect(shots()).toBe(s0); // sem observador não captura
    ws.send(JSON.stringify({ type: "deviceWatch", nodeId: id })); await waitFor(async () => ((await api("GET", `/v1/devices/${id}`)).json as St).watchers === 1);
    ws.close(); await waitFor(async () => ((await api("GET", `/v1/devices/${id}`)).json as St).watchers === 0);
    const bad = new WebSocket(`ws://127.0.0.1:${PORT}/v1/ws?token=errado`); expect(await new Promise<boolean>((res) => { bad.onclose = () => res(true); bad.onerror = () => res(true); setTimeout(() => res(false), 4000); })).toBe(true);
  }, 90_000);

  it("autorização: agente com devices:control dirige; sem a capacidade 403; de outro espaço 403; isolado nunca (nem por aprovação)", async () => {
    const p = await mkDev("auth", { serial: SER });
    const term = async (ws: string, extra: Record<string, unknown> = {}) => { const rev = ((await api("GET", `/v1/workspaces/${ws}`)).json as { workspace: { revision: number } }).workspace.revision; return ((await api("POST", `/v1/workspaces/${ws}/nodes`, { expectedRevision: rev, kind: "terminal", title: "ag", command: "/bin/sleep", args: ["60"], geometry: { x: 0, y: 0, w: 100, h: 100 }, ...extra })).json as { node: { nodeId: string } }).node.nodeId; };
    const tn = await term(p.ws);
    const full = ((await api("POST", `/v1/nodes/${tn}/token`, {})).json as { token: string }).token;
    expect((await call(PORT, full, "POST", `/v1/devices/${p.nodeId}/act`, { action: "key", key: "back" })).status).toBe(200);
    expect((await call(PORT, full, "GET", "/v1/devices")).status).toBe(200); expect((await call(PORT, full, "GET", `/v1/devices/${p.nodeId}/ui`)).status).toBe(200);
    const limited = ((await api("POST", `/v1/nodes/${tn}/token`, { capabilities: ["nodes:read", "files:read"] })).json as { token: string }).token;
    for (const [m, u, b] of [["POST", `/v1/devices/${p.nodeId}/act`, { action: "key", key: "back" }], ["GET", `/v1/devices/${p.nodeId}`], ["GET", "/v1/devices"], ["GET", `/v1/devices/${p.nodeId}/screenshot`], ["GET", `/v1/devices/${p.nodeId}/ui`], ["GET", `/v1/devices/${p.nodeId}/apps`]] as const) expect((await call(PORT, limited, m, u, b)).status, u).toBe(403);
    const other = ((await api("POST", "/v1/workspaces", { name: "outro", cwd: dir })).json as { workspaceId: string }).workspaceId; const tn2 = await term(other);
    const foreign = ((await api("POST", `/v1/nodes/${tn2}/token`, {})).json as { token: string }).token;
    expect((await call(PORT, foreign, "POST", `/v1/devices/${p.nodeId}/act`, { action: "key", key: "back" })).status).toBe(403);
    if (bwrapOk) {
      const iso = await term(p.ws, { isolation: { network: "none" } }); const it = ((await api("POST", `/v1/nodes/${iso}/token`, {})).json as { token: string }).token;
      expect((await call(PORT, it, "POST", `/v1/devices/${p.nodeId}/act`, { action: "key", key: "back" })).status).toBe(403);
      const ap = await call(PORT, it, "POST", "/v1/approvals", { capability: "devices:control", reason: "testar app" }); expect(ap.status).toBe(403); expect(JSON.stringify(ap.json)).toMatch(/não pode ser concedida|FORBIDDEN/i);
    }
  }, 60_000);

  it("CLI dentro de um terminal: device list/new/state/tap/ui/key/text/launch/apps/screenshot; texto não-ASCII recusado com mensagem", async () => {
    const cwd = join(dir, "cli"); mkdirSync(cwd); const script = join(dir, "cli-run");
    writeFileSync(script, `#!/bin/bash
cd ${cwd}
mess device list > list.txt 2>&1
mess device new --name tel --serial ${SER} > new.txt 2>&1
mess device tel state > state.txt 2>&1
mess device tel tap 10 20 > tap.txt 2>&1
mess device tel ui > ui.txt 2>&1
mess device tel key home > key.txt 2>&1
mess device tel text "oi mundo" > text.txt 2>&1
mess device tel launch com.fake.app > launch.txt 2>&1
mess device tel apps > apps.txt 2>&1
mess device tel screenshot shot.png > shot.txt 2>&1
mess device tel text "olá" > bad.txt 2>&1
mess device tel launch "com.a; reboot" > bad2.txt 2>&1
touch done
sleep 60
`); chmodSync(script, 0o755);
    const ws = ((await api("POST", "/v1/workspaces", { name: "cli", cwd })).json as { workspaceId: string }).workspaceId;
    await api("POST", `/v1/workspaces/${ws}/nodes`, { expectedRevision: 0, kind: "terminal", title: "agente", command: script, geometry: { x: 0, y: 0, w: 100, h: 100 } });
    await waitFor(() => existsSync(join(cwd, "done")), 60_000);
    const r = (f: string) => readFileSync(join(cwd, f), "utf8");
    expect(r("list.txt")).toContain(`${SER}`); expect(r("list.txt")).toContain("AVDs (emuladores): Pixel_Fake, Other_AVD"); expect(r("new.txt")).toMatch(/dispositivo criado .* "tel"/);
    expect(r("state.txt")).toMatch(/stopped/); expect(r("tap.txt")).toMatch(/connected R58M123ABC \(Fake Phone\)/); // o tap reconectou pelo serial salvo
    expect(r("ui.txt")).toContain('[1] Button "Entrar & sair" desc="Botão de login" id=com.fake.app:id/btn_login centro=(65,40) clicável'); expect(r("ui.txt")).toContain("rolável");
    expect(r("key.txt")).toContain("connected"); expect(r("text.txt")).toContain("connected"); expect(r("launch.txt")).toContain("connected"); expect(r("apps.txt").trim().split("\n")).toEqual(["com.fake.app", "org.fake.other"]);
    expect(r("shot.txt")).toContain("shot.png"); expect(readFileSync(join(cwd, "shot.png")).subarray(0, 4).toString("hex")).toBe("89504e47");
    expect(r("bad.txt")).toMatch(/INVALID.*ASCII/); expect(r("bad2.txt")).toMatch(/INVALID.*pacote inválido/);
    expect(calls().filter((c) => c.includes("reboot"))).toEqual([]);
  }, 120_000);
});
