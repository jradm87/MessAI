import { accessSync, constants, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { delimiter, extname, join } from "node:path";
import { getPath, isPathLike, IS_WIN, pathExts } from "./platform.js";

/**
 * #38 — provedores de agente (CLIs de IA) conhecidos pelo MessAI: os embutidos + extras em JSON
 * na pasta `<dataDir>/providers/*.json` ({ id, label, binary, color? }). `path` = onde o binário está no PATH (ou null).
 */
export type Provider = { id: string; label: string; binary: string; color: string; path: string | null; builtin: boolean; source?: string };
export const BUILTIN_PROVIDERS: { id: string; label: string; binary: string; color: string }[] = [
  { id: "claude", label: "Claude Code", binary: "claude", color: "#d97757" },
  { id: "codex", label: "Codex", binary: "codex", color: "#10a37f" },
  { id: "opencode", label: "OpenCode", binary: "opencode", color: "#a66bff" },
  { id: "antigravity", label: "Antigravity", binary: "agy", color: "#5b8def" },
];
const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/**
 * Caminho executável de `cmd` no PATH (ou o próprio, se vier como caminho e for executável).
 * Windows (#2): sem `X_OK` (lá não verifica execução) — vale arquivo existente com extensão do PATHEXT;
 * `cmd` sem extensão tenta cada uma (`claude` → `claude.exe`/`claude.cmd`); reconhece `\` e `C:` como caminho.
 */
export function whichOnPath(cmd: string, env: NodeJS.ProcessEnv = process.env, win = IS_WIN): string | null {
  if (!cmd) return null;
  const exts = pathExts(env, win);
  const hit = (p: string): string | null => {
    if (!win) { try { accessSync(p, constants.X_OK); return p; } catch { return null; } }
    const candidates = exts.includes(extname(p).toLowerCase()) ? [p] : exts.map((e) => p + e);
    for (const c of candidates) { try { if (statSync(c).isFile()) return c; } catch { /* próximo */ } }
    return null;
  };
  if (isPathLike(cmd, win)) return hit(cmd);
  for (const dir of getPath(env, win).split(win ? ";" : delimiter)) {
    if (!dir) continue;
    const p = hit(join(dir, cmd));
    if (p) return p;
  }
  return null;
}

/** Lê os JSON extras; arquivo inválido vira erro (não derruba a lista). Ids dos embutidos não podem ser sobrescritos. */
export function loadExtraProviders(dir: string): { providers: { id: string; label: string; binary: string; color: string; source: string }[]; errors: { file: string; error: string }[] } {
  const providers: { id: string; label: string; binary: string; color: string; source: string }[] = [];
  const errors: { file: string; error: string }[] = [];
  if (!existsSync(dir)) return { providers, errors };
  const builtin = new Set(BUILTIN_PROVIDERS.map((p) => p.id));
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
    const file = join(dir, f);
    try {
      const j = JSON.parse(readFileSync(file, "utf8")) as { id?: unknown; label?: unknown; binary?: unknown; color?: unknown };
      if (typeof j.id !== "string" || !ID_RE.test(j.id)) throw new Error("`id` ausente ou inválido (a-z, 0-9, -)");
      if (builtin.has(j.id) || providers.some((p) => p.id === j.id)) throw new Error(`id repetido: ${j.id}`);
      if (typeof j.label !== "string" || !j.label.trim()) throw new Error("`label` ausente");
      if (typeof j.binary !== "string" || !j.binary.trim()) throw new Error("`binary` ausente");
      const color = typeof j.color === "string" && /^#[0-9a-f]{6}$/i.test(j.color) ? j.color : "#8a8a90";
      providers.push({ id: j.id, label: j.label.trim(), binary: j.binary.trim(), color, source: file });
    } catch (e) { errors.push({ file, error: e instanceof Error ? e.message : String(e) }); }
  }
  return { providers, errors };
}

export function listProviders(dir: string, env: NodeJS.ProcessEnv = process.env): { dir: string; providers: Provider[]; errors: { file: string; error: string }[] } {
  const extra = loadExtraProviders(dir);
  const providers: Provider[] = [
    ...BUILTIN_PROVIDERS.map((p) => ({ ...p, path: whichOnPath(p.binary, env), builtin: true })),
    ...extra.providers.map((p) => ({ ...p, path: whichOnPath(p.binary, env), builtin: false })),
  ];
  return { dir, providers, errors: extra.errors };
}
