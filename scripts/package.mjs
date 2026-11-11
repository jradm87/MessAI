#!/usr/bin/env node
// Empacota o MessAI (Linux: AppImage/.deb; Windows: instalador NSIS). Passos: build → bundlar runtime (esbuild) →
// copiar+recompilar addons nativos p/ a ABI do Electron → electron-builder.
// Plataforma: a da máquina; `--win`/`--linux` forçam. Alvos extras como argumentos soltos (ex.: `portable`).
import { execSync } from "node:child_process";
import { mkdirSync, rmSync, cpSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const argv = process.argv.slice(2);
const WIN = argv.includes("--win") || (process.platform === "win32" && !argv.includes("--linux"));
const bin = (name) => join(root, "node_modules", ".bin", process.platform === "win32" ? `${name}.cmd` : name);
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
// Windows: PowerShell/cmd não rodam o launcher sh (Git Bash continua usando o `mess` acima). CRLF: cmd.exe exige.
writeFileSync(join(res, "cli", "mess.cmd"), [
  "@echo off",
  "rem Launcher do `mess` empacotado: roda o cli.mjs com o Electron do MessAI (sem Node do sistema).",
  "setlocal",
  "set \"ELECTRON_RUN_AS_NODE=1\"",
  "if defined MESS_ELECTRON (\"%MESS_ELECTRON%\" \"%~dp0cli.mjs\" %*) else (node \"%~dp0cli.mjs\" %*)",
  "exit /b %ERRORLEVEL%",
  "",
].join("\r\n"));

// 3) addons nativos → resources, recompilados para o Electron (ELECTRON_RUN_AS_NODE usa a ABI do Electron)
for (const m of NATIVE) {
  const src = join(root, "node_modules", m);
  if (!existsSync(src)) throw new Error(`addon não encontrado: ${src}`);
  cpSync(src, join(res, "node_modules", m), { recursive: true, dereference: true });
}
// Windows: o node-pty 1.1.0 traz prebuild N-API (prebuilds/win32-x64), que serve a qualquer ABI; recompilar do fonte
// falha (o pacote npm não traz o GetCommitHash.bat do winpty). Só o better-sqlite3 precisa da ABI do Electron.
const REBUILD = WIN ? NATIVE.filter((m) => m !== "node-pty") : NATIVE;
// electron-rebuild espera um package.json no dir que declare os addons (só os declarados são recompilados)
writeFileSync(join(res, "package.json"), JSON.stringify({ name: "messai-runtime-bundle", version: "0.0.1", private: true, dependencies: Object.fromEntries(REBUILD.map((m) => [m, "*"])) }, null, 2) + "\n");
run(`"${bin("electron-rebuild")}" -v ${ELECTRON} -m "${res}" -w ${REBUILD.join(",")} -f`);

// 3.5) skills do MessAI → resources/skills (o runtime instala nas pastas dos agentes no boot)
if (existsSync(join(root, "skills"))) { rmSync(join(res, "skills"), { recursive: true, force: true }); cpSync(join(root, "skills"), join(res, "skills"), { recursive: true }); }

// 4) electron-builder (lê a config em apps/desktop/package.json "build")
const publish = argv.includes("--publish"); // sobe pro GitHub release + gera latest(-linux).yml (auto-update)
const targets = argv.filter((a) => !a.startsWith("--")).join(" ") || (WIN ? "nsis" : "AppImage deb");
run(`"${bin("electron-builder")}" ${WIN ? "--win" : "--linux"} ${targets} ${publish ? "--publish always" : "--publish never"} --projectDir apps/desktop`);

console.log("\n\x1b[32mPronto. Artefatos em apps/desktop/release/\x1b[0m");
