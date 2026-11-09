import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { getPath, isPathLike, pathExts, pathKey, powershellInitArgs, prependPath, reservedEnvName, shellCommandArgs, socketPathFor, toPosixPath } from "./platform.js";

describe("platform (porte Windows)", () => {
  it("pathKey/getPath: Windows acha a chave em qualquer caixa; fora dele é sempre PATH", () => {
    expect(pathKey({ Path: "a" }, true)).toBe("Path");
    expect(pathKey({ PATH: "a" }, true)).toBe("PATH");
    expect(pathKey({}, true)).toBe("PATH");
    expect(pathKey({ Path: "a" }, false)).toBe("PATH");
    expect(getPath({ Path: "C:\\x" }, true)).toBe("C:\\x");
    expect(getPath({ Path: "C:\\x" }, false)).toBe("");
  });
  it("prependPath (C): preserva a chave existente e não deixa PATH + Path duplicados", () => {
    expect(prependPath({ Path: "C:\\w", X: "1" }, "C:\\cli", true)).toEqual({ Path: "C:\\cli;C:\\w", X: "1" });
    const dup = prependPath({ PATH: "C:\\a", Path: "C:\\b" }, "C:\\cli", true);
    expect(Object.keys(dup).filter((k) => k.toUpperCase() === "PATH")).toHaveLength(1);
    expect(prependPath({ PATH: "/usr/bin" }, "/cli", false)).toEqual({ PATH: "/cli:/usr/bin" });
    expect(prependPath({}, "/cli", false)).toEqual({ PATH: "/cli" });
  });
  it("pathExts: PATHEXT em minúsculas, sem \"\" no Windows; [\"\"] fora dele", () => {
    expect(pathExts({ PATHEXT: ".COM;.EXE;.CMD" }, true)).toEqual([".com", ".exe", ".cmd"]);
    expect(pathExts({}, true)).toEqual([".com", ".exe", ".bat", ".cmd"]);
    expect(pathExts({ PATHEXT: ".EXE" }, false)).toEqual([""]);
  });
  it("socketPathFor (#6): Linux agent.sock; Windows named pipe estável por pasta, sem caixa/barra final", () => {
    expect(socketPathFor("/home/u/.messai", false)).toBe(join("/home/u/.messai", "agent.sock"));
    const a = socketPathFor("C:\\Users\\U\\.messai", true);
    expect(a).toMatch(/^\\\\\.\\pipe\\messai-[0-9a-f]{16}$/);
    expect(socketPathFor("c:/users/u/.messai/", true)).toBe(a);
    expect(socketPathFor("D:\\MessAI", true)).not.toBe(a);
  });
  it("shellCommandArgs (F): flag certa por shell", () => {
    expect(shellCommandArgs("/bin/sh", "echo a")).toEqual(["-c", "echo a"]);
    const utf8 = "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ";
    expect(shellCommandArgs("C:\\Program Files\\PowerShell\\7\\pwsh.exe", "echo a")).toEqual(["-NoProfile", "-NonInteractive", "-Command", `${utf8}echo a`]);
    expect(shellCommandArgs("C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", "x")).toEqual(["-NoProfile", "-NonInteractive", "-Command", `${utf8}x`]);
    expect(shellCommandArgs("C:\\Windows\\system32\\cmd.exe", "dir")).toEqual(["/d", "/s", "/c", "dir"]);
    expect(shellCommandArgs("C:\\Program Files\\Git\\bin\\bash.exe", "ls")).toEqual(["-c", "ls"]);
  });
  it("reservedEnvName: caixa só importa fora do Windows", () => {
    expect(reservedEnvName("path", true)).toBe(true);
    expect(reservedEnvName("mess_token", true)).toBe(true);
    expect(reservedEnvName("path", false)).toBe(false);
    expect(reservedEnvName("PATH", false)).toBe(true);
    expect(reservedEnvName("API_KEY", true)).toBe(false);
  });
  it("powershellInitArgs (H): só PowerShell sem argumentos", () => {
    expect(powershellInitArgs("C:\\x\\powershell.exe", [])[0]).toBe("-NoExit");
    expect(powershellInitArgs("pwsh", ["-File", "a.ps1"])).toEqual(["-File", "a.ps1"]);
    expect(powershellInitArgs("claude", [])).toEqual([]);
  });
  it("isPathLike e toPosixPath", () => {
    expect(isPathLike("claude", true)).toBe(false);
    expect(isPathLike("C:\\x\\claude.cmd", true)).toBe(true);
    expect(isPathLike("bin\\claude", true)).toBe(true);
    expect(isPathLike("bin\\claude", false)).toBe(false);
    expect(isPathLike("/usr/bin/claude", false)).toBe(true);
    expect(toPosixPath("C:\\Users\\ctscs\\mess")).toBe("/c/Users/ctscs/mess");
    expect(toPosixPath("D:\\")).toBe("/d");
    expect(toPosixPath("/usr/bin")).toBe("/usr/bin");
  });
});
