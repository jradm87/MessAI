import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve, sep } from "node:path";

/**
 * #62 — Dados: onde ficam, quanto ocupam, backup/restauração, troca de pasta e reset.
 * Só operações de arquivo aqui (testáveis com pastas temporárias); quem para/sobe sessões e fecha o banco é o index.ts.
 */
export const DEFAULT_DATA_DIR = () => join(homedir(), ".messai");
export const DATA_POINTER = () => join(DEFAULT_DATA_DIR(), "datadir"); // texto: caminho absoluto da pasta de dados escolhida
export const BACKUP_PREFIX = "messai-backup-";
/** Arquivos que NÃO viajam em backup/move: voláteis ou identidade desta máquina. */
const SKIP = new Set(["agent.sock", "runtime.pid", "runtime.log", "runtime.sqlite-wal", "runtime.sqlite-shm", "backups", "datadir"]);

/** Resolve a pasta de dados: MESS_DATA_DIR (env) > ponteiro ~/.messai/datadir > ~/.messai. */
export function resolveDataDir(env: NodeJS.ProcessEnv = process.env): { dir: string; source: "env" | "pointer" | "default" } {
  if (env["MESS_DATA_DIR"]) return { dir: env["MESS_DATA_DIR"], source: "env" };
  try {
    const p = readFileSync(DATA_POINTER(), "utf8").trim();
    if (p && isAbsolute(p)) { mkdirSync(p, { recursive: true, mode: 0o700 }); return { dir: p, source: "pointer" }; }
  } catch { /* sem ponteiro ou ilegível */ }
  return { dir: DEFAULT_DATA_DIR(), source: "default" };
}

export function dirSize(p: string): number {
  let total = 0;
  try {
    const st = statSync(p);
    if (!st.isDirectory()) return st.size;
    for (const f of readdirSync(p)) { const fp = join(p, f); try { const s = statSync(fp); total += s.isDirectory() ? dirSize(fp) : s.isSocket() ? 0 : s.size; } catch { /* sumiu */ } }
  } catch { /* não existe */ }
  return total;
}
const sizeOf = (p: string) => { try { return statSync(p).size; } catch { return 0; } };

export type DataStats = { dir: string; source: "env" | "pointer" | "default"; bytes: number; dbBytes: number; notesBytes: number; backupsBytes: number; backupsDir: string };
export function dataStats(dir: string, source: DataStats["source"]): DataStats {
  const backupsDir = join(dir, "backups");
  return {
    dir, source, bytes: dirSize(dir), backupsDir,
    dbBytes: sizeOf(join(dir, "runtime.sqlite")) + sizeOf(join(dir, "runtime.sqlite-wal")) + sizeOf(join(dir, "runtime.sqlite-shm")),
    notesBytes: dirSize(join(dir, "notes")), backupsBytes: dirSize(backupsDir),
  };
}

export type BackupManifest = { createdAt: string; buildVersion: number; counts: { workspaces: number; nodes: number; notes: number }; source: string };
export type BackupEntry = { name: string; path: string; bytes: number; manifest: BackupManifest | null };
export function listBackups(backupsDir: string): BackupEntry[] {
  if (!existsSync(backupsDir)) return [];
  return readdirSync(backupsDir).filter((n) => n.startsWith(BACKUP_PREFIX)).sort().reverse().map((name) => {
    const path = join(backupsDir, name);
    let manifest: BackupManifest | null = null;
    try { manifest = JSON.parse(readFileSync(join(path, "manifest.json"), "utf8")) as BackupManifest; } catch { /* sem manifesto: ainda listamos, marcado */ }
    return { name, path, bytes: dirSize(path), manifest };
  });
}
export const backupName = (d = new Date()) => `${BACKUP_PREFIX}${d.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15)}`;

