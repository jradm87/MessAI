#!/usr/bin/env node
// messai-runtime-service install|uninstall|status — unidade systemd --user do runtime.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { installUnit, uninstallUnit, unitStatus, unitPath } from "./systemd.js";

const [cmd] = process.argv.slice(2);
const entry = join(dirname(fileURLToPath(import.meta.url)), "index.js");
try {
  if (cmd === "install") {
    const path = installUnit({ nodeBin: process.execPath, entry, dataDir: process.env["MESS_DATA_DIR"], port: process.env["MESS_PORT"] ? Number(process.env["MESS_PORT"]) : undefined });
    console.log(`unidade instalada e ativa: ${path}\nlogs: journalctl --user -u messai-runtime -f`);
  } else if (cmd === "uninstall") { uninstallUnit(); console.log("unidade removida"); }
  else if (cmd === "status") { const s = unitStatus(); console.log(`${s.installed ? "instalada" : "não instalada"} em ${unitPath()} · ${s.active}`); }
  else { console.log("uso: messai-runtime-service install | uninstall | status"); process.exit(2); }
} catch (e) { console.error(String((e as Error).message ?? e)); process.exit(1); }
