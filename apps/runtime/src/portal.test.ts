import { describe, expect, it } from "vitest";
import { findBrowser, windowsBrowserPaths } from "./portal.js";

describe("findBrowser no Windows (E)", () => {
  const env = { ProgramFiles: "C:\\Program Files", "ProgramFiles(x86)": "C:\\Program Files (x86)", LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local", Path: "" };
  const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  const chrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  it("MESS_BROWSER manda; Chrome antes do Edge; Edge quando é o único; nada → null", () => {
    expect(findBrowser({ ...env, MESS_BROWSER: "D:\\x\\b.exe" }, true, () => false)).toBe("D:\\x\\b.exe");
    expect(findBrowser(env, true, (p) => p === chrome || p === edge)).toBe(chrome);
    expect(findBrowser(env, true, (p) => p === edge)).toBe(edge);
    expect(findBrowser(env, true, () => false)).toBeNull();
  });
  it("inclui o Chrome por usuário em LOCALAPPDATA", () => {
    expect(windowsBrowserPaths(env)).toContain("C:\\Users\\u\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe");
  });
});
