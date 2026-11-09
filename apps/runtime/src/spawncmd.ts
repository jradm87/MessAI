import { readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { IS_WIN } from "./platform.js";
import { whichOnPath } from "./providers.js";

/** Teto seguro da linha de comando no Windows (CreateProcess aceita 32 767 chars; acima disso: erro 206). (A) */
export const WIN_CMDLINE_BUDGET = 30_000;

/** Tamanho aproximado da linha de comando que o Windows montaria (aspas + escapes por argumento). */
export function cmdlineLength(command: string, args: string[]): number {
  return [command, ...args].reduce((n, a) => n + a.length + 3 + (a.match(/["\\]/g)?.length ?? 0), 0);
}

/** Script JS alvo de um shim `.cmd` do npm (cmd-shim): `"%dp0%\node_modules\pkg\bin\x.js" %*`. */
export function npmShimTarget(cmdFile: string, content: string): string | null {
  const m = /"%dp0%\\([^"]+\.[cm]?js)"/i.exec(content);
  return m ? join(dirname(cmdFile), ...m[1]!.split("\\")) : null;
}

export type SpawnCommand = { command: string; args: string[]; via: "direct" | "node-shim" | "cmd" };

/**
 * Comando real para o ConPTY (A). O node-pty não aplica PATHEXT nem lê o PATH do `env` passado:
 * `pty.spawn("claude")` dá "File not found" mesmo com `claude.exe` no PATH do terminal. Então, no Windows:
 * - resolve no PATH do `env` do terminal → caminho completo;
 * - `.exe`/`.com` → direto;
 * - `.cmd`/`.bat` de pacote npm → `node <script.js>` (via `.cmd` o argv multilinha é cortado na 1ª quebra de linha);
 * - outro `.cmd`/`.bat` → `cmd.exe /d /s /c`.
 * Fora do Windows (ou se não achar) devolve igual. Nunca altera `session.command` — só o que vai para o `pty.spawn`.
 */
export function resolveSpawnCommand(command: string, args: string[], env: Record<string, string>, win = IS_WIN,
  read: (p: string) => string = (p) => readFileSync(p, "utf8")): SpawnCommand {
  if (!win) return { command, args, via: "direct" };
  const full = whichOnPath(command, env, true);
  if (!full) return { command, args, via: "direct" };
  const ext = extname(full).toLowerCase();
  if (ext !== ".cmd" && ext !== ".bat") return { command: full, args, via: "direct" };
  let script: string | null = null;
  try { script = npmShimTarget(full, read(full)); } catch { /* sem leitura: cai no cmd.exe */ }
  if (script) {
    const node = whichOnPath("node", env, true) ?? "node";
    return { command: node, args: [script, ...args], via: "node-shim" };
  }
  const comspec = Object.entries(env).find(([k]) => k.toUpperCase() === "COMSPEC")?.[1] ?? "cmd.exe";
  return { command: comspec, args: ["/d", "/s", "/c", full, ...args], via: "cmd" };
}

/**
 * Tira o texto longo do `--append-system-prompt` do argv no Windows (A): se a linha passar do orçamento,
 * grava o texto em arquivo (via `write`) e troca por `--append-system-prompt-file <arquivo>` (o Claude Code aceita).
 */
export function fitAppendPrompt(command: string, args: string[], write: (text: string) => string, win = IS_WIN): string[] {
  if (!win || cmdlineLength(command, args) <= WIN_CMDLINE_BUDGET) return args;
  const i = args.indexOf("--append-system-prompt");
  if (i < 0 || i + 1 >= args.length) return args;
  const file = write(args[i + 1]!);
  return args.map((a, j) => (j === i ? "--append-system-prompt-file" : j === i + 1 ? file : a));
}
