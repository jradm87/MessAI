import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * #57 — Contas: estado de login das CLIs de IA, lido dos arquivos que elas mesmas mantêm.
 * SÓ deriva status/identidade/plano; nenhum token sai daqui (nem para o log, nem para a API).
 */
export type AccountStatus = {
  id: string; label: string;
  status: "logged" | "none" | "unknown";
  identity?: string; plan?: string; detail?: string;
  loginCommand: string; // o que abrir num terminal para entrar/trocar de conta
};

const readJson = (p: string): Record<string, unknown> | null => { try { return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>) : null; } catch { return null; } };
/** Payload de um JWT sem validar assinatura — só para ler o e-mail que a própria CLI gravou. */
export function jwtPayload(token: string): Record<string, unknown> | null {
  const part = token.split(".")[1]; if (!part) return null;
  try { return JSON.parse(Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as Record<string, unknown>; } catch { return null; }
}

export function probeAccounts(home: string, env: NodeJS.ProcessEnv = process.env, now = Date.now()): AccountStatus[] {
  const out: AccountStatus[] = [];
  // Claude Code: ~/.claude/.credentials.json (OAuth) + ~/.claude.json (conta)
  {
    const cred = readJson(join(home, ".claude", ".credentials.json"));
    const oauth = (cred?.["claudeAiOauth"] ?? null) as { accessToken?: unknown; subscriptionType?: unknown; expiresAt?: unknown } | null;
    const acct = (readJson(join(home, ".claude.json"))?.["oauthAccount"] ?? null) as { emailAddress?: unknown; organizationName?: unknown } | null;
    const a: AccountStatus = { id: "claude", label: "Claude Code", status: "none", loginCommand: "claude", detail: "Abra o Claude Code e use /login." };
    if (oauth && typeof oauth.accessToken === "string" && oauth.accessToken) {
      a.status = "logged";
      if (typeof oauth.subscriptionType === "string") a.plan = oauth.subscriptionType;
      const email = typeof acct?.emailAddress === "string" ? acct.emailAddress : ""; const org = typeof acct?.organizationName === "string" ? acct.organizationName : "";
      if (email || org) a.identity = [email, org].filter(Boolean).join(" · ");
      a.detail = typeof oauth.expiresAt === "number" && oauth.expiresAt < now ? "Token expirado — a CLI renova ao abrir." : "Conectado via OAuth.";
    } else if (env["ANTHROPIC_API_KEY"]) { a.status = "logged"; a.identity = "ANTHROPIC_API_KEY (ambiente)"; a.detail = "Chave de API no ambiente."; }
    out.push(a);
  }
  // Codex: ~/.codex/auth.json (OPENAI_API_KEY ou tokens ChatGPT)
  {
    const j = readJson(join(home, ".codex", "auth.json"));
    const a: AccountStatus = { id: "codex", label: "Codex", status: "none", loginCommand: "codex login" };
    const tokens = (j?.["tokens"] ?? null) as { id_token?: unknown } | null;
    if (tokens && typeof tokens.id_token === "string") {
      a.status = "logged"; const p = jwtPayload(tokens.id_token); const email = p && typeof p["email"] === "string" ? p["email"] : "";
      if (email) a.identity = email; a.detail = "Conectado com conta ChatGPT.";
    } else if (typeof j?.["OPENAI_API_KEY"] === "string" && j["OPENAI_API_KEY"]) { a.status = "logged"; a.identity = "chave de API"; a.detail = "Conectado com OPENAI_API_KEY no auth.json."; }
    else if (env["OPENAI_API_KEY"]) { a.status = "logged"; a.identity = "OPENAI_API_KEY (ambiente)"; }
    out.push(a);
  }
  // OpenCode: $XDG_DATA_HOME/opencode/auth.json → { provedor: { type, ... } }
  {
    const base = env["XDG_DATA_HOME"] || join(home, ".local", "share");
    const j = readJson(join(base, "opencode", "auth.json"));
    const a: AccountStatus = { id: "opencode", label: "OpenCode", status: "none", loginCommand: "opencode auth login" };
    const provs = j ? Object.keys(j) : [];
    if (provs.length) { a.status = "logged"; a.identity = provs.join(", "); a.detail = `${provs.length} provedor(es) configurado(s).`; }
    out.push(a);
  }
  // Antigravity (agy): a CLI não documenta onde guarda o login; só dizemos se há pasta de configuração.
  {
    const dirs = [join(home, ".antigravity"), join(home, ".config", "antigravity")].filter((d) => existsSync(d));
    out.push({ id: "antigravity", label: "Antigravity", status: dirs.length ? "unknown" : "none", loginCommand: "agy", detail: dirs.length ? `Configuração em ${dirs[0]}; o estado do login não é exposto pela CLI.` : "Faça login pela própria CLI (agy)." });
  }
  return out;
}
