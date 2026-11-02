import { afterEach, describe, expect, it, vi } from "vitest";
import { Api } from "./api.js";

const conn = { baseUrl: "http://x", wsUrl: "ws://x", token: "t" };
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("Api: runtime ainda subindo", () => {
  it("GET repete quando a rede recusa e devolve o resultado assim que o runtime responde", async () => {
    vi.useFakeTimers();
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => { calls++; if (calls < 4) throw new TypeError("Failed to fetch"); return ok([{ id: "shell" }]); }));
    const p = new Api(conn).presets();
    await vi.advanceTimersByTimeAsync(2000);
    await expect(p).resolves.toEqual([{ id: "shell" }]);
    expect(calls).toBe(4);
  });
  it("GET desiste depois de ~15 s; escrita (POST) NÃO repete", async () => {
    vi.useFakeTimers();
    const f = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    vi.stubGlobal("fetch", f);
    const g = new Api(conn).presets(); const assertion = expect(g).rejects.toThrow("Failed to fetch");
    await vi.advanceTimersByTimeAsync(20_000); await assertion;
    expect(f).toHaveBeenCalledTimes(31);
    f.mockClear();
    await expect(new Api(conn).deleteScore("x")).rejects.toThrow(); // DELETE: uma tentativa só
    expect(f).toHaveBeenCalledTimes(1);
  });
});
