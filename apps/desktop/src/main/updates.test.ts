import { describe, expect, it } from "vitest";
import { applyUpdateEvent, friendlyUpdateError, initialUpdateState } from "./updates.js";

describe("auto-update (#61)", () => {
  it("fluxo: checking → available → progress → downloaded; not-available guarda a última checagem; erro guarda mensagem", () => {
    let s = initialUpdateState("0.0.1", true);
    expect(s.status).toBe("idle");
    s = applyUpdateEvent(s, { type: "checking" }); expect(s.status).toBe("checking");
    s = applyUpdateEvent(s, { type: "available", version: "0.0.2" }); expect(s).toMatchObject({ status: "available", version: "0.0.2", percent: 0 });
    s = applyUpdateEvent(s, { type: "progress", percent: 42.6 }); expect(s).toMatchObject({ status: "downloading", percent: 43 });
    s = applyUpdateEvent(s, { type: "progress", percent: 140 }); expect(s.percent).toBe(100);
    s = applyUpdateEvent(s, { type: "downloaded", version: "0.0.2", at: "2026-11-01T00:00:00Z" }); expect(s).toMatchObject({ status: "downloaded", percent: 100, lastCheck: "2026-11-01T00:00:00Z" });
    s = applyUpdateEvent(s, { type: "not-available", at: "t2" }); expect(s).toMatchObject({ status: "not-available", lastCheck: "t2" }); expect(s.version).toBeUndefined();
    s = applyUpdateEvent(s, { type: "error", message: "boom", at: "t3" }); expect(s).toMatchObject({ status: "error", error: "boom" });
    s = applyUpdateEvent(s, { type: "checking" }); expect(s.error).toBeUndefined();
  });
  it("não suportado (modo dev): ignora eventos", () => {
    const s = initialUpdateState("0.0.1", false);
    expect(s.status).toBe("unsupported");
    expect(applyUpdateEvent(s, { type: "available", version: "9" })).toBe(s);
  });
  it("friendlyUpdateError traduz os casos comuns sem stack", () => {
    expect(friendlyUpdateError("HttpError: 406 ... Cannot find latest version")).toContain("Nenhuma release");
    expect(friendlyUpdateError("Error: getaddrinfo ENOTFOUND github.com")).toBe("Sem conexão com o GitHub.");
    expect(friendlyUpdateError("x".repeat(300) + "\nstack")).toHaveLength(160);
  });
});
