import { describe, expect, it } from "vitest";
import { parsePowerMode, shouldBlock } from "./power.js";

describe("evitar suspensão (#55)", () => {
  it("decide pelo modo e pela presença de agentes", () => {
    expect(shouldBlock("never", true)).toBe(false);
    expect(shouldBlock("never", false)).toBe(false);
    expect(shouldBlock("agents", true)).toBe(true);
    expect(shouldBlock("agents", false)).toBe(false);
    expect(shouldBlock("always", false)).toBe(true);
  });
  it("parsePowerMode: valor desconhecido vira 'never' (nunca prende o sistema por engano)", () => {
    expect(parsePowerMode("agents")).toBe("agents");
    expect(parsePowerMode("always")).toBe("always");
    expect(parsePowerMode("sempre")).toBe("never");
    expect(parsePowerMode(undefined)).toBe("never");
    expect(parsePowerMode(1)).toBe("never");
  });
});
