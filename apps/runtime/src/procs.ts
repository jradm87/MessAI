import { readdirSync, readFileSync } from "node:fs";
import type { ProcEntry } from "@messai/contracts";

/**
 * #80 — Lê a árvore de processos a partir de um PID raiz em /proc (Linux).
 * Devolve todos os descendentes (incluindo a raiz), com profundidadade, RSS em KB e comando.
 */
export function readProcTree(rootPid: number): ProcEntry[] {
  if (!Number.isInteger(rootPid) || rootPid <= 0) return [];
  const all = new Map<number, { pid: number; ppid: number; name: string; cmd: string; rssKb: number; state: string }>();
  let entries: string[];
  try { entries = readdirSync("/proc"); } catch { return []; }
  for (const d of entries) {
    if (!/^\d+$/.test(d)) continue;
    const pid = Number(d);
    try {
      const status = readFileSync(`/proc/${pid}/status`, "utf8");
      const ppid = Number(/^PPid:\s*(\d+)/m.exec(status)?.[1] ?? 0);
      const name = (/^Name:\s*(.+)/m.exec(status)?.[1] ?? "").trim();
      const state = (/^State:\s*(\S+)/m.exec(status)?.[1] ?? "").trim();
      const rssKb = Number(/^VmRSS:\s*(\d+)/m.exec(status)?.[1] ?? 0);
      let cmd = "";
      try { cmd = readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0+/g, " ").trim(); } catch { /* kernel/permissão */ }
      all.set(pid, { pid, ppid, name: name || String(pid), cmd: cmd || name || String(pid), rssKb, state });
    } catch { /* processo terminou no meio */ }
  }
  if (!all.has(rootPid)) return [];
  const children = new Map<number, number[]>();
  for (const p of all.values()) {
    const list = children.get(p.ppid) ?? [];
    list.push(p.pid);
    children.set(p.ppid, list);
  }
  const out: ProcEntry[] = [];
  const seen = new Set<number>();
  const walk = (pid: number, depth: number) => {
    if (seen.has(pid)) return;
    seen.add(pid);
    const info = all.get(pid);
    if (!info) return;
    out.push({ ...info, depth });
    for (const c of (children.get(pid) ?? []).sort((a, b) => a - b)) walk(c, depth + 1);
  };
  walk(rootPid, 0);
  return out;
}
