/** #63 — relatório de diagnóstico para "Reportar problema": só o que o usuário marcou; sem tokens/identidades. */
export type AppInfo = { name: string; version: string; buildVersion: number; electron: string; node: string; chrome: string; platform: string; arch: string; dataDir: string; packaged: boolean };
export type ReportParts = {
  app: AppInfo;
  runtime?: { ok: boolean; buildVersion?: number; protocolVersion?: number } | null; // health
  providers?: { id: string; path: string | null }[];
  counts?: { workspaces: number; nodes: number; terminals: number };
  logTail?: string; // últimas linhas do runtime.log (opcional)
  description?: string; // o que o usuário escreveu
};
export type ReportOptions = { runtime: boolean; providers: boolean; counts: boolean; log: boolean };

/** Remove o que pareça segredo de uma linha de log (tokens Bearer, chaves sk-…, hex longos). */
export function redactLine(line: string): string {
  return line
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/g, "Bearer [redigido]")
    .replace(/\bsk-[A-Za-z0-9_\-]{8,}/g, "sk-[redigido]")
    .replace(/\b[a-f0-9]{32,}\b/gi, "[hex-redigido]")
    .replace(/token=[^&\s]+/gi, "token=[redigido]");
}
export function buildReport(p: ReportParts, opt: ReportOptions): string {
  const L: string[] = [];
  L.push(`# ${p.app.name} — relatório de problema`, "");
  if (p.description?.trim()) L.push("## O que aconteceu", "", p.description.trim(), "");
  L.push("## Versões", "", `- app: ${p.app.version} (build ${p.app.buildVersion}${p.app.packaged ? ", empacotado" : ", desenvolvimento"})`, `- electron: ${p.app.electron} · chrome: ${p.app.chrome} · node: ${p.app.node}`, `- plataforma: ${p.app.platform}/${p.app.arch}`, "");
  if (opt.runtime) L.push("## Runtime", "", p.runtime ? `- ok: ${p.runtime.ok} · build ${p.runtime.buildVersion ?? "?"} · protocolo ${p.runtime.protocolVersion ?? "?"}` : "- runtime indisponível", "");
  if (opt.providers && p.providers) L.push("## Provedores", "", ...p.providers.map((x) => `- ${x.id}: ${x.path ? "encontrado" : "não encontrado"}`), "");
  if (opt.counts && p.counts) L.push("## Tamanho do workspace", "", `- espaços: ${p.counts.workspaces} · nós: ${p.counts.nodes} · terminais: ${p.counts.terminals}`, "");
  if (opt.log) L.push("## runtime.log (final, redigido)", "", ...(p.logTail?.trim() ? ["```", ...p.logTail.split("\n").map(redactLine), "```"] : ["(runtime.log vazio ou ausente — o runtime pode ter sido iniciado fora do app)"]), "");
  return L.join("\n");
}
