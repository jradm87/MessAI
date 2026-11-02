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

### Fase 2 — Preferências (#64 epic) ✅ (exceto #59 stub → Fase 8)
- [x] #64 shell (janela em abas, engrenagem + Ctrl+,, `prefs.ts`, aba Geral com tema; epic fica aberto até as abas) · [x] #55 Geral — `c152e06` (idioma espera #51; Canvas/Notificações/Environments/Git têm issues próprias) · [x] #56 Terminal — `53bf1bf` (runtime) + `5a79039` (desktop) · [x] #57 Agentes (+#38 Usage) — `f031e87` + `a074656` · [x] #58 Atalhos — `c0af29a` · [x] #61 Atualizações — `f90d4db` · [x] #62 Dados — `3b439f9` + `6e00459` · [x] #63 Sobre — `f90d4db` · [x] #60 Código aberto (UI) — `65b020a` · #59 stub remoto

### Fase 3 — Canvas / UX ✅
- [x] #41 FTS5 · [x] #77 Undo/redo · [x] #78 Grupos+snap · [x] #69 Busca global — `253ae0c` · [x] #42 Fluidez — `192ff00` · [x] #47 Presença — `2c68c06` · [x] #71 Partituras — `3ac63dd` · [x] #74 Fichários — `5f7b128`

### Fase 4 — Agentes / colaboração ✅
- [x] #70 Bandas — `0f26c7a` · [x] #29 Modo Maestro — `0f26c7a` · [x] #76 CLAUDE/AGENTS.md — `73a886b` · [x] #79 Chat anexos — `a010f09` · [x] #80 Monitor de processos — concluído

### Fase 5 — Andares ✅
- [x] #75 Hooks de andar — `7dd9b05` · [x] #81 Cópia isolada — `1bb5a60` · [x] #82 Conexões cross-floor — `1d5d059` · [x] #31 PR nos andares — `9f70e67`

### Fase 6 — Runtime / infra
- [ ] #72 Ambientes · #83 Export/import espaço · #84 Unload/reload · #85 Notificações SO · #27 Rotinas · #51 i18n

### Fase 7 — Fronteira de confiança (antes do hub)
- [ ] #86 (MESS-01) symlink · #87 (MESS-02) authz por agente

### Fase 8 — Gigantes
- [ ] #26 Portais · #73 Portais de dispositivo · #30 Editor+git · #28 Hub (dep #87) · #93 (MESS-09) modo isolado

