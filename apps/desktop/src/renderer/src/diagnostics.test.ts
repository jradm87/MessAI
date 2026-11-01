import { describe, expect, it } from "vitest";
import { buildReport, redactLine, type AppInfo } from "./diagnostics.js";

const app: AppInfo = { name: "MessAI", version: "0.0.1", buildVersion: 17, electron: "45.1.0", node: "22.0.0", chrome: "140", platform: "linux", arch: "x64", dataDir: "/home/x/.messai", packaged: false };

describe("relatório de problema (#63)", () => {
  it("inclui só as seções marcadas; descrição vai primeiro; log é redigido", () => {
    const r = buildReport({ app, runtime: { ok: true, buildVersion: 17, protocolVersion: 3 }, providers: [{ id: "claude", path: "/usr/bin/claude" }, { id: "codex", path: null }], counts: { workspaces: 2, nodes: 5, terminals: 3 }, logTail: "GET /v1/x authorization=Bearer abc.def-ghi ok\nsk-1234567890abcdef used\nid 0123456789abcdef0123456789abcdef0123", description: " travou ao abrir " }, { runtime: true, providers: true, counts: true, log: true });
    expect(r.indexOf("## O que aconteceu")).toBeLessThan(r.indexOf("## Versões"));
    expect(r).toContain("travou ao abrir");
    expect(r).toContain("build 17, desenvolvimento");
    expect(r).toContain("- claude: encontrado"); expect(r).toContain("- codex: não encontrado");
    expect(r).toContain("espaços: 2 · nós: 5 · terminais: 3");
    expect(r).not.toContain("abc.def-ghi"); expect(r).not.toContain("sk-1234567890abcdef"); expect(r).not.toContain("0123456789abcdef0123456789abcdef0123");
    expect(r).toContain("Bearer [redigido]");
    const min = buildReport({ app }, { runtime: false, providers: false, counts: false, log: false });
    expect(min).toContain("## Versões"); expect(min).not.toContain("## Runtime"); expect(min).not.toContain("## Provedores");
    expect(buildReport({ app, logTail: "" }, { runtime: false, providers: false, counts: false, log: true })).toContain("runtime.log vazio ou ausente"); // log pedido mas sem arquivo: diz, não some
  });
  it("redactLine deixa texto normal em paz", () => {
    expect(redactLine("sessões: 1 reanexada(s)")).toBe("sessões: 1 reanexada(s)");
    expect(redactLine("ws?token=abc123&x=1")).toBe("ws?token=[redigido]&x=1");
  });
});
