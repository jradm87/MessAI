import { describe, expect, it } from "vitest";
import { readProcTree } from "./procs.js";

describe("readProcTree (#80)", () => {
  it("lista o próprio processo atual com RSS > 0 e depth 0", () => {
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
