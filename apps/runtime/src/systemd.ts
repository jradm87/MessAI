import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const UNIT_NAME = "messai-runtime.service";
export const unitPath = (home = homedir()): string => join(home, ".config", "systemd", "user", UNIT_NAME);

/** Conteúdo da unidade `systemd --user` que mantém o runtime vivo independente da janela. */
export function renderUnit(opts: { nodeBin: string; entry: string; dataDir?: string | undefined; port?: number | undefined }): string {
  const env = [opts.dataDir ? `Environment=MESS_DATA_DIR=${opts.dataDir}` : "", opts.port ? `Environment=MESS_PORT=${opts.port}` : ""].filter(Boolean).join("\n");
  return `[Unit]
Description=MessAI runtime (PTYs, notas, agentes)
After=default.target

[Service]
Type=simple
ExecStart=${opts.nodeBin} ${opts.entry}
Restart=on-failure
RestartSec=2
${env}
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
`.replace(/\n\n\n/g, "\n\n");
}

const systemctl = (...args: string[]): string => execFileSync("systemctl", ["--user", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

export function installUnit(opts: Parameters<typeof renderUnit>[0]): string {
  const path = unitPath();
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, renderUnit(opts));
  systemctl("daemon-reload");
  systemctl("enable", "--now", UNIT_NAME);
  return path;
}
export function uninstallUnit(): void {
  try { systemctl("disable", "--now", UNIT_NAME); } catch { /* não estava ativa */ }
  const path = unitPath(); if (existsSync(path)) unlinkSync(path);
  try { systemctl("daemon-reload"); } catch { /* sem systemd de usuário */ }
}
export function unitStatus(): { installed: boolean; active: string } {
  const installed = existsSync(unitPath());
  let active = "unknown"; try { active = systemctl("is-active", UNIT_NAME); } catch (e) { active = String((e as { stdout?: string }).stdout ?? "inactive").trim() || "inactive"; }
  return { installed, active };
}
