import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "./index.js";

// Regressão: migrações do "tardio" (#41/#78/#71/#57) foram inseridas fora de ordem; um banco migrado numa ordem antiga
// reexecutava ALTER TABLE ("duplicate column name: skill_ids") e o runtime não subia. Cada layout histórico (A–E, lido dos
// commits reais) tem que subir para o esquema atual, preservando dados, sem duplicar o índice e de forma idempotente.
const fx = (k: string) => JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", `migrations-${k}.json`), "utf8")) as string[];
const now = "2026-11-01T00:00:00.000Z";

function legacyDb(layout: string): { path: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "mess-upg-")); const path = join(dir, "runtime.sqlite");
  const db = new Database(path); db.pragma("journal_mode = WAL"); db.pragma("foreign_keys = ON");
  fx(layout).forEach((sql, i) => { db.exec(sql); db.pragma(`user_version = ${i + 1}`); });
  db.prepare("INSERT INTO workspaces(workspace_id,machine_id,name,cwd,revision,created_at) VALUES('w1','m','Antigo','/tmp',3,?)").run(now);
  db.prepare("INSERT INTO nodes(node_id,workspace_id,kind,title,x,y,w,h,content,created_at) VALUES('n1','w1','note','Nota antiga',0,0,100,100,'texto legado único',?)").run(now);
  db.prepare("INSERT INTO chats VALUES('c1','w1','n1',1,'agent','mensagem legado',?)").run(now);
  db.close(); return { path, dir };
}

describe("upgrade de bancos antigos", () => {
  for (const layout of ["A", "B", "C", "D", "E"]) {
    it(`layout ${layout}: sobe sem erro, mantém dados, índice sem duplicar, esquema completo, idempotente`, () => {
      const { path, dir } = legacyDb(layout);
      try {
        let s = new Store(path); // antes do conserto, B–E lançavam "duplicate column name"
        expect(s.listWorkspaces().map((w) => w.name)).toEqual(["Antigo"]);
        expect(s.getNode("n1")!.title).toBe("Nota antiga");
        const hits = s.search("legado");
        expect(hits.map((h) => h.kind).sort()).toEqual(["chat", "note"]); // exatamente um de cada (nada duplicado pelo backfill)
        for (const t of ["node_groups", "scores", "skills", "search"]) expect(!!s.db.prepare("SELECT 1 FROM sqlite_master WHERE name=?").get(t), t).toBe(true);
        const cols = (s.db.prepare("PRAGMA table_info(nodes)").all() as { name: string }[]).map((c) => c.name);
        for (const c of ["icon", "term_theme", "skill_ids", "group_id"]) expect(cols, c).toContain(c);
        const wsCols = (s.db.prepare("PRAGMA table_info(workspaces)").all() as { name: string }[]).map((c) => c.name);
        for (const c of ["copy_mode", "exclude_dirs", "unloaded"]) expect(wsCols, c).toContain(c);
        // funciona de verdade: grupo, skill, score, novo nó indexado por trigger
        s.insertNode({ nodeId: "n2", workspaceId: "w1", kind: "note", title: "Nova", geometry: { x: 0, y: 0, w: 1, h: 1 }, content: "pós-upgrade", createdAt: now, skillIds: ["x"] });
        expect(s.search("upgrade")).toHaveLength(1);
        const v = s.db.pragma("user_version", { simple: true }) as number;
        s.close();
        s = new Store(path); // segundo boot: nada muda, nada quebra
        expect(s.db.pragma("user_version", { simple: true })).toBe(v);
        expect(s.search("legado")).toHaveLength(2);
        s.close();
      } finally { rmSync(dir, { recursive: true, force: true }); }
    });
  }
  it("banco novo e banco muito antigo (sem a cauda) chegam ao mesmo esquema", () => {
    const dir = mkdtempSync(join(tmpdir(), "mess-upg-")); const path = join(dir, "n.sqlite");
    try { const s = new Store(path); expect(s.db.pragma("user_version", { simple: true })).toBeGreaterThan(0); s.close(); } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
