import { existsSync, lstatSync, readlinkSync, realpathSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { bwrapPlan, expandHome, scrubEnv, type NodeIsolationProfile, type TerminalPlan } from "@messai/domain";
import { whichOnPath } from "./providers.js";

/** #93 — suporte do modo isolado nesta máquina (cacheado): bubblewrap utilizável e systemd de usuário para limites de cgroup. */
export type IsolationSupport = { available: boolean; reason?: string; cgroup: boolean };
let cache: IsolationSupport | null = null;
export function probeIsolation(force = false): IsolationSupport {
  if (cache && !force) return cache;
  const bw = whichOnPath("bwrap");
  if (!bw) return (cache = { available: false, reason: "bubblewrap (bwrap) não está instalado — instale o pacote `bubblewrap` para usar o modo isolado", cgroup: false });
  // Mesmo layout do sandbox real (links usr-merged incluídos: sem /lib64 o carregador dinâmico não acha o libc e `true` nem executa).
  const lay = systemLayout();
  const mounts = [...lay.dirs.flatMap((d) => ["--ro-bind", d, d]), ...lay.links.flatMap(([t, l]) => ["--symlink", t, l])];
  const t = spawnSync(bw, ["--unshare-user", "--unshare-pid", ...mounts, "--proc", "/proc", "--dev", "/dev", "--", "/usr/bin/true"], { timeout: 5000, encoding: "utf8" });
  if (t.status !== 0) return (cache = { available: false, reason: `bubblewrap não conseguiu criar o sandbox (namespaces de usuário bloqueados pelo sistema?): ${(t.stderr || "").trim().split("\n")[0] ?? ""}`.trim(), cgroup: false });
  const c = spawnSync("systemd-run", ["--user", "--scope", "--quiet", "-p", "TasksMax=64", "/usr/bin/true"], { timeout: 5000, encoding: "utf8" });
  return (cache = { available: true, cgroup: c.status === 0 });
}
export function _resetIsolationProbeForTests(): void { cache = null; }

const safeReal = (p: string): string | null => { try { return realpathSync(p); } catch { return null; } };
const SYS_DIRS = ["/usr", "/etc", "/opt"];
const SYS_ROOT_LINKS = ["/bin", "/sbin", "/lib", "/lib32", "/lib64", "/libx32"];
/** Layout de sistema que entra no sandbox: diretórios reais RO e links "usr-merged" recriados como symlinks. */
export function systemLayout(): { dirs: string[]; links: [string, string][] } {
  const dirs = SYS_DIRS.filter((d) => existsSync(d)); const links: [string, string][] = [];
  for (const d of SYS_ROOT_LINKS) {
    try { const st = lstatSync(d); if (st.isSymbolicLink()) links.push([readlinkSync(d), d]); else if (st.isDirectory()) dirs.push(d); } catch { /* não existe nesta distro */ }
  }
  return { dirs, links };
}

export type IsolatedPlanInput = {
  plan: TerminalPlan; iso: NodeIsolationProfile; home: string;
  baseEnv: Record<string, string>; inject: Record<string, string>;
  workspaceCwd: string; groundCwd?: string | undefined; socketPath: string; cliRoot: string;
  globalRo: string[]; globalRw: string[];
};
/**
 * Monta o plano isolado: ambiente LIMPO (nada herdado do runtime além do seguro + o declarado), raiz vazia com o sistema somente leitura,
 * o necessário para achar o binário/CLI (somente leitura), cwd do espaço + socket + caminhos liberados (graváveis), e `.git/hooks`/`.git/config`
 * protegidos (somente leitura) — onde um agente plantaria código que o usuário rodaria depois, fora do sandbox.
 */
export function buildIsolatedPlan(i: IsolatedPlanInput): TerminalPlan {
  const sup = probeIsolation();
  if (!sup.available) {
    // Falha FECHADA: nunca roda sem isolar quando o usuário pediu isolamento.
    return { ...i.plan, command: "/bin/sh", args: ["-c", `echo "MODO ISOLADO INDISPONÍVEL: ${(sup.reason ?? "").replace(/["$`\\]/g, " ")}"; echo "O terminal NÃO foi iniciado (não roda sem isolar). Desligue o modo isolado ou instale o bubblewrap."; exec sleep 3600`], env: { PATH: "/usr/bin:/bin", TERM: "xterm-256color" } };
  }
  const env = scrubEnv(i.baseEnv, i.inject);
  const sys = systemLayout();
  const underSystem = (p: string) => [...sys.dirs, ...SYS_DIRS].some((d) => p === d || p.startsWith(d + "/"));
  const ro: string[] = []; const rw: string[] = [];
  const addRo = (p: string | null | undefined) => {
    if (!p || underSystem(p) || !existsSync(p)) return;
    // /bin, /lib… são links "usr-merged" já recriados no sandbox, e tudo que resolve para dentro do sistema já vem junto (montar de novo colidiria com o link)
    const real = safeReal(p);
    if (sys.links.some(([, l]) => p === l || p.startsWith(l + "/")) || (real && underSystem(real))) return;
    // Nunca o home inteiro nem um ancestral: se o binário mora direto no home, liga só o arquivo.
    if (p === i.home || i.home.startsWith(p + "/") || p === "/") return;
    if (!ro.includes(p)) ro.push(p);
  };
  // binário do agente: pasta do link, pasta do alvo real e, para pacotes npm globais, o node_modules inteiro
  const cmd = i.plan.command.includes("/") ? i.plan.command : whichOnPath(i.plan.command, { PATH: env["PATH"] ?? "" });
  if (cmd) {
    addRo(cmd.slice(0, cmd.lastIndexOf("/")) || "/");
    const real = safeReal(cmd);
    if (real) { addRo(real.slice(0, real.lastIndexOf("/"))); const k = real.indexOf("/node_modules/"); if (k > 0) addRo(real.slice(0, k + "/node_modules".length)); addRo(real); }
  }
  const node = whichOnPath("node", { PATH: env["PATH"] ?? "" });
  if (node) { addRo(node.slice(0, node.lastIndexOf("/"))); const r = safeReal(node); if (r) addRo(r.slice(0, r.lastIndexOf("/"))); }
  addRo(i.cliRoot);
  for (const p of [...i.globalRo, ...(i.iso.ro ?? [])]) addRo(expandHome(p, i.home));
  for (const p of [i.workspaceCwd, i.plan.cwd, i.socketPath, ...i.globalRw, ...(i.iso.rw ?? [])]) { const x = expandHome(p, i.home); if (existsSync(x) && !rw.includes(x)) rw.push(x); }
  const protect: string[] = [];
  for (const base of [i.workspaceCwd, i.plan.cwd]) for (const f of [".git/hooks", ".git/config"]) { const x = `${base}/${f}`; if (existsSync(x) && !protect.includes(x)) protect.push(x); }
  if (i.groundCwd && existsSync(`${i.groundCwd}/.git`) && statSync(`${i.groundCwd}/.git`).isDirectory()) {
    // andar (worktree): o git precisa gravar no .git do térreo (objetos/refs), mas hooks e config ficam somente leitura
    if (!rw.includes(`${i.groundCwd}/.git`)) rw.push(`${i.groundCwd}/.git`);
    for (const f of ["hooks", "config"]) { const x = `${i.groundCwd}/.git/${f}`; if (existsSync(x) && !protect.includes(x)) protect.push(x); }
  }
  let resolvConf: string | undefined; let resolvDest: string | undefined;
  if (i.iso.network === "host") {
    // /etc/resolv.conf costuma ser link para /run/systemd/resolve/… (inexistente no sandbox, e o bwrap não monta SOBRE um link):
    // monta o arquivo real no ALVO do link; se for arquivo comum, já vem junto com o /etc somente leitura.
    try { if (lstatSync("/etc/resolv.conf").isSymbolicLink()) { const r = safeReal("/etc/resolv.conf"); if (r && !underSystem(r)) { resolvConf = r; resolvDest = resolve("/etc", readlinkSync("/etc/resolv.conf")); } } } catch { /* sem resolv.conf */ }
  }
  const outer: Record<string, string> = {};
  for (const k of ["XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS"]) if (process.env[k]) outer[k] = process.env[k]!;
  return bwrapPlan({ ...i.plan, env: env }, i.iso, {
    cwd: i.plan.cwd, home: "/home/agent", systemDirs: sys.dirs, systemLinks: sys.links,
    roPaths: ro, rwPaths: rw.filter((p) => p !== i.plan.cwd), protect, resolvConf, resolvDest, env, cgroupScope: sup.cgroup, outerEnv: outer,
  });
}
