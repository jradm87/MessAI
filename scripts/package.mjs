#!/usr/bin/env node
// Empacota o MessAI (AppImage/.deb). Passos: build → bundlar runtime (esbuild) →
// copiar+recompilar addons nativos p/ a ABI do Electron → electron-builder.
import { execSync } from "node:child_process";
import { mkdirSync, rmSync, cpSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const bin = (name) => join(root, "node_modules", ".bin", name);
const run = (cmd, cwd = root) => { console.log(`\n\x1b[36m+ ${cmd}\x1b[0m`); execSync(cmd, { cwd, stdio: "inherit" }); };

const ELECTRON = "45.1.0";
const res = join(root, "apps/desktop/resources");
const NATIVE = ["node-pty", "better-sqlite3"];

// 1) build (pacotes + runtime + desktop)
run("npm run build");
run("npm run build -w @messai/desktop");

// 2) runtime num bundle único (externos = addons nativos)
rmSync(res, { recursive: true, force: true });
mkdirSync(join(res, "node_modules"), { recursive: true });
const ext = NATIVE.map((m) => `--external:${m}`).join(" ");
const banner = "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);";
run(`"${bin("esbuild")}" apps/runtime/dist/index.js --bundle --platform=node --format=esm ${ext} --banner:js="${banner}" --outfile="${res}/runtime.mjs"`);

// 2b) CLI `mess` no pacote: bundle + launcher que roda com o Node do Electron (sem Node do sistema)
mkdirSync(join(res, "cli"), { recursive: true });
run(`"${bin("esbuild")}" apps/cli/dist/index.js --bundle --platform=node --format=esm --banner:js="${banner}" --outfile="${res}/cli/cli.mjs"`);
writeFileSync(join(res, "cli", "mess"), '#!/bin/sh\nexec env ELECTRON_RUN_AS_NODE=1 "${MESS_ELECTRON:-node}" "$(dirname "$0")/cli.mjs" "$@"\n', { mode: 0o755 });

// 3) addons nativos → resources, recompilados para o Electron (ELECTRON_RUN_AS_NODE usa a ABI do Electron)
for (const m of NATIVE) {
  const src = join(root, "node_modules", m);
  if (!existsSync(src)) throw new Error(`addon não encontrado: ${src}`);
  cpSync(src, join(res, "node_modules", m), { recursive: true, dereference: true });
}
// electron-rebuild espera um package.json no dir que declare os addons
writeFileSync(join(res, "package.json"), JSON.stringify({ name: "messai-runtime-bundle", version: "0.0.1", private: true, dependencies: Object.fromEntries(NATIVE.map((m) => [m, "*"])) }, null, 2) + "\n");
run(`"${bin("electron-rebuild")}" -v ${ELECTRON} -m "${res}" -w ${NATIVE.join(",")} -f`);

// 4) electron-builder (lê a config em apps/desktop/package.json "build")
const args = process.argv.slice(2);
const publish = args.includes("--publish"); // sobe pro GitHub release + gera latest-linux.yml (auto-update)
const targets = args.filter((a) => !a.startsWith("--")).join(" ") || "AppImage deb";
run(`"${bin("electron-builder")}" --linux ${targets} ${publish ? "--publish always" : ""} --projectDir apps/desktop`);

console.log("\n\x1b[32mPronto. Artefatos em apps/desktop/release/\x1b[0m");
