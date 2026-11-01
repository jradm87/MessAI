import { randomBytes, randomUUID } from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, hostname, platform, userInfo } from "node:os";
import { join } from "node:path";
import { resolveDataDir } from "./data.js";

export type Config = {
  dataDir: string;
  /** #62 de onde veio a pasta de dados: MESS_DATA_DIR, ponteiro ~/.messai/datadir ou padrão. */
  dataDirSource: "env" | "pointer" | "default";
  dbPath: string;
  tokenPath: string;
  socketPath: string;
  host: string;
  port: number;
  token: string;
  machineId: string;
  machineName: string;
  platform: string;
  defaultShell: string;
  /** Servidor tmux próprio (tmux -L <socket>): isola as sessões do MessAI do tmux pessoal do usuário. */
  tmuxSocket: string;
  /** Companheiro (#66): modelo local via Ollama. MESS_COMPANION=0 desliga; MESS_OLLAMA_URL / MESS_OLLAMA_MODEL configuram. */
  companionEnabled: boolean;
  ollamaUrl: string;
  ollamaModel: string | undefined;
};

/** Shell padrão do PC: override MESS_SHELL, senão o shell de login do usuário (/etc/passwd), senão $SHELL, senão bash. */
function resolveDefaultShell(): string {
  const override = process.env["MESS_SHELL"];
  if (override && override.trim()) return override.trim();
  try { const s = userInfo().shell; if (s && s.trim() && s !== "/sbin/nologin" && s !== "/usr/sbin/nologin") return s; } catch { /* sem passwd */ }
  return process.env["SHELL"] ?? "/bin/bash";
}

export function loadConfig(): Config {
  const { dir: dataDir, source: dataDirSource } = resolveDataDir(); // #62: env > ponteiro > padrão
  // Migração dos nomes antigos: copia ~/.messyai (ou ~/.koba) para ~/.messai na primeira vez (preserva espaços/terminais).
  if (!process.env["MESS_DATA_DIR"] && !existsSync(dataDir)) {
    for (const old of [".messyai", ".koba"]) {
      const legacy = join(homedir(), old);
      if (existsSync(legacy)) { try { cpSync(legacy, dataDir, { recursive: true }); } catch { /* segue com dir novo vazio */ } break; }
    }
  }
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const tokenPath = join(dataDir, "runtime.token");
  if (!existsSync(tokenPath)) {
    writeFileSync(tokenPath, randomBytes(32).toString("hex"), { mode: 0o600 });
    chmodSync(tokenPath, 0o600);
  }
  const idPath = join(dataDir, "machine.id");
  if (!existsSync(idPath)) writeFileSync(idPath, randomUUID().replace(/-/g, ""), { mode: 0o600 });
  return {
    dataDir, dataDirSource,
    dbPath: join(dataDir, "runtime.sqlite"),
    tokenPath,
    socketPath: join(dataDir, "agent.sock"),
    host: "127.0.0.1",
    port: Number(process.env["MESS_PORT"] ?? 47821),
    token: readFileSync(tokenPath, "utf8").trim(),
    machineId: readFileSync(idPath, "utf8").trim(),
    tmuxSocket: process.env["MESS_TMUX_SOCKET"] ?? "mess",
    companionEnabled: (process.env["MESS_COMPANION"] ?? "1") !== "0",
    ollamaUrl: (process.env["MESS_OLLAMA_URL"] ?? "http://127.0.0.1:11434").replace(/\/+$/, ""),
    ollamaModel: process.env["MESS_OLLAMA_MODEL"]?.trim() || undefined,
    machineName: hostname(),
    platform: platform(),
    defaultShell: resolveDefaultShell(),
  };
}

export const newId = (): string => randomUUID().replace(/-/g, "");
export const nowIso = (): string => new Date().toISOString();
