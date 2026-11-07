import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveDefaultShell } from "./config.js";

let dir: string;
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "mess-shell-")); });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("resolveDefaultShell no Windows (#3)", () => {
  it("MESS_SHELL > pwsh no PATH > powershell.exe do System32 > ComSpec", () => {
    const bin = join(dir, "bin"); mkdirSync(bin, { recursive: true });
    const none = () => false;
    expect(resolveDefaultShell({ MESS_SHELL: " C:\\x\\nu.exe " }, true, none)).toBe("C:\\x\\nu.exe");
    writeFileSync(join(bin, "pwsh.exe"), "");
    expect(resolveDefaultShell({ Path: bin }, true, none)).toBe(join(bin, "pwsh.exe"));
    const ps = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
    expect(resolveDefaultShell({ SystemRoot: "C:\\Windows", Path: "" }, true, (p) => p === ps)).toBe(ps);
    expect(resolveDefaultShell({ ComSpec: "C:\\Windows\\system32\\cmd.exe", Path: "" }, true, none)).toBe("C:\\Windows\\system32\\cmd.exe");
    expect(resolveDefaultShell({ Path: "" }, true, none)).toBe("cmd.exe");
  });
});
