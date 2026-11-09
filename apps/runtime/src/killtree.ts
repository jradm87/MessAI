import { spawnSync } from "node:child_process";
import { IS_WIN } from "./platform.js";

/**
 * Mata a árvore de processos a partir de `pid` (#5, contrato plan.md §9.4). Nunca lança.
 * Linux/macOS: o processo foi criado com `detached` (grupo próprio) → `kill(-pid)`; sem grupo, cai no próprio pid.
 * Windows: não há grupos POSIX (`kill(-pid)` lança) → `taskkill /PID <pid> /T /F` (síncrono, até 5 s).
 */
export function killTree(pid: number | undefined, signal: "SIGTERM" | "SIGKILL" = "SIGKILL", win = IS_WIN): void {
  if (!pid || pid <= 0) return;
  if (win) {
    try { spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true, timeout: 5000 }); } catch { /* já morto */ }
    return;
  }
  try { process.kill(-pid, signal); } catch { try { process.kill(pid, signal); } catch { /* já morto */ } }
}
