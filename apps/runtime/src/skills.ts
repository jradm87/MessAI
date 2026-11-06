import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Instala as skills do MessAI (pasta `skills/` do repo/pacote) nas pastas de skills que os CLIs de agente leem,
 * pra o Claude/Codex saberem usar o `mess` quando o usuário pedir. Só ADICIONA as nossas (messai*) — não remove
 * nem toca em nenhuma outra skill do usuário. Idempotente e nunca fatal: roda no boot do runtime.
 */
const AGENT_SKILL_DIRS = [
  ".claude/skills", // Claude Code
  ".codex/skills", // Codex
  ".agents/skills", // Agent Skills (genérico)
  ".gemini/config/skills", // Antigravity
  ".hermes/skills", // Hermes
];

/** Onde moram as skills embarcadas: `MESS_RESOURCES/skills` (empacotado) ou `<repo>/skills` (dev). */
function skillsSourceDir(): string | null {
  const packaged = process.env["MESS_RESOURCES"] ? join(process.env["MESS_RESOURCES"], "skills") : null;
  if (packaged && existsSync(packaged)) return packaged;
  const dev = join(dirname(fileURLToPath(import.meta.url)), "../../../skills"); // apps/runtime/dist → <repo>/skills
  return existsSync(dev) ? dev : null;
}

export function installAgentSkills(): { installed: number; dirs: number } {
  const src = skillsSourceDir();
  let installed = 0; let dirs = 0;
  if (!src) return { installed, dirs };
  const ours = readdirSync(src, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name.startsWith("messai")).map((e) => e.name);
  if (!ours.length) return { installed, dirs };
  for (const rel of AGENT_SKILL_DIRS) {
    const target = join(homedir(), rel);
    try {
      if (!existsSync(join(homedir(), rel.split("/")[0]!))) continue; // só mexe em pastas de agentes que o usuário realmente usa
      mkdirSync(target, { recursive: true });
      dirs++;
      // instala/atualiza só as nossas (messai*); não remove nem sobrescreve outras skills do usuário
      for (const name of ours) { try { cpSync(join(src, name), join(target, name), { recursive: true, dereference: true }); installed++; } catch { /* segue */ } }
    } catch { /* uma pasta problemática não derruba as outras */ }
  }
  return { installed, dirs };
}