/** Copia notas/provedores/identidade para a pasta do backup. O banco entra à parte (VACUUM INTO, consistente). */
export function copyBackupFiles(dataDir: string, dest: string): void {
  for (const f of ["notes", "providers", "machine.id", "hud.json"]) { const src = join(dataDir, f); if (existsSync(src)) cpSync(src, join(dest, f), { recursive: true }); }
}
export function writeManifest(dest: string, m: BackupManifest): void { writeFileSync(join(dest, "manifest.json"), JSON.stringify(m, null, 1)); }

/** Um backup válido tem runtime.sqlite e manifest.json; recusa qualquer outra pasta. */
export function validateBackup(path: string): { ok: true; manifest: BackupManifest } | { ok: false; error: string } {
  if (!isAbsolute(path)) return { ok: false, error: "caminho do backup precisa ser absoluto" };
  if (!existsSync(join(path, "runtime.sqlite"))) return { ok: false, error: "pasta sem runtime.sqlite — não é um backup do MessAI" };
  try { const m = JSON.parse(readFileSync(join(path, "manifest.json"), "utf8")) as BackupManifest; if (!m.createdAt) throw new Error("manifesto sem createdAt"); return { ok: true, manifest: m }; }
  catch (e) { return { ok: false, error: `manifest.json inválido: ${e instanceof Error ? e.message : String(e)}` }; }
}
/** Executado com o banco FECHADO e as sessões paradas: troca banco e notas pelos do backup. */
export function performRestore(dataDir: string, backupPath: string): void {
  for (const f of ["runtime.sqlite", "runtime.sqlite-wal", "runtime.sqlite-shm"]) rmSync(join(dataDir, f), { force: true });
  cpSync(join(backupPath, "runtime.sqlite"), join(dataDir, "runtime.sqlite"));
  rmSync(join(dataDir, "notes"), { recursive: true, force: true });
  if (existsSync(join(backupPath, "notes"))) cpSync(join(backupPath, "notes"), join(dataDir, "notes"), { recursive: true });
  if (existsSync(join(backupPath, "providers"))) cpSync(join(backupPath, "providers"), join(dataDir, "providers"), { recursive: true });
}
/** Apaga espaços/nós/sessões/notas/chats/papéis/skills/presets/configurações; MANTÉM backups, provedores extras, token e machine.id. */
export function performReset(dataDir: string): void {
  for (const f of ["runtime.sqlite", "runtime.sqlite-wal", "runtime.sqlite-shm", "hud.json"]) rmSync(join(dataDir, f), { force: true });
  rmSync(join(dataDir, "notes"), { recursive: true, force: true });
}
export function validateMoveTarget(dataDir: string, target: string, source: DataStats["source"]): { ok: true } | { ok: false; error: string } {
  if (source === "env") return { ok: false, error: "a pasta de dados vem de MESS_DATA_DIR (ambiente); mude a variável em vez disso" };
  if (!isAbsolute(target)) return { ok: false, error: "escolha um caminho absoluto" };
  const t = resolve(target), d = resolve(dataDir);
  if (t === d) return { ok: false, error: "é a pasta atual" };
  if (t.startsWith(d + sep)) return { ok: false, error: "a nova pasta não pode ficar dentro da atual" };
  if (existsSync(t) && readdirSync(t).length > 0) return { ok: false, error: "a pasta de destino precisa estar vazia" };
  return { ok: true };
}
/** Copia tudo (menos voláteis e backups) para a nova pasta e grava o ponteiro; a pasta antiga fica como estava. */
export function performMove(dataDir: string, target: string): void {
  mkdirSync(target, { recursive: true, mode: 0o700 });
  for (const f of readdirSync(dataDir)) { if (SKIP.has(f)) continue; cpSync(join(dataDir, f), join(target, f), { recursive: true }); }
  mkdirSync(DEFAULT_DATA_DIR(), { recursive: true, mode: 0o700 });
  writeFileSync(DATA_POINTER(), resolve(target) + "\n", { mode: 0o600 });
}
export const isBackupName = (n: string) => n.startsWith(BACKUP_PREFIX) && !n.includes("/") && !n.includes("..") && basename(n) === n;
