#!/usr/bin/env node
import { existsSync, unlinkSync, chmodSync } from "node:fs";
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
if (rec.reattached || rec.lost) console.log(`sessões persistentes: ${rec.reattached} reanexada(s), ${rec.lost} perdida(s)`);
svc.initNoteWatches(); // observa .md das notas: edição externa reflete na hora

const http = buildServer(cfg, svc, { unix: false });
const agent = buildServer(cfg, svc, { unix: true });

if (existsSync(cfg.socketPath)) unlinkSync(cfg.socketPath);
await http.listen({ host: cfg.host, port: cfg.port });
await agent.listen({ path: cfg.socketPath });
chmodSync(cfg.socketPath, 0o600);
console.log(`messai-runtime machine=${cfg.machineId} http=http://${cfg.host}:${cfg.port} socket=${cfg.socketPath} data=${cfg.dataDir}`);

const shutdown = async () => {
  // Encerrar o runtime encerra os PTYs deste processo: isso é esperado e diferente de fechar o cliente.
  sessions.shutdownAll();
  await Promise.all([http.close(), agent.close()]);
  store.close();
  if (existsSync(cfg.socketPath)) unlinkSync(cfg.socketPath);
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
