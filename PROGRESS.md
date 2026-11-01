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

### Fase 1 — Alto impacto / reuso ✅
- [x] #54 Tema claro/escuro/sistema — `a498555` (visual pendente de conferência humana)
- [x] #68 Companheiro (epic) · [x] #65 detectar fim — `6d7fb11` · [x] #66 resumo via Ollama — `8393b0a` · [x] #67 HUD flutuante — `f396041` + fechamento de escopo (Aplicar próximo passo, posição lembrada, Ollama falso no e2e); e2e Electron real 3/3; aparência/posição em multi-monitor pendentes de conferência humana

### Fase 2 — Preferências (#64 epic)
- [x] #64 shell (janela em abas, engrenagem + Ctrl+,, `prefs.ts`, aba Geral com tema; epic fica aberto até as abas) · [x] #55 Geral — `c152e06` (idioma espera #51; Canvas/Notificações/Environments/Git têm issues próprias) · [x] #56 Terminal — `53bf1bf` (runtime) + `5a79039` (desktop) · [x] #57 Agentes (+#38 Usage) — `f031e87` + `a074656` · #58 Atalhos · #61 Atualizações · #62 Dados · #63 Sobre · #60 Código aberto (UI) · #59 stub remoto

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
- **Fase atual:** 2 (Preferências, epic #64)
- **Concluídas:** #90, #40 (Fase 0) · #54 · #65 · #66 · #67 · #68 (Fase 1)
- **Em andamento:** #58 (Preferências → Atalhos)
- **Bloqueadas:** (nenhuma)
- **Dívida achada:** `tests/e2e/pilot.test.ts` (fora do CI) está desatualizado — assume que o 1º espaço é o criado pela UI (hoje existe o espaço padrão) e usa `app.close()` (pendura na tela de encerramento). A corrigir como tarefa própria.
- **Commits (assinados, branch `auto/roadmap`):** `e781477` setup · `df6f553` #90 · `01f125c` progress · `a498555` #54 · `09b424f` progress · `6d7fb11` #65 · `bde3e91` progress · `8393b0a` #66 · `24b28ea` progress · `f396041` #67 · `037e003` #67 escopo · `f719476` #64 shell · `c152e06` #55 · `9bfac0d` progress · `53bf1bf` #56 runtime · `5a79039` #56 desktop · `d8391fa` progress · `f031e87` #57 runtime · `a074656` #57 desktop
- **Testes:** 126 verdes na suíte determinística (`packages apps tests/integration`) + e2e Electron real fora do CI: `hud.test.ts` 3/3, `prefs.test.ts` 4/4, `terminal-prefs.test.ts` 3/3, `agents-prefs.test.ts` 3/3
- **Próximas:** #64 → #55 → #56 → #57 (+#38) → #58 → #61 → #62 → #63 → #60 (aba UI); #59 stub
- **Nota:** shutdown do runtime endurecido (zumbi segurando porta) — achado pelo teste do #65.
- **Nota:** achado pelo e2e do #56: modal ficava atrás da barra inferior (z-index) — corrigido em `5a79039`. CI verde em `c152e06`, `9bfac0d`, `53bf1bf`.
- **Nota:** CI passou a rodar em `auto/**` a partir de `c152e06` (antes só `main`); BUILD_VERSION=17 — o app troca o runtime 16 sozinho ao abrir.

## Log de execução
- Setup: branch `auto/roadmap`, assinatura GPG local configurada (Good signature verificada), baseline 78 verdes.
- Fase 0: #90 git/grep async + cache (`df6f553`, 79 testes); #40 docs alinhados (REA: NOSSO.md 16 refs, §6 real + ADR-0011). Ambas fechadas no GitHub com relato.
- Fase 1: #54 tema (`a498555`); companheiro #65 (`6d7fb11`, achou e corrigiu zumbi de shutdown), #66 Ollama (`8393b0a`, degradação testada + modelo real), #67 HUD (`f396041`, e2e Electron real). Pegadinha registrada: `app.close()` do Playwright pendura por causa da tela de encerramento — o e2e sai por `app.exit(0)` no processo principal.
