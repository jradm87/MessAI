import { describe, expect, it } from "vitest";
import { buildProcTree, parseWinProcs, readProcTree } from "./procs.js";

describe("readProcTree (#80)", () => {
  // O: /proc é Linux-only; no Windows o monitor é degradado (#5) e este caso não se aplica
  it.skipIf(process.platform === "win32")("lista o próprio processo atual com RSS > 0 e depth 0", () => {
    const tree = readProcTree(process.pid);
    expect(tree.length).toBeGreaterThanOrEqual(1);
    expect(tree[0]?.pid).toBe(process.pid);
    expect(tree[0]?.depth).toBe(0);
    expect(tree[0]?.rssKb).toBeGreaterThan(0);
  });
  it("devolve vazio para PID inválido ou inexistente", () => {
    expect(readProcTree(-1)).toEqual([]);
    expect(readProcTree(999_999_999)).toEqual([]);
  });
});

describe("monitor no Windows (#5)", () => {
  const json = JSON.stringify([
    { ProcessId: 10, ParentProcessId: 1, Name: "powershell.exe", CommandLine: "powershell -NoLogo", WorkingSetSize: 2048000 },
    { ProcessId: 20, ParentProcessId: 10, Name: "node.exe", CommandLine: null, WorkingSetSize: 1024 },
    { ProcessId: 30, ParentProcessId: 99, Name: "outro.exe", CommandLine: "outro", WorkingSetSize: 1024 },
  ]);
  it("converte o WMI e monta só a árvore da raiz", () => {
    const tree = buildProcTree(parseWinProcs(json), 10);
    expect(tree.map((p) => [p.pid, p.depth])).toEqual([[10, 0], [20, 1]]);
    expect(tree[0]).toMatchObject({ rssKb: 2000, cmd: "powershell -NoLogo" });
    expect(tree[1]!.cmd).toBe("node.exe"); // CommandLine nula cai no nome
    expect(buildProcTree(parseWinProcs(json), 999)).toEqual([]);
  });
  it("aceita objeto único (ConvertTo-Json não gera lista com 1 item)", () => {
    expect(parseWinProcs(JSON.stringify({ ProcessId: 5, ParentProcessId: 1, Name: "a" })).get(5)?.name).toBe("a");
  });
});
