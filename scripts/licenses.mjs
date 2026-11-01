#!/usr/bin/env node
// #60 — Avisos de terceiros gerados a partir dos package.json (dependências de PRODUÇÃO, transitivas) do monorepo.
// Saída: apps/desktop/src/renderer/src/generated/third-party.json (lido pela aba Código aberto) e THIRD-PARTY-NOTICES.md.
// Uso: node scripts/licenses.mjs [--check]   (--check: só falha se o JSON commitado estiver desatualizado)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORKSPACES = ["apps/desktop", "apps/runtime", "apps/cli", "packages/contracts", "packages/domain", "packages/storage"];
/** Fora do npm mas distribuído/exigido: dito explicitamente para a lista não mentir por omissão. */
export const SYSTEM_DEPS = [
  { name: "electron", version: "", license: "MIT", repository: "https://github.com/electron/electron", note: "shell do app (devDependency, mas vai no pacote)" },
  { name: "Chromium", version: "", license: "BSD-3-Clause", repository: "https://www.chromium.org/", note: "embutido no Electron" },
  { name: "Node.js", version: "", license: "MIT", repository: "https://nodejs.org/", note: "embutido no Electron; runtime usa o do sistema em dev" },
  { name: "tmux", version: "", license: "ISC", repository: "https://github.com/tmux/tmux", note: "dependência de sistema (terminais persistentes)" },
  { name: "SQLite", version: "", license: "Public Domain", repository: "https://sqlite.org/", note: "embutido no better-sqlite3" },
];

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
function findPkg(name, from) {
  // npm workspaces: quase tudo hoisted na raiz; senão, node_modules do próprio workspace.
  for (const base of [join(from, "node_modules", name), join(ROOT, "node_modules", name)]) { const p = join(base, "package.json"); if (existsSync(p)) return p; }
  return null;
}
const licenseOf = (pkg) => {
  if (typeof pkg.license === "string") return pkg.license;
  if (pkg.license && typeof pkg.license === "object" && typeof pkg.license.type === "string") return pkg.license.type;
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => (typeof l === "string" ? l : l?.type)).filter(Boolean).join(" OR ");
  return "desconhecida";
};
const repoOf = (pkg) => {
  const r = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url ?? "";
  return r.replace(/^git\+/, "").replace(/^git:\/\//, "https://").replace(/^ssh:\/\/git@/, "https://").replace(/\.git$/, "").replace(/^github:/, "https://github.com/") || (pkg.homepage ?? "");
};

/** Coleta {name, version, license, repository, via[]} para toda dependência de produção alcançável. */
export function collect() {
  const out = new Map(); const seen = new Set(); const missing = [];
  const visit = (name, from, via) => {
    if (name.startsWith("@messai/")) return;
    const pj = findPkg(name, from); if (!pj) { missing.push(`${name} (via ${via})`); return; }
    const pkg = readJson(pj); const key = `${pkg.name}@${pkg.version}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.set(key, { name: pkg.name, version: pkg.version, license: licenseOf(pkg), repository: repoOf(pkg), via: [via] });
      for (const dep of Object.keys(pkg.dependencies ?? {})) visit(dep, dirname(pj), pkg.name);
      for (const dep of Object.keys(pkg.optionalDependencies ?? {})) if (findPkg(dep, dirname(pj))) visit(dep, dirname(pj), pkg.name);
    } else { const e = out.get(key); if (!e.via.includes(via)) e.via.push(via); }
  };
  for (const w of WORKSPACES) {
    const pj = join(ROOT, w, "package.json"); if (!existsSync(pj)) continue;
    const pkg = readJson(pj);
    for (const dep of Object.keys(pkg.dependencies ?? {})) visit(dep, join(ROOT, w), pkg.name);
  }
  const list = [...out.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  return { generatedFrom: WORKSPACES, packages: list, system: SYSTEM_DEPS, missing };
}

export function renderNotices(data) {
  const L = ["# Avisos de terceiros — MessAI", "", "MessAI é distribuído sob a licença Apache-2.0 (ver LICENSE). Este arquivo lista as dependências de produção e suas licenças.", "Gerado por `node scripts/licenses.mjs` — não edite à mão.", "", "## Pacotes npm (produção, transitivos)", "", "| pacote | versão | licença | repositório |", "|---|---|---|---|"];
  for (const p of data.packages) L.push(`| ${p.name} | ${p.version} | ${p.license} | ${p.repository} |`);
  L.push("", "## Componentes fora do npm", "", "| componente | licença | observação |", "|---|---|---|");
  for (const s of data.system) L.push(`| ${s.name} | ${s.license} | ${s.note} |`);
  if (data.missing.length) L.push("", "## Não resolvidos (instale as dependências e gere de novo)", "", ...data.missing.map((m) => `- ${m}`));
  return L.join("\n") + "\n";
}

export const JSON_OUT = join(ROOT, "apps/desktop/src/renderer/src/generated/third-party.json");
export const MD_OUT = join(ROOT, "THIRD-PARTY-NOTICES.md");
export const TS_OUT = join(ROOT, "apps/desktop/src/renderer/src/generated/third-party.ts"); // a aba importa daqui (sem resolveJsonModule)
/** Só o que importa para comparar (sem o campo `via`, que muda com a ordem de visita). */
export const stable = (data) => JSON.stringify({ packages: data.packages.map(({ name, version, license, repository }) => ({ name, version, license, repository })), system: data.system });

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const data = collect();
  const json = JSON.stringify({ generatedAt: new Date().toISOString().slice(0, 10), ...data }, null, 1) + "\n";
  if (process.argv.includes("--check")) {
    const cur = existsSync(JSON_OUT) ? readJson(JSON_OUT) : null;
    if (!cur || stable(cur) !== stable(data)) { console.error("third-party.json desatualizado: rode `node scripts/licenses.mjs`"); process.exit(1); }
    console.log(`third-party.json em dia (${data.packages.length} pacotes)`); process.exit(0);
  }
  mkdirSync(dirname(JSON_OUT), { recursive: true });
  writeFileSync(JSON_OUT, json); writeFileSync(MD_OUT, renderNotices(data));
  writeFileSync(TS_OUT, `// Gerado por scripts/licenses.mjs — não edite à mão (rode \`npm run licenses\`).\nexport type ThirdPartyPackage = { name: string; version: string; license: string; repository: string; via: string[] };\nexport type SystemDep = { name: string; version: string; license: string; repository: string; note: string };\nexport type ThirdParty = { generatedAt: string; generatedFrom: string[]; packages: ThirdPartyPackage[]; system: SystemDep[]; missing: string[] };\nexport const THIRD_PARTY: ThirdParty = ${JSON.stringify({ generatedAt: new Date().toISOString().slice(0, 10), ...data })};\n`);
  console.log(`${data.packages.length} pacotes → ${JSON_OUT}\n${MD_OUT}${data.missing.length ? `\nNÃO RESOLVIDOS: ${data.missing.join(", ")}` : ""}`);
}
