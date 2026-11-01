import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { THIRD_PARTY } from "./generated/third-party.js";
// O gerador é um .mjs fora do TS; importado direto para garantir que o commitado bate com o node_modules atual.
// @ts-expect-error módulo JS sem tipos
import { collect, JSON_OUT, stable } from "../../../../../scripts/licenses.mjs";

describe("avisos de terceiros (#60)", () => {
  it("o arquivo gerado está em dia com as dependências instaladas (senão: npm run licenses)", () => {
    const now = collect() as { packages: unknown[]; missing: string[] };
    const committed = JSON.parse(readFileSync(JSON_OUT as string, "utf8")) as { packages: unknown[] };
    expect(now.missing, "dependências não resolvidas — rode npm ci").toEqual([]);
    expect(stable(committed)).toBe(stable(now));
    expect(THIRD_PARTY.packages.length).toBe(committed.packages.length); // o .ts importado pela aba é o mesmo conjunto
  });
  it("cobre a stack conhecida e cada entrada tem nome, versão e licença", () => {
    const names = new Set(THIRD_PARTY.packages.map((p) => p.name));
    for (const n of ["react", "react-dom", "@xyflow/react", "@xterm/xterm", "node-pty", "better-sqlite3", "fastify", "@fastify/websocket", "jotai", "chokidar", "@sinclair/typebox", "electron-updater", "lucide-react"]) expect(names.has(n), n).toBe(true);
    for (const p of THIRD_PARTY.packages) { expect(p.name.length).toBeGreaterThan(0); expect(p.version.length).toBeGreaterThan(0); expect(p.license.length).toBeGreaterThan(0); }
    expect(THIRD_PARTY.system.map((s) => s.name)).toContain("tmux");
    expect(THIRD_PARTY.system.map((s) => s.name)).toContain("SQLite");
  });
});
