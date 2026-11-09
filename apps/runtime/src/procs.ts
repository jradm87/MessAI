import { readdirSync, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import type { ProcEntry } from "@messai/contracts";
import { IS_WIN } from "./platform.js";

type RawProc = { pid: number; ppid: number; name: string; cmd: string; rssKb: number; state: string };

/**
 * #80 — Lê a árvore de processos a partir de um PID raiz em /proc (Linux).
 * Devolve todos os descendentes (incluindo a raiz), com profundidadade, RSS em KB e comando.
 */
export function readProcTree(rootPid: number): ProcEntry[] {
  if (!Number.isInteger(rootPid) || rootPid <= 0) return [];
  if (IS_WIN) { refreshWinProcs(); return buildProcTree(winProcs, rootPid); }
  const all = new Map<number, RawProc>();
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
  return buildProcTree(all, rootPid);
}

/** Monta a árvore a partir da raiz (raiz primeiro, filhos por pid, com profundidade). */
export function buildProcTree(all: Map<number, RawProc>, rootPid: number): ProcEntry[] {
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

// ---- Windows (#5): sem /proc. A consulta ao WMI leva ~1 s, então nunca bloqueia o runtime: roda em segundo plano e a API lê o último retrato. ----
const WIN_PROCS_TTL_MS = 3000;
let winProcs = new Map<number, RawProc>();
let winProcsAt = 0;
let winProcsBusy = false;

/** Converte o JSON de `Get-CimInstance Win32_Process` (objeto único vira lista; memória em bytes → KB). */
export function parseWinProcs(json: string): Map<number, RawProc> {
  const out = new Map<number, RawProc>();
  const v = JSON.parse(json) as unknown;
  for (const p of (Array.isArray(v) ? v : [v]) as { ProcessId: number; ParentProcessId: number; Name?: string | null; CommandLine?: string | null; WorkingSetSize?: number | null }[]) {
    const name = p.Name ?? String(p.ProcessId);
    out.set(p.ProcessId, { pid: p.ProcessId, ppid: p.ParentProcessId, name, cmd: p.CommandLine || name, rssKb: Math.round((p.WorkingSetSize ?? 0) / 1024), state: "" });
  }
  return out;
}

function refreshWinProcs(): void {
  if (winProcsBusy || Date.now() - winProcsAt < WIN_PROCS_TTL_MS) return;
  winProcsBusy = true;
  const cmd = "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine,WorkingSetSize | ConvertTo-Json -Compress";
  const child = execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", cmd], { windowsHide: true, timeout: 15_000, maxBuffer: 32 * 1024 * 1024, encoding: "utf8" }, (err, stdout) => {
    winProcsBusy = false; winProcsAt = Date.now();
    if (!err) { try { winProcs = parseWinProcs(stdout); } catch { /* mantém o retrato anterior */ } }
  });
  child.unref();
}
