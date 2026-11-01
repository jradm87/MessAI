# PROGRESS — Execução autônoma do roadmap MessAI

**Objetivo:** concluir as fases 0–8 do plano, implementando/testando/fechando todas as issues do escopo inicial.
**Branch de trabalho:** `auto/roadmap` (commits assinados; merge no `main` fica a critério do usuário).
**Plano de referência:** `~/.claude/plans/robust-moseying-biscuit.md`.
**Regra de ouro:** nada entra sem `npm run build` + `npx vitest run packages apps tests/integration` verdes, com teste novo por feature.

## Limites registrados (honestidade — rule 12/14)
- **Validação visual (GUI):** rodo checagens automáticas; o que depende de olhar a tela fica marcado **"pendente de conferência humana"** — não afirmo que validei.
- **Releases:** não publico sem autorização explícita.
- **Assinatura:** resolvida — chave GPG do usuário importada localmente; assino os commits direto.

## Escopo inicial (44 issues) por fase

### Fase 0 — Robustez leve
- [ ] #90 git/grep assíncronos + cache de git status
- [ ] #40 alinhar documentação (koba→messai)

### Fase 1 — Alto impacto / reuso
- [ ] #54 Tema claro/escuro/sistema
- [ ] #68 Companheiro (epic) · #65 detectar fim · #66 resumo via Ollama · #67 HUD flutuante

### Fase 2 — Preferências (#64 epic)
- [ ] #64 shell · #55 Geral · #56 Terminal · #57 Agentes (+#38 Usage) · #58 Atalhos · #61 Atualizações · #62 Dados · #63 Sobre · #60 Código aberto (UI) · #59 stub remoto

### Fase 3 — Canvas / UX
- [ ] #41 FTS5 · #77 Undo/redo · #78 Grupos+snap · #69 Busca global · #42 Fluidez · #47 Presença · #71 Partituras · #74 Fichários

### Fase 4 — Agentes / colaboração
- [ ] #70 Bandas · #29 Modo Maestro · #76 CLAUDE/AGENTS.md · #79 Chat anexos · #80 Monitor de processos

### Fase 5 — Andares
- [ ] #75 Hooks de andar · #81 Cópia isolada · #82 Conexões cross-floor · #31 PR nos andares

### Fase 6 — Runtime / infra
- [ ] #72 Ambientes · #83 Export/import espaço · #84 Unload/reload · #85 Notificações SO · #27 Rotinas · #51 i18n

### Fase 7 — Fronteira de confiança (antes do hub)
- [ ] #86 (MESS-01) symlink · #87 (MESS-02) authz por agente

### Fase 8 — Gigantes
- [ ] #26 Portais · #73 Portais de dispositivo · #30 Editor+git · #28 Hub (dep #87) · #93 (MESS-09) modo isolado

## Estado atual
- **Fase atual:** 0
- **Concluídas:** (nenhuma ainda nesta execução)
- **Em andamento:** #90
- **Bloqueadas:** (nenhuma)
- **Commits:** (serão listados aqui)
- **Testes:** baseline 78 verdes (pré-execução)

## Log de execução
- Setup: branch `auto/roadmap`, assinatura GPG local configurada, baseline de testes 78 verdes.
