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
if (rec.reattached || rec.respawned || rec.lost || rec.skipped) console.log(`sessões: ${rec.reattached} reanexada(s), ${rec.respawned} re-aberta(s) [reboot], ${rec.lost} perdida(s), ${rec.skipped} não restaurada(s) [restoreSessions=false]`);
svc.ensureDefaultWorkspace(); // primeira vez: cria um espaço padrão (canvas não nasce vazio)
svc.initNoteWatches(); // observa .md das notas: edição externa reflete na hora

const pidPath = join(cfg.dataDir, "runtime.pid");

const shutdown = async (killAgents = false) => {
  // killAgents=false: mantém as sessões tmux (reinício do runtime; o próximo boot reanexa).
  // killAgents=true: "Encerrar tudo" — mata também os agentes dentro do tmux.
  // Teto de segurança: `close()` do Fastify espera conexões abertas (WebSocket do app) terminarem e pode
  // nunca voltar — o runtime viraria um zumbi segurando a porta. Encerra os WS e, no pior caso, sai à força.
  setTimeout(() => process.exit(0), 2000).unref();
  // pid file e socket somem JÁ: o processo vai embora de qualquer jeito (gracioso ou pelo teto acima), e um
  // pid file sobrevivente faria o version-check do app mandar SIGTERM num pid reciclado depois.
  try { if (existsSync(pidPath)) unlinkSync(pidPath); } catch { /* já foi */ }
  try { if (existsSync(cfg.socketPath)) unlinkSync(cfg.socketPath); } catch { /* já foi */ }
  if (killAgents) sessions.disposeAllHard(); else sessions.shutdownAll();
  for (const s of [http, agent]) { try { for (const c of s.websocketServer?.clients ?? []) c.terminate(); } catch { /* sem WS neste servidor */ } }
  await Promise.all([http.close(), agent.close()]);
  store.close();
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
