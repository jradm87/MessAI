import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backupName, dataStats, dirSize, isBackupName, listBackups, performReset, performRestore, resolveDataDir, validateBackup, validateMoveTarget } from "./data.js";

let dir: string;
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "mess-data-")); });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("dados (#62) — operações de arquivo", () => {
  it("resolveDataDir: env vence; sem env nem ponteiro → padrão", () => {
    expect(resolveDataDir({ MESS_DATA_DIR: "/x/y" })).toEqual({ dir: "/x/y", source: "env" });
    const r = resolveDataDir({}); expect(["pointer", "default"]).toContain(r.source); // depende do HOME real: só o formato
  });
  it("dirSize/dataStats contam arquivos e subpastas; sockets não contam", () => {
    const d = join(dir, "dd"); mkdirSync(join(d, "notes", "ws1"), { recursive: true });
    writeFileSync(join(d, "runtime.sqlite"), "x".repeat(1000)); writeFileSync(join(d, "notes", "ws1", "a.md"), "y".repeat(300));
    const st = dataStats(d, "default");
    expect(st.bytes).toBe(1300); expect(st.dbBytes).toBe(1000); expect(st.notesBytes).toBe(300); expect(st.backupsBytes).toBe(0);
    expect(dirSize(join(d, "nao-existe"))).toBe(0);
  });
  it("listBackups só lista pastas com o prefixo, mais novas primeiro, e marca manifesto ausente", () => {
    const b = join(dir, "backups"); mkdirSync(join(b, "messai-backup-20260101-000000"), { recursive: true }); mkdirSync(join(b, "messai-backup-20260301-000000")); mkdirSync(join(b, "outra-coisa"));
    writeFileSync(join(b, "messai-backup-20260301-000000", "manifest.json"), JSON.stringify({ createdAt: "2026-03-01T00:00:00Z", buildVersion: 17, counts: { workspaces: 1, nodes: 2, notes: 0 }, source: "/x" }));
    const l = listBackups(b);
    expect(l.map((x) => x.name)).toEqual(["messai-backup-20260301-000000", "messai-backup-20260101-000000"]);
    expect(l[0]!.manifest?.counts.nodes).toBe(2); expect(l[1]!.manifest).toBeNull();
    expect(listBackups(join(dir, "nope"))).toEqual([]);
    expect(backupName(new Date("2026-11-01T18:05:09Z"))).toBe("messai-backup-20261101-180509");
    expect(isBackupName("messai-backup-x")).toBe(true); expect(isBackupName("../messai-backup-x")).toBe(false); expect(isBackupName("outra")).toBe(false);
  });
  it("validateBackup exige runtime.sqlite + manifest; performRestore troca banco e notas; performReset apaga só o que deve", () => {
    const data = join(dir, "data"); mkdirSync(join(data, "notes", "old"), { recursive: true });
    writeFileSync(join(data, "runtime.sqlite"), "atual"); writeFileSync(join(data, "runtime.sqlite-wal"), "wal"); writeFileSync(join(data, "notes", "old", "n.md"), "velha"); writeFileSync(join(data, "runtime.token"), "tok"); writeFileSync(join(data, "machine.id"), "id");
    mkdirSync(join(data, "backups", "b1"), { recursive: true }); writeFileSync(join(data, "backups", "b1", "x"), "bk");
    const bk = join(dir, "bk"); mkdirSync(join(bk, "notes", "new"), { recursive: true });
    expect(validateBackup(bk).ok).toBe(false);
    writeFileSync(join(bk, "runtime.sqlite"), "do-backup");
    expect(validateBackup(bk).ok).toBe(false); // sem manifesto
    writeFileSync(join(bk, "manifest.json"), JSON.stringify({ createdAt: "2026-01-01T00:00:00Z", buildVersion: 17, counts: { workspaces: 0, nodes: 0, notes: 0 }, source: "/y" }));
    writeFileSync(join(bk, "notes", "new", "m.md"), "nova");
    expect(validateBackup(bk).ok).toBe(true); expect(validateBackup("relativo").ok).toBe(false);
    performRestore(data, bk);
    expect(readFileSync(join(data, "runtime.sqlite"), "utf8")).toBe("do-backup");
    expect(existsSync(join(data, "runtime.sqlite-wal"))).toBe(false);
    expect(existsSync(join(data, "notes", "old"))).toBe(false); expect(readFileSync(join(data, "notes", "new", "m.md"), "utf8")).toBe("nova");
    expect(readFileSync(join(data, "runtime.token"), "utf8")).toBe("tok");
    performReset(data);
    expect(existsSync(join(data, "runtime.sqlite"))).toBe(false); expect(existsSync(join(data, "notes"))).toBe(false);
    expect(existsSync(join(data, "runtime.token"))).toBe(true); expect(existsSync(join(data, "machine.id"))).toBe(true); expect(existsSync(join(data, "backups", "b1", "x"))).toBe(true); // mantidos
  });
  it("validateMoveTarget: env bloqueia; mesma pasta, dentro da atual e destino não vazio são recusados", () => {
    const cur = join(dir, "cur"); mkdirSync(cur, { recursive: true }); const full = join(dir, "full"); mkdirSync(full); writeFileSync(join(full, "a"), "1");
    expect(validateMoveTarget(cur, join(dir, "novo"), "env").ok).toBe(false);
    expect(validateMoveTarget(cur, cur, "default").ok).toBe(false);
    expect(validateMoveTarget(cur, join(cur, "sub"), "default").ok).toBe(false);
    expect(validateMoveTarget(cur, full, "default").ok).toBe(false);
    expect(validateMoveTarget(cur, "relativo", "default").ok).toBe(false);
    expect(validateMoveTarget(cur, join(dir, "novo"), "default").ok).toBe(true);
    expect(validateMoveTarget(cur, join(dir, "novo"), "pointer").ok).toBe(true);
  });
});
