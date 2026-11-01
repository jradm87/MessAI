#!/usr/bin/env node
import { existsSync, unlinkSync, chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Store } from "@messai/storage";
import { loadConfig } from "./config.js";
import { SessionManager } from "./sessions.js";
import { WorkspaceService } from "./service.js";
import { buildServer } from "./server.js";

const cfg = loadConfig();
const store = new Store(cfg.dbPath);
const sessions = new SessionManager(store);
const svc = new WorkspaceService(cfg, store, sessions);
const rec = svc.recoverPersistent();
if (rec.reattached || rec.respawned || rec.lost) console.log(`sessões: ${rec.reattached} reanexada(s), ${rec.respawned} re-aberta(s) [reboot], ${rec.lost} perdida(s)`);
svc.ensureDefaultWorkspace(); // primeira vez: cria um espaço padrão (canvas não nasce vazio)
svc.initNoteWatches(); // observa .md das notas: edição externa reflete na hora

const pidPath = join(cfg.dataDir, "runtime.pid");

const shutdown = async (killAgents = false) => {
  // killAgents=false: mantém as sessões tmux (reinício do runtime; o próximo boot reanexa).
  // killAgents=true: "Encerrar tudo" — mata também os agentes dentro do tmux.
  if (killAgents) sessions.disposeAllHard(); else sessions.shutdownAll();
  await Promise.all([http.close(), agent.close()]);
  store.close();
  try { if (existsSync(cfg.socketPath)) unlinkSync(cfg.socketPath); } catch { /* já foi */ }
  try { if (existsSync(pidPath)) unlinkSync(pidPath); } catch { /* já foi */ }
  process.exit(0);
};

const http = buildServer(cfg, svc, { unix: false, onShutdown: (killAgents) => void shutdown(killAgents) });
const agent = buildServer(cfg, svc, { unix: true });

if (existsSync(cfg.socketPath)) unlinkSync(cfg.socketPath);
await http.listen({ host: cfg.host, port: cfg.port });
await agent.listen({ path: cfg.socketPath });
chmodSync(cfg.socketPath, 0o600);
try { writeFileSync(pidPath, String(process.pid), { mode: 0o600 }); } catch { /* sem pid file */ }
console.log(`messai-runtime machine=${cfg.machineId} http=http://${cfg.host}:${cfg.port} socket=${cfg.socketPath} data=${cfg.dataDir} pid=${process.pid}`);

process.on("SIGINT", () => void shutdown(false));
process.on("SIGTERM", () => void shutdown(false));
