import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jwtPayload, probeAccounts } from "./accounts.js";
import { BUILTIN_PROVIDERS, listProviders, loadExtraProviders, whichOnPath } from "./providers.js";

let dir: string;
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "mess-agents-")); });
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const b64url = (s: string) => Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

describe("provedores (#38)", () => {
  it("whichOnPath acha executável no PATH informado; caminho absoluto precisa ser executável", () => {
    const bin = join(dir, "bin"); mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "fake-cli"), "#!/bin/sh\n"); chmodSync(join(bin, "fake-cli"), 0o755);
    writeFileSync(join(bin, "nao-exec"), "");
    expect(whichOnPath("fake-cli", { PATH: bin })).toBe(join(bin, "fake-cli"));
    expect(whichOnPath("nao-exec", { PATH: bin })).toBeNull();
    expect(whichOnPath("inexistente", { PATH: bin })).toBeNull();
    expect(whichOnPath(join(bin, "fake-cli"))).toBe(join(bin, "fake-cli"));
    expect(whichOnPath("")).toBeNull();
  });
  it("extras em JSON: válido entra; inválido/repetido/embutido vira erro sem derrubar a lista", () => {
    const pd = join(dir, "providers"); mkdirSync(pd, { recursive: true });
    writeFileSync(join(pd, "a-meu.json"), JSON.stringify({ id: "meu", label: "Meu CLI", binary: "fake-cli", color: "#123456" }));
    writeFileSync(join(pd, "b-semlabel.json"), JSON.stringify({ id: "x", binary: "y" }));
    writeFileSync(join(pd, "c-lixo.json"), "{nope");
    writeFileSync(join(pd, "d-claude.json"), JSON.stringify({ id: "claude", label: "Hack", binary: "claude" }));
    writeFileSync(join(pd, "e-corinvalida.json"), JSON.stringify({ id: "outro", label: "Outro", binary: "zzz", color: "azul" }));
    writeFileSync(join(pd, "ignorado.txt"), "x");
    const r = loadExtraProviders(pd);
    expect(r.providers.map((p) => p.id)).toEqual(["meu", "outro"]);
    expect(r.providers[1]!.color).toBe("#8a8a90"); // cor inválida → cinza padrão
    expect(r.errors.map((e) => e.file.split("/").pop())).toEqual(["b-semlabel.json", "c-lixo.json", "d-claude.json"]);
    const all = listProviders(pd, { PATH: join(dir, "bin") });
    expect(all.providers.slice(0, BUILTIN_PROVIDERS.length).every((p) => p.builtin)).toBe(true);
    expect(all.providers.find((p) => p.id === "meu")).toMatchObject({ path: join(dir, "bin", "fake-cli"), builtin: false });
    expect(all.providers.find((p) => p.id === "outro")!.path).toBeNull();
    expect(listProviders(join(dir, "nao-existe"), { PATH: "" }).providers).toHaveLength(BUILTIN_PROVIDERS.length); // pasta ausente: só embutidos
  });
});

describe("contas (#57) — só status/identidade, nunca tokens", () => {
  it("home vazio: tudo 'none' (ou 'unknown' para antigravity só se houver pasta)", () => {
    const home = join(dir, "home-vazio"); mkdirSync(home, { recursive: true });
    const r = probeAccounts(home, {});
    expect(r.map((a) => [a.id, a.status])).toEqual([["claude", "none"], ["codex", "none"], ["opencode", "none"], ["antigravity", "none"]]);
    expect(r.every((a) => a.loginCommand.length > 0)).toBe(true);
  });
  it("arquivos sintéticos: claude OAuth com plano/e-mail, codex via JWT, opencode por provedores; token expirado é dito", () => {
    const home = join(dir, "home-cheio"); mkdirSync(join(home, ".claude"), { recursive: true }); mkdirSync(join(home, ".codex"), { recursive: true }); mkdirSync(join(home, ".local", "share", "opencode"), { recursive: true }); mkdirSync(join(home, ".config", "antigravity"), { recursive: true });
    writeFileSync(join(home, ".claude", ".credentials.json"), JSON.stringify({ claudeAiOauth: { accessToken: "SEGREDO-NAO-PODE-VAZAR", subscriptionType: "max", expiresAt: Date.now() - 1000 } }));
    writeFileSync(join(home, ".claude.json"), JSON.stringify({ oauthAccount: { emailAddress: "a@b.c", organizationName: "Org X" } }));
    const jwt = `${b64url("{\"alg\":\"none\"}")}.${b64url(JSON.stringify({ email: "c@d.e" }))}.sig`;
    writeFileSync(join(home, ".codex", "auth.json"), JSON.stringify({ tokens: { id_token: jwt, access_token: "OUTRO-SEGREDO" } }));
    writeFileSync(join(home, ".local", "share", "opencode", "auth.json"), JSON.stringify({ anthropic: { type: "api", key: "sk-SEGREDO" }, openai: { type: "oauth" } }));
    const r = probeAccounts(home, {});
    const by = Object.fromEntries(r.map((a) => [a.id, a]));
    expect(by["claude"]).toMatchObject({ status: "logged", plan: "max", identity: "a@b.c · Org X" }); expect(by["claude"]!.detail).toContain("expirado");
    expect(by["codex"]).toMatchObject({ status: "logged", identity: "c@d.e" });
    expect(by["opencode"]).toMatchObject({ status: "logged", identity: "anthropic, openai" });
    expect(by["antigravity"]!.status).toBe("unknown");
    expect(JSON.stringify(r)).not.toMatch(/SEGREDO/); // nenhum valor sensível na saída
    expect(jwtPayload("lixo")).toBeNull();
  });
  it("variáveis de ambiente contam como login por chave de API", () => {
    const home = join(dir, "home-env"); mkdirSync(home, { recursive: true });
    const r = probeAccounts(home, { ANTHROPIC_API_KEY: "x", OPENAI_API_KEY: "y" });
    expect(r.find((a) => a.id === "claude")).toMatchObject({ status: "logged", identity: "ANTHROPIC_API_KEY (ambiente)" });
    expect(r.find((a) => a.id === "codex")!.status).toBe("logged");
  });
});