## Estado atual
- **Fase atual:** 6 (Runtime / infra)
- **Concluídas:** Fases 0, 1, 2, 3, 4 e 5 completas (#90 #40 · #54 #65–#68 · #55–#58 #60–#64 #38 · #41 #42 #47 #69 #71 #74 #77 #78 · #70 #29 #76 #79 #80 · #75 #81 #82 #31). Fase 2: só #59 (controle remoto) ficou como stub, vai com o hub #28.
- **Em andamento:** (nenhuma — Fase 5 concluída; próxima: Fase 6 #72 → #83 → #84 → #85 → #27 → #51)
- **Bloqueadas:** (nenhuma)
- **Dívida paga:** `tests/e2e/pilot.test.ts` voltou a 18/18 (espaço padrão, tela de encerramento, nós de teste em espaço livre, compositor aberto, pílula do espaço atual).
- **Commits (assinados, branch `auto/roadmap` + `auto/fase5`):** `e781477` setup · `df6f553` #90 · `01f125c` progress · `a498555` #54 · `09b424f` progress · `6d7fb11` #65 · `bde3e91` progress · `8393b0a` #66 · `24b28ea` progress · `f396041` #67 · `037e003` #67 escopo · `f719476` #64 shell · `c152e06` #55 · `9bfac0d` progress · `53bf1bf` #56 runtime · `5a79039` #56 desktop · `d8391fa` progress · `f031e87` #57 runtime · `a074656` #57 desktop · `6f1e147` progress · `a9654c2` e2e piloto · `c0af29a` #58 · `2e96d9d` progress · `f90d4db` #61+#63 · `10148f9` progress · `65b020a` #60 · `5a054c6` progress · `3b439f9` #62 runtime · `6e00459` #62 desktop · `3d5d748` progress · `1794568` #41 · `89283b2` progress · `ae61feb` #77 · `dfec519` progress · `18c3123` #78 runtime · `8d248fc` #78 desktop · `0f26c7a` #70+#29 · `a010f09` #79 · `73a886b` #76 · `6cb4f14` #80 · `7dd9b05` #75 · `1bb5a60` #81 · `1d5d059` #82 · `9f70e67` #31
- **Testes:** 223 verdes na suíte determinística (`packages apps tests/integration`) + e2e Electron real fora do CI: `hud.test.ts` 3/3, `prefs.test.ts` 4/4, `terminal-prefs.test.ts` 3/3, `agents-prefs.test.ts` 3/3, `shortcuts.test.ts` 2/2, `about-updates.test.ts` 3/3, `data-prefs.test.ts` 3/3, `undo.test.ts` 3/3, `groups.test.ts` 2/2, `palette` 3/3, `fluidez` 1/1, `presence` 2/2, `scores` 1/1, `binder` 5/5, `bands` 3/3, `chat-attachments` 3/3, `instructions` 1/1, `procs` 1/1, `floor-hooks` 1/1, `floor-copy` 1/1, `cross-connections` 1/1, `floor-pr` 1/1, `pilot` 18/18
- **Próximas (Fase 6):** #72 Ambientes → #83 Export/import espaço → #84 Unload/reload → #85 Notificações SO → #27 Rotinas → #51 i18n
- **Nota:** shutdown do runtime endurecido (zumbi segurando porta) — achado pelo teste do #65.
- **Nota:** achado pelo e2e do #56: modal ficava atrás da barra inferior (z-index) — corrigido em `5a79039`. CI verde em `c152e06`, `9bfac0d`, `53bf1bf`.
- **Nota:** CI passou a rodar em `auto/**` a partir de `c152e06` (antes só `main`); BUILD_VERSION atual = **23** (o app troca o runtime antigo sozinho ao abrir).

## Log de execução
- Setup: branch `auto/roadmap`, assinatura GPG local configurada (Good signature verificada), baseline 78 verdes.
- Fase 0: #90 git/grep async + cache (`df6f553`, 79 testes); #40 docs alinhados (REA: NOSSO.md 16 refs, §6 real + ADR-0011). Ambas fechadas no GitHub com relato.
- Fase 2: Preferências completa — #64 shell, #55, #56, #56/#57 (+#38), #58, #61, #63, #60, #62; achados: modal atrás da barra inferior, e2e piloto desatualizado (14/18).
- Fase 1: #54 tema (`a498555`); companheiro #65 (`6d7fb11`, achou e corrigiu zumbi de shutdown), #66 Ollama (`8393b0a`, degradação testada + modelo real), #67 HUD (`f396041`, e2e Electron real). Pegadinha registrada: `app.close()` do Playwright pendura por causa da tela de encerramento — o e2e sai por `app.exit(0)` no processo principal.

## Guia de continuidade (para quem assumir — leia antes de mexer)

**Estado do git:** `main` = `auto/roadmap` (fast-forward, tudo assinado). CI roda em `main` e `auto/**`. Continuar em branch `auto/<tema>` a partir do `main`.

**Regras do projeto (dono):** pt-BR sempre; commits **assinados** (GPG local, chave já configurada neste repo — nunca gerar outra, nunca desligar assinatura) e **sem `Co-Authored-By: Claude`**; sem force-push; sem publicar release sem autorização; não fechar issue incompleta; marcar como "pendente de conferência humana" o que depende de olho humano (visual); todo trabalho com `npm run build` + `npx vitest run packages apps tests/integration` verdes, e **teste novo por feature**.

**Fluxo por issue:** implementar → build (`npm run build && npm run build -w @messai/desktop`) → testes → e2e Electron real quando houver UI → commit assinado → push → `gh issue comment` com mudanças/testes/limites → `gh issue close` → atualizar este arquivo.

**Armadilhas que já custaram caro:**
1. **Migrações do SQLite (`packages/storage`): SEMPRE no FIM da lista `MIGRATIONS`. Nunca inserir no meio** — o banco guarda só um número de versão; inserir no meio quebrou o runtime de quem já tinha migrado (`duplicate column name`). A cauda antiga virou `lateSchema` (idempotente); `upgrade.test.ts` testa os layouts históricos A–E (fixtures extraídas de commits reais). Ao criar migração nova, prefira DDL idempotente e adicione um layout novo ao teste.
2. **Testes só com banco novo escondem bug de upgrade.** Para mudanças de esquema, teste também a partir de banco antigo.
3. **Runtime trocado:** mudou código do runtime ⇒ suba `BUILD_VERSION` (`packages/contracts`), senão o app reaproveita o runtime velho. Testes de integração sobem runtime próprio (portas 479xx/480xx, `MESS_DATA_DIR` temporário) — se uma porta ficar presa, há um runtime zumbi: `ss -ltnp | grep <porta>` e mate.
4. **`npm rebuild node-pty better-sqlite3`** quando aparecer `fetch failed`/ABI após `npm install`/troca de Node.
5. **e2e Electron (`tests/e2e/*.test.ts`) não roda no CI** (precisa de display): rodar localmente um por vez; sair do app pelo processo principal (`app.evaluate(a => a.exit(0))`), nunca `app.close()` (a tela de encerramento pendura). Nós de teste devem nascer em espaço livre e a vista ser enquadrada (`Ctrl+\`); o React Flow fixa a referência do arrasto no 1º move >1 px (ver `groups.test.ts`); Alt+arrastar é capturado pelo WM no Linux.
6. **`abrir.sh` agora é versionado** (estava no `.gitignore` por `*.sh`; use `git add -f` se criar outro `.sh` que precise ir ao repo). Ele reinstala dependências quando `package-lock.json` muda.
7. Atalhos: toda tecla global passa pelo catálogo editável `keymap.ts` (não adicionar `keydown` fixo no `App.tsx`). Preferências de UI: `prefs.ts` (localStorage, tipadas); config que vale entre sessões: runtime (`/v1/settings`).
8. Undo/redo (`undo.ts`): toda mutação nova de canvas deve registrar `forward`+`inverse` (ver `rec`/`runOp` em `App.tsx`); ids recriados passam pelo remap.
9. Nós do React Flow são memoizados (#42): o rebuild reaproveita o objeto se a chave do nó não mudou — se um nó passar a depender de dado novo, inclua-o em `nodeKey` (`App.tsx`), senão a UI não atualiza.

**Pendências de conferência humana (visual, não validado por mim):** tema claro/escuro em todas as telas novas; HUD flutuante (posição/Wayland/multi-monitor); ícone da bandeja; selos de presença e pontos de estado; contêiner e guias dos grupos; fichário e diálogo de Partituras; paleta de cores customizada do terminal.

**Limites conhecidos (documentados nas issues):** fichário não entra na busca FTS nem em `mess note read`; refazer após "colocar partitura" não recoloca; terminal recriado por undo volta como processo novo; auto-update real só validável com release publicando `latest-linux.yml`; sem medição de FPS em canvas grande.

**Próximas tarefas (ordem do plano em `~/.claude/plans/robust-moseying-biscuit.md`):** Fase 4 #70 Bandas → #29 Maestro → #76 CLAUDE/AGENTS.md → #79 anexos no chat → #80 monitor de processos; Fase 5 #75 #81 #82 #31; Fase 6 #72 #83 #84 #85 #27 #51; Fase 7 **#86 e #87 (segurança) antes do #28**; Fase 8 #26 #73 #30 #28(+#59) #93.

