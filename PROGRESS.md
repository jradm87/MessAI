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

### Fase 0 — Robustez leve ✅
- [x] #90 git/grep assíncronos + cache de git status — `df6f553`
- [x] #40 alinhar documentação (koba→messai) — docs em `REA/docs` (NOSSO.md, §6, ADR-0011); repo já limpo

### Fase 1 — Alto impacto / reuso
- [x] #54 Tema claro/escuro/sistema — `a498555` (visual pendente de conferência humana)
- [ ] #68 Companheiro (epic) · [x] #65 detectar fim — `6d7fb11` · [x] #66 resumo via Ollama — `8393b0a` · [ ] #67 HUD flutuante

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
- **Fase atual:** 1 (alto impacto / reuso)
- **Concluídas:** #90, #40 (Fase 0) · #54 · #65 · #66
- **Em andamento:** #67 (companheiro: janela flutuante / HUD)
- **Bloqueadas:** (nenhuma)
- **Commits (assinados, branch `auto/roadmap`):** `e781477` setup · `df6f553` #90 · `01f125c` progress · `a498555` #54 · `09b424f` progress · `6d7fb11` #65 · `bde3e91` progress · `8393b0a` #66
- **Testes:** 93 verdes (85 + 7 unit + 1 Ollama real; +1 degradação dentro do companion)
- **Próximas:** #67 (fecha #68) → Fase 2 (#64 Preferências)
- **Nota:** shutdown do runtime endurecido (zumbi segurando porta) — achado pelo teste do #65.

## Log de execução
- Setup: branch `auto/roadmap`, assinatura GPG local configurada (Good signature verificada), baseline 78 verdes.
- Fase 0: #90 git/grep async + cache (`df6f553`, 79 testes); #40 docs alinhados (REA: NOSSO.md 16 refs, §6 real + ADR-0011). Ambas fechadas no GitHub com relato.
