/**
 * Camada de plataforma (porte Windows — plan.md §9.4). Todo comportamento específico do Windows mora aqui
 * ou atrás de `IS_WIN`. As funções recebem `win` opcional para que os testes cubram os dois caminhos em qualquer SO.
 */
import { createHash } from "node:crypto";
import { join } from "node:path";

export const IS_WIN = process.platform === "win32";

/** Nome real da chave PATH no env (Windows costuma ser "Path"), ou "PATH" se não existir. */
export function pathKey(env: NodeJS.ProcessEnv | Record<string, string | undefined>, win = IS_WIN): string {
  if (!win) return "PATH";
  return Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
}

/** Valor do PATH, qualquer que seja a caixa da chave. */
export function getPath(env: NodeJS.ProcessEnv | Record<string, string | undefined>, win = IS_WIN): string {
  return env[pathKey(env, win)] ?? "";
}

/** Põe `dir` na frente do PATH preservando a chave existente; no Windows remove duplicatas de caixa (`PATH` + `Path`). (C) */
export function prependPath(env: Record<string, string>, dir: string, win = IS_WIN): Record<string, string> {
  const key = pathKey(env, win);
  const sep = win ? ";" : ":";
  const cur = env[key] ?? "";
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (!(win && k.toUpperCase() === "PATH")) out[k] = v;
  out[key] = cur ? `${dir}${sep}${cur}` : dir;
  return out;
}

/**
 * Extensões executáveis do Windows (PATHEXT) em minúsculas, na ordem; fora do Windows `[""]`.
 * No Windows NÃO inclui "": um arquivo sem extensão (ex.: o shim sh que o npm cria ao lado do `.cmd`) não roda via CreateProcess.
 */
export function pathExts(env: NodeJS.ProcessEnv | Record<string, string | undefined>, win = IS_WIN): string[] {
  if (!win) return [""];
  const raw = Object.entries(env).find(([k]) => k.toUpperCase() === "PATHEXT")?.[1] || ".COM;.EXE;.BAT;.CMD";
  return raw.split(";").map((e) => e.trim().toLowerCase()).filter((e) => e.startsWith("."));
}

/** `cmd` já é um caminho (tem separador de diretório)? No Windows conta `\` e `C:`. */
export function isPathLike(cmd: string, win = IS_WIN): boolean {
  return cmd.includes("/") || (win && (cmd.includes("\\") || /^[a-zA-Z]:/.test(cmd)));
}

/**
 * Socket do agente (#6): Linux `<dataDir>/agent.sock`; Windows named pipe `\\.\pipe\messai-<sha1(dataDir normalizado)[0..16]>`
 * (normalizado = barras `\`, sem barra final, minúsculas — NTFS não diferencia caixa). O CLI replica esta regra sem importar o runtime.
 */
export function socketPathFor(dataDir: string, win = IS_WIN): string {
  if (!win) return join(dataDir, "agent.sock");
  const norm = dataDir.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
  return `\\\\.\\pipe\\messai-${createHash("sha1").update(norm).digest("hex").slice(0, 16)}`;
}

/**
 * Argumentos para "rode este comando" em cada shell (F): sh/bash/zsh → `-c`; pwsh/powershell → `-NoProfile -NonInteractive -Command`;
 * cmd.exe → `/d /s /c`. Desconhecido → `-c` (shells POSIX).
 */
export function shellCommandArgs(shell: string, cmd: string): string[] {
  const name = (shell.split(/[\\/]/).pop() ?? shell).toLowerCase().replace(/\.exe$/, "");
  // H: com a saída capturada, o PowerShell 5.1 escreve em codepage OEM (acentos viram "�") → força UTF-8 antes do comando
  if (name === "pwsh" || name === "powershell") return ["-NoProfile", "-NonInteractive", "-Command", `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ${cmd}`];
  if (name === "cmd") return ["/d", "/s", "/c", cmd];
  return ["-c", cmd];
}

/** Converte `C:\a\b` → `/c/a/b` (Git Bash/MSYS). Caminho que não começa com letra de drive só troca `\` por `/`. */
export function toPosixPath(p: string): string {
  const s = p.replace(/\\/g, "/");
  const m = /^([a-zA-Z]):(\/|$)(.*)$/.exec(s);
  return m ? `/${m[1]!.toLowerCase()}${m[3] ? `/${m[3]}` : ""}` : s;
}
