import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Instala as skills do MessAI (pasta `skills/` do repo/pacote) nas pastas de skills que os CLIs de agente leem,
 * e remove as skills `maestri-*` de OUTRO app que confundem os agentes (eles carregam a skill pelo assunto e seguem
 * o CLI errado). Idempotente e nunca fatal: roda no boot do runtime.
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

export function installAgentSkills(): { installed: number; removedMaestri: number; dirs: number } {
  const src = skillsSourceDir();
  let installed = 0; let removedMaestri = 0; let dirs = 0;
  if (!src) return { installed, removedMaestri, dirs };
  const ours = readdirSync(src, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name.startsWith("messai")).map((e) => e.name);
  if (!ours.length) return { installed, removedMaestri, dirs };
  for (const rel of AGENT_SKILL_DIRS) {
    const target = join(homedir(), rel);
    try {
      if (!existsSync(join(homedir(), rel.split("/")[0]!))) continue; // só mexe em pastas de agentes que o usuário realmente usa
      mkdirSync(target, { recursive: true });
      dirs++;
      // remove skills de outro app (maestri-*) — elas fazem o agente usar o CLI `maestri`, que não existe aqui
      for (const e of readdirSync(target, { withFileTypes: true })) {
        if (e.isDirectory() && e.name.startsWith("maestri")) { try { rmSync(join(target, e.name), { recursive: true, force: true }); removedMaestri++; } catch { /* segue */ } }
      }
      // instala/atualiza as nossas (sobrescreve só as messai*, não toca em outras skills do usuário)
      for (const name of ours) { try { cpSync(join(src, name), join(target, name), { recursive: true, dereference: true }); installed++; } catch { /* segue */ } }
    } catch { /* uma pasta problemática não derruba as outras */ }
  }
  return { installed, removedMaestri, dirs };
}
