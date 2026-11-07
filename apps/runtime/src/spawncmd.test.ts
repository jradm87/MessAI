import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cmdlineLength, fitAppendPrompt, npmShimTarget, resolveSpawnCommand, WIN_CMDLINE_BUDGET } from "./spawncmd.js";

let dir: string;
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "mess-spawn-")); });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const SHIM = `@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n` +
  `IF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n) ELSE (\r\n  SET "_prog=node"\r\n)\r\n` +
  `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n`;

describe("resolveSpawnCommand (A)", () => {
  it("fora do Windows não mexe", () => {
    expect(resolveSpawnCommand("claude", ["-x"], { PATH: "/usr/bin" }, false)).toEqual({ command: "claude", args: ["-x"], via: "direct" });
  });
  it("Windows: .exe vira caminho completo; shim npm vira node <script>; .cmd comum vai pelo cmd.exe; ausente fica igual", () => {
    const bin = join(dir, "bin"); mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "claude.exe"), "");
    writeFileSync(join(bin, "codex.cmd"), SHIM);
    writeFileSync(join(bin, "node.exe"), "");
    writeFileSync(join(bin, "outro.cmd"), "@echo off\r\necho oi\r\n");
    const env = { Path: bin, PATHEXT: ".COM;.EXE;.BAT;.CMD", ComSpec: "C:\\Windows\\system32\\cmd.exe" };
    expect(resolveSpawnCommand("claude", ["--v"], env, true)).toEqual({ command: join(bin, "claude.exe"), args: ["--v"], via: "direct" });
    expect(resolveSpawnCommand("codex", ["a\nb"], env, true)).toEqual({
      command: join(bin, "node.exe"), args: [join(bin, "node_modules", "@openai", "codex", "bin", "codex.js"), "a\nb"], via: "node-shim" });
    expect(resolveSpawnCommand("outro", ["x"], env, true)).toEqual({ command: "C:\\Windows\\system32\\cmd.exe", args: ["/d", "/s", "/c", join(bin, "outro.cmd"), "x"], via: "cmd" });
    expect(resolveSpawnCommand("nao-existe", [], env, true)).toEqual({ command: "nao-existe", args: [], via: "direct" });
  });
  it("npmShimTarget lê o script do shim do cmd-shim", () => {
    expect(npmShimTarget(join("C:", "npm", "codex.cmd"), SHIM)).toBe(join("C:", "npm", "node_modules", "@openai", "codex", "bin", "codex.js"));
    expect(npmShimTarget("x.cmd", "@echo off\r\n")).toBeNull();
  });
});

describe("texto longo fora do argv no Windows (A)", () => {
  const role = "papel\n".repeat(3000) + "x".repeat(20_000); // ~38 k: estoura o teto do CreateProcess
  const args = ["--append-system-prompt", role, "--dangerously-skip-permissions"];
  it("acima do orçamento troca por --append-system-prompt-file; abaixo (ou fora do Windows) não mexe", () => {
    expect(cmdlineLength("claude", args)).toBeGreaterThan(WIN_CMDLINE_BUDGET);
    let written = "";
    const out = fitAppendPrompt("claude", args, (t) => { written = t; return "C:\\data\\prompts\\s1.md"; }, true);
    expect(out).toEqual(["--append-system-prompt-file", "C:\\data\\prompts\\s1.md", "--dangerously-skip-permissions"]);
    expect(written).toBe(role);
    expect(cmdlineLength("claude", out)).toBeLessThan(WIN_CMDLINE_BUDGET);
    expect(fitAppendPrompt("claude", args, () => "nunca", false)).toBe(args);
    const small = ["--append-system-prompt", "curto"];
    expect(fitAppendPrompt("claude", small, () => "nunca", true)).toBe(small);
  });
});
