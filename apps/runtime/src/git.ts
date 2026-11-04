import { execFile } from "node:child_process";
import type { GitBranch, GitCommitEntry, GitDiff, GitFile, GitInfo, GitOpResult } from "@messai/contracts";

/** #30 — git do espaço. Sem shell (execFile), sem prompts interativos, com timeout e teto de saída; nomes de refs validados. */
export type GitRun = { status: number; stdout: string; stderr: string };
export function runGit(root: string, args: string[], opts: { timeoutMs?: number; maxBuffer?: number } = {}): Promise<GitRun> {
  return new Promise((resolve) => {
    execFile("git", ["-C", root, ...args], {
      timeout: opts.timeoutMs ?? 15_000, maxBuffer: opts.maxBuffer ?? 8 * 1024 * 1024, encoding: "utf8",
      // nunca pergunta senha/frase/editor (travaria o runtime): falha com mensagem; ssh em lote
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_EDITOR: "true", GIT_PAGER: "cat", GIT_SSH_COMMAND: process.env["GIT_SSH_COMMAND"] ?? "ssh -o BatchMode=yes" },
    }, (err, stdout, stderr) => {
      const code = err ? ((err as { code?: number | string }).code) : 0;
      resolve({ status: typeof code === "number" ? code : err ? 1 : 0, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") + (err && typeof code !== "number" ? `\n${(err as Error).message}` : "") });
    });
  });
}

/** Nome de branch/ref aceito: sem "-" inicial (viraria opção), sem "..", "@{", "//", ".lock" no fim etc. */
export function isSafeRef(name: string): boolean {
  return /^[A-Za-z0-9_][A-Za-z0-9._/@+-]{0,199}$/.test(name) && !name.includes("..") && !name.includes("@{") && !name.includes("//") && !name.endsWith("/") && !name.endsWith(".lock") && !name.endsWith(".");
}

const CONFLICT = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);
/** `git status --porcelain=v1 -z -b --untracked-files=all` → ramo, upstream, ahead/behind e arquivos. */
export function parseStatusZ(out: string): { branch?: string; detached: boolean; upstream?: string; ahead: number; behind: number; files: GitFile[] } {
  const recs = out.split("\0"); let branch: string | undefined; let detached = false; let upstream: string | undefined; let ahead = 0; let behind = 0; const files: GitFile[] = [];
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i]!; if (!r) continue;
    if (r.startsWith("## ")) {
      const h = r.slice(3);
      if (h.startsWith("HEAD (no branch)")) { detached = true; continue; }
      const nc = /^No commits yet on (.+)$/.exec(h); if (nc) { branch = nc[1]!; continue; }
      const m = /^(\S+?)(?:\.\.\.(\S+))?(?: \[(.*)\])?$/.exec(h);
      if (m) { branch = m[1]!; upstream = m[2]; const a = /ahead (\d+)/.exec(m[3] ?? ""); const b = /behind (\d+)/.exec(m[3] ?? ""); ahead = a ? Number(a[1]) : 0; behind = b ? Number(b[1]) : 0; }
      continue;
    }
    if (r.length < 4) continue;
    const x = r[0]!; const y = r[1]!; const path = r.slice(3);
    if (x === "R" || x === "C") i++; // o registro seguinte é o caminho de origem
    const xy = x + y;
    const untracked = xy === "??";
    const code = CONFLICT.has(xy) ? "U" : untracked ? "?" : x !== " " ? x : y;
    files.push({ path, code, staged: !untracked && x !== " " && !CONFLICT.has(xy), unstaged: untracked || (y !== " ") });
  }
  return { ...(branch ? { branch } : {}), detached, ...(upstream ? { upstream } : {}), ahead, behind, files };
}

