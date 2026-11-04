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

### Fase 6 — Runtime / infra ✅ (commits na `auto/fase6`, ainda NÃO enviada ao GitHub)
- [x] #72 Ambientes `10365c3` · [x] #83 Export/import espaço `cbf57ae` · [x] #84 Unload/reload `c4965f8` · [x] #85 Notificações SO `a608508` · [x] #27 Rotinas `8af8869` · [x] #51 i18n `f24d065`

### Fase 7 — Fronteira de confiança (antes do hub)
- [x] #86 (MESS-01) symlink `c43363e` · [x] #87 (MESS-02) authz por agente `e45b2ed`

### Fase 8 — Gigantes
- [x] #93 (MESS-09) modo isolado `a06891f` · [x] #30 Editor+git `be9a863` · [x] #26 Portais web `1a4af72` · [x] #73 Portais Android `2b75a2a`
- **Fase 8 completa**, exceto #28 hub e #59 controle remoto (pulados por decisão do usuário; seguem abertos)
- [ ] **#28 Hub e #59 Controle remoto: PULADOS por decisão do usuário (seguem abertos)**

## Estado atual
- **Roadmap:** Fases 0–8 concluídas, **exceto #28 (hub multi-máquina) e #59 (controle remoto), pulados por decisão do usuário** (seguem abertos; o hub depende do #87, já feito). Fechados nesta rodada: #86, #87, #93, #30, #26, #73.
- **Branch de trabalho:** `auto/fase6` (rastreia `origin/auto/fase6`). Commits assinados (GPG), **sem** `Co-Authored-By` (preferência do usuário): `e45b2ed` #87 · `a06891f` #93 · `be9a863` #30 · `1a4af72` #26 · `2b75a2a` #73 (último). `main` só tem até o #87 mesclado (fa21501); mesclar o resto só se o usuário pedir.
- **#73 dispositivos Android (resumo):** nó `device` = sessão **adb** no runtime. `apps/runtime/src/device.ts` (`AdbDevice`: screencap adaptativo ~1,5 fps só com observador, fila de entrada ordenada, `uiautomator dump`, apps, foco; `DeviceManager`: select/boot de AVD/shutdown só do que NÓS iniciamos/disconnect; emulador sobe `-no-window -read-only` por padrão, `persist` tira o read-only, reaproveita AVD já rodando via `emu avd name`), `packages/domain` (`parseAdbDevices`, `parseUiDump`, `uiNodeAt`, `androidKey`, `androidInputText`, validadores de pacote/atividade/AVD/serial), rotas `/v1/devices[/:id|/act|/ui|/screenshot|/apps]`, WS `deviceWatch/deviceFrame/deviceState`, capacidade **`devices:control`** (padrão do agente confiável; nunca aprovável para isolado), CLI `mess device …`, UI `DeviceNode.tsx` (seletor de aparelho/AVD, toque/swipe/longo/roda/teclado/colar, Voltar/Início/Recentes, texto, apps, inspeção por árvore de acessibilidade com envio ao agente). **Só ações estruturadas: nenhum `adb shell` livre; tudo que vai ao shell do aparelho é validado/escapado.** Texto só ASCII (limite do `input text`). `scrcpy` NÃO é usado (o binário desta máquina está quebrado: falta libavformat.so.59) — a captura por `screencap` não precisa dele.
- **BUILD_VERSION = 33**.
- **Testes:** determinística `npx vitest run packages apps tests/integration` = **296 passam + 2 pulados** (72 arquivos; portal e git usam Chrome/git reais; device usa adb/emulator FALSOS em `tests/fixtures/device/`). **Opt-in com emulador REAL:** `MESS_TEST_ADB_SERIAL=emulator-5554 [MESS_TEST_AVD=<avd rodando>] npx vitest run tests/integration/device-real.test.ts` (passou 2/2 contra um emulador API 30). e2e Electron (rodar EM SÉRIE: `npx vitest run --no-file-parallelism tests/e2e/...`): device 5/5, portal 5/5, pilot 18/18, editor-git 4/4, isolation 3/3 e os das fases anteriores. **IMPORTANTE:** e2e usa `apps/desktop/out`: rode `npm run build -w apps/desktop` além de `npm run build` (só `tsc -b`).
- **Pegadinhas:** com CPU saturada (ex.: emulador Android rodando) os testes de Chrome/Electron ficam intermitentes — encerre o emulador antes de rodar a suíte; bwrap não monta sobre symlink; `pkill -f` casa com o próprio shell (mate por PID); `pgrep` precisa de `--` antes de padrão que começa com `--`; `exactOptionalPropertyTypes` pede `| undefined` explícito; fish não divide variáveis em palavras (use `bash -c` para scripts).
- **Visual:** conferi por screenshot o painel Git, o painel de Isolamento, o portal e o dispositivo (com um Android REAL na tela e a inspeção). Peça ao usuário para conferir no dia a dia (nunca vi o app rodando fora do Playwright).

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

## Mapa de branches e git (atualizado)
- `main` (`28149ac`) já contém a **Fase 4**. A `auto/fase5` está **5 commits** à frente (no GitHub). A `auto/fase6` está **7 commits à frente da fase5 e só existe local** (precisa de `git push -u origin auto/fase6`). Quando a suíte estiver verde: fazer o merge em cadeia fase5 → fase6 → `main` (fast-forward, sem force) — o dono costuma pedir "faz merge pro main".
- Há trabalho do #87 **não commitado** na `auto/fase6`; não faça `git stash`/`checkout` que o perca. Para checar se algo falha sem ele: `git stash -u`, testar, `git stash pop`.
- Hub (#28) depende do #87 (credencial/autorização por agente) — não começar antes.
- Fase 7/8: #87 authz por agente (`e45b2ed`); #93 modo isolado com bubblewrap (`a06891f`) — testes com bwrap real acharam 3 bugs (sonda sem /lib64, resolv.conf como link, /bin/sh isolado). #28/#59 pulados a pedido.
- Fase 8: #30 editor CodeMirror + git (`be9a863`); #26 portais web com Chromium via CDP/pipe, `mess portal`, capacidade `portals:control`, modo design (este ciclo) — testes com Chrome real acharam: URL inicial sobrescrita pelo onState, popup com URL vazia, filhos do Chrome escrevendo no perfil, regressão de estado por resposta HTTP tardia, atalhos globais capturando teclas do portal.
- Fase 8 fechada (exceto #28/#59): #73 portais Android via adb — testes com adb falso + emulador real; bugs achados: título do portal devolvido antes de ser lido, atalhos globais engolindo teclas, aprendizado de que o `input tap` custa ~0,7 s no aparelho e o `screencap` ~0,6 s.