export async function gitInfo(root: string): Promise<GitInfo> {
  const st = await runGit(root, ["status", "--porcelain=v1", "-z", "-b", "--untracked-files=all"], { timeoutMs: 8000 });
  if (st.status !== 0) return { isRepo: false, ahead: 0, behind: 0, merging: false, files: [], branches: [] };
  const p = parseStatusZ(st.stdout);
  const [refs, merge] = await Promise.all([
    runGit(root, ["for-each-ref", "--format=%(refname)%09%(HEAD)", "refs/heads", "refs/remotes"], { timeoutMs: 8000 }),
    runGit(root, ["rev-parse", "-q", "--verify", "MERGE_HEAD"], { timeoutMs: 4000 }),
  ]);
  const branches: GitBranch[] = [];
  for (const line of refs.stdout.split("\n")) {
    if (!line) continue; const [ref, head] = line.split("\t"); if (!ref) continue;
    const remote = ref.startsWith("refs/remotes/"); const name = ref.replace(/^refs\/(heads|remotes)\//, "");
    if (remote && name.endsWith("/HEAD")) continue;
    branches.push({ name, current: head === "*", remote });
  }
  return { isRepo: true, ...(p.branch ? { branch: p.branch } : {}), ...(p.detached ? { detached: true } : {}), ...(p.upstream ? { upstream: p.upstream } : {}), ahead: p.ahead, behind: p.behind, merging: merge.status === 0, files: p.files, branches };
}

export async function gitLog(root: string, limit: number, path?: string): Promise<GitCommitEntry[]> {
  const r = await runGit(root, ["log", "-n", String(Math.max(1, Math.min(limit, 500))), "--format=%H%x1f%an%x1f%aI%x1f%s%x1e", ...(path ? ["--", path] : [])], { timeoutMs: 8000 });
  if (r.status !== 0) return []; // sem commits ainda / fora de repo
  return r.stdout.split("\x1e").map((s) => s.trim()).filter(Boolean).map((rec) => { const [hash = "", author = "", date = "", subject = ""] = rec.split("\x1f"); return { hash, short: hash.slice(0, 8), author, date, subject }; });
}

const DIFF_LIMIT = 256 * 1024;
export async function gitDiff(root: string, path?: string): Promise<GitDiff> {
  const base = ["diff", "--no-color", "--no-ext-diff", "--no-textconv"];
  let r = await runGit(root, [...base, "HEAD", ...(path ? ["--", path] : [])], { timeoutMs: 10_000, maxBuffer: DIFF_LIMIT * 4 });
  if (r.status === 128) r = await runGit(root, [...base, ...(path ? ["--", path] : [])], { timeoutMs: 10_000, maxBuffer: DIFF_LIMIT * 4 }); // repo sem commits
  let text = r.status === 0 ? r.stdout : "";
  if (!text && path) { // arquivo novo (não rastreado): mostra como adição
    const u = await runGit(root, [...base, "--no-index", "--", "/dev/null", path], { timeoutMs: 10_000, maxBuffer: DIFF_LIMIT * 4 });
    if (u.status === 1) text = u.stdout; // --no-index sai 1 quando há diferença
  }
  return { ...(path ? { path } : {}), text: text.length > DIFF_LIMIT ? text.slice(0, DIFF_LIMIT) : text, truncated: text.length > DIFF_LIMIT };
}

const out = (r: GitRun): string => `${r.stdout}${r.stderr ? `\n${r.stderr}` : ""}`.trim().slice(-8000);
export const opResult = (r: GitRun, extra: Partial<GitOpResult> = {}): GitOpResult => ({ ok: r.status === 0, output: out(r), ...extra });

export async function gitConflicts(root: string): Promise<string[]> {
  const r = await runGit(root, ["diff", "--name-only", "--diff-filter=U"], { timeoutMs: 8000 });
  return r.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
}
export async function gitCommit(root: string, message: string, paths?: string[]): Promise<GitOpResult> {
  const add = await runGit(root, ["add", "-A", "--", ...(paths?.length ? paths : ["."])], { timeoutMs: 30_000 });
  if (add.status !== 0) return opResult(add);
  return opResult(await runGit(root, ["commit", "-m", message, ...(paths?.length ? ["--", ...paths] : [])], { timeoutMs: 60_000 }));
}
export async function gitCreateBranch(root: string, name: string, from?: string): Promise<GitOpResult> { return opResult(await runGit(root, ["checkout", "-b", name, ...(from ? [from] : []), "--"], { timeoutMs: 20_000 })); }
export async function gitCheckout(root: string, branch: string): Promise<GitOpResult> { return opResult(await runGit(root, ["checkout", branch, "--"], { timeoutMs: 20_000 })); }
export async function gitMerge(root: string, branch: string): Promise<GitOpResult> {
  const r = await runGit(root, ["merge", "--no-edit", branch], { timeoutMs: 60_000 });
  if (r.status === 0) return opResult(r);
  const conflicts = await gitConflicts(root);
  return opResult(r, conflicts.length ? { conflicts } : {});
}
export async function gitMergeAbort(root: string): Promise<GitOpResult> { return opResult(await runGit(root, ["merge", "--abort"], { timeoutMs: 20_000 })); }
export async function gitPull(root: string): Promise<GitOpResult> { return opResult(await runGit(root, ["pull", "--ff-only"], { timeoutMs: 90_000 })); } // só avanço rápido: nunca cria merge/rebase às escondidas
export async function gitPush(root: string, setUpstream: boolean, branch?: string): Promise<GitOpResult> {
  if (!setUpstream) return opResult(await runGit(root, ["push"], { timeoutMs: 90_000 }));
  const remotes = (await runGit(root, ["remote"], { timeoutMs: 5000 })).stdout.split("\n").map((s) => s.trim()).filter(Boolean);
  const remote = remotes.includes("origin") ? "origin" : remotes[0];
  if (!remote) return { ok: false, output: "nenhum remote configurado (git remote add origin <url>)" };
  if (!branch) return { ok: false, output: "sem branch atual (HEAD solto)" };
  return opResult(await runGit(root, ["push", "-u", remote, branch], { timeoutMs: 90_000 }));
}
