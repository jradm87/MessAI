# Plano — Porte do MessAI para Windows (`windows_version`)

> Branch: **`windows_version`** (base: `main` em `eb953f7` / v0.0.15, mesclado em `83c1234`). **Rev. 6** — auditoria da rev. 5 contra o código **atual** (Linux, só leitura; o que depende de executar em Windows continua **hipótese**).
> O que mudou na rev. 6: (1) todas as referências `arquivo:linha` reconferidas e corrigidas para o `main` atual (`withAgentAutonomy`, clipboard pelo processo principal, `mess binder`/`mess color`, hint com `"$MESS_CLI"` entre aspas); (2) **sete achados novos** (O–T, V): testes unitários que leem `/proc`, `O_NOFOLLOW` inexistente no Windows, `SHELL=pwsh` exportado ao agente, e2e Playwright Linux-only, reflink/symlink na cópia de andares, chave do `~/.claude.json`; (3) a seção de execução foi **reescrita para 2 trilhas** (a rev. 5 prometia isso no cabeçalho mas ainda trazia os 7 papéis da rev. 4 — o modelo antigo virou nota histórica); (4) **seção nova "Guia prático para os agentes executores"**: instalação com `winget`, `.gitattributes` exato, renormalização, roteiro de teste passo a passo com resultado esperado, checklist de aceite por fase e regras de trabalho; (5) estimativa ajustada (12–21 dias-pessoa).
> Objetivo: instalador Windows (`.exe`) reaproveitando o código atual, sem reescrever o app.
> Convenção: toda referência a código é `arquivo:linha` no estado de `83c1234`; `service.ts` = `apps/runtime/src/service.ts`, `domain` = `packages/domain/src/index.ts`, `contracts` = `packages/contracts/src/index.ts`, `desktop/main` = `apps/desktop/src/main/index.ts`. Repositório na máquina Windows: `C:\Users\ctscs\Documents\MessAI`.

## Decisão (ADR)
**Build nativo do Electron para Windows** (electron-builder **`nsis`**; `portable` opcional, ver Fase 3).

Por quê (verificado no código):
- Tudo que é pesado já roda em Node e tem suporte Windows: node-pty 1.0.0 (ConPTY), better-sqlite3 13.0.3, Fastify (named pipe), electron-updater 6.3.9 (NSIS). Electron **45.1.0**, electron-builder 25.1.8, `@electron/rebuild` 3.7.1 (`package-lock.json`).
- **Tauri** ainda precisaria do runtime Node como sidecar e da reimplementação do host do xterm/React Flow — mais trabalho, mesmo risco. Fica como otimização futura.
- **Portais NÃO dependem do Electron:** cada portal é um **Chromium headless separado dirigido por CDP via pipe** (`apps/runtime/src/portal.ts:12`, `:98`, `:101`), não `BrowserView`.
- **GUI nativa Rust**: reescrita total → descartada.
- **WSL2 (AppImage + WSLg) = caminho suportado oficialmente**, não só "alternativa": é o único modo em que tmux, bubblewrap (modo isolado), hooks/rotinas em `sh` e a suíte de integração funcionam 100%. Ganha página de instalação enquanto o nativo amadurece.
- **Segurança no Windows:** o named pipe não tem `chmod`; a autenticação fica no **Bearer** + credencial por terminal com escopo (`apps/runtime/src/server.ts:35-45`, `service.ts:2057` `agentTokenForSpawn`). Decisão registrada.

## Degradações aceitas no Windows (feature-flags)
- **tmux** ausente → sem sessões duráveis / `--persist`. `SessionManager.tmuxAvailable()` (`apps/runtime/src/sessions.ts:64`) já desliga quando não há `tmux` no PATH, mas um tmux do MSYS2 no PATH ligaria `terminal.tmux` (`server.ts:123`) e `persist` (`service.ts:1967`, `:3250`) sobre um ConPTY — **forçar `false` em `win32`**.
- **bubblewrap** ausente → sem modo isolado. A API deve **rejeitar** `isolation` no Windows (hoje `probeIsolation()` devolve `available=false` e `buildIsolatedPlan` cai em `/bin/sh -c "echo …; exec sleep 3600"` — `apps/runtime/src/isolation.ts:47-51`; chamado em `service.ts:2077-2081`; o terminal nasce "exited" sem mensagem porque `/bin/sh` não existe).
- **Monitor de processos (#80)**: v1 só raiz/memória (sem `/proc`) ou oculto (`apps/runtime/src/procs.ts:12-23`).
- **Hooks e rotinas** rodam em **PowerShell** no Windows (decisão de produto; documentar).
- **Cópia de andares (floors) sem reflink**: a sonda `COPYFILE_FICLONE_FORCE` (`service.ts:1360`) sempre falha em NTFS → cópia integral; `symlinkSync` na cópia (`:1442`) exige privilégio/Modo Desenvolvedor e já está em `try/catch` → o link vira ausência silenciosa (ver S/T).
- Shell padrão: `MESS_SHELL` > `pwsh` > `powershell.exe` > `%COMSPEC%`. **Verificado na máquina: Windows 11 Pro não traz `pwsh`** (só `powershell.exe` 5.1), que usa codepage OEM por padrão — reforça H.

---

## Diagnóstico consolidado (o que quebra no Windows)

### Bloqueantes
| ID | Problema | Evidência (`83c1234`) | Correção |
|---|---|---|---|
| A | **Spawn do agente no ConPTY**: `pty.spawn(plan.command, …)` com `plan.command = "claude"` → `CreateProcess` não resolve `.cmd` (instalação via `npm i -g` gera `claude.cmd`/`codex.cmd`; o instalador nativo do Claude Code gera `claude.exe` em `%USERPROFILE%\.local\bin` — **hipótese**) → `ENOENT`. E o `--append-system-prompt` multilinha gigante (hint + papel + skills) vai num único argv: via shim `.cmd` quebras de linha e `% ^ & \| "` corrompem o argumento, e a linha tem teto de 32 767 chars. | `sessions.ts:79-85`, `apps/runtime/src/presets.ts:9,17`, `domain:290-307` (`applySkills`/`applyRole`), `service.ts:2074-2075` (`withAgentAutonomy(applySkills(applyRole(…)))` → `planLocalTerminal`), `contracts:971,974` (`MESS_ROLE_INSTRUCTIONS`/`MESS_SKILLS_TEXT` já existem e já são injetados em `service.ts:2060-2061`) | `resolveSpawnCommand()` com `PATHEXT` aplicado ao `plan.command` no ponto do `pty.spawn` (preferir `.exe`; se `.cmd` de pacote npm, chamar `node <cli.js>` do pacote). **Tirar texto longo do argv no Windows**: papel/skills por env (já vão) e só o hint curto no argv; teste que falha se a linha gerada passar de ~30 k. |
| B | **`$MESS_CLI` com `\` quebra o launcher sh no Git Bash**: `dirname 'C:\a\mess'` = `.` → procura `./dist/index.js`. As skills e o hint mandam usar `"$MESS_CLI"` (**rev. 6: o hint já usa aspas** — `presets.ts:9` tem `\"$MESS_CLI\"`; a rev. 5 dizia que não). No pacote, `MESS_ELECTRON=C:\…\MessAI.exe` entra no launcher sh (`package.mjs:31`) — em Git Bash funciona entre aspas duplas (**hipótese**). | `service.ts:2066` (`[AGENT_ENV.cli]: join(CLI_DIR,"mess")`), `:2070` (`MESS_ELECTRON`), `scripts/package.mjs:31`, `apps/cli/bin/mess:2`, `skills/*/SKILL.md` (7 arquivos, todos com `"$MESS_CLI"`) | Exportar `MESS_CLI` em forma POSIX (`/c/Users/...`) para o Git Bash **e** `MESS_CLI_CMD` (`mess.cmd`) para pwsh; launcher sh robusto a `\` (`cygpath -u`); `MESS_ELECTRON` idem. |
| 1 | CLI `mess` é `#!/bin/sh` (dev e pacote); PowerShell não executa um arquivo sem extensão. (`npm ci` gera shims `node_modules/.bin/mess.cmd` via cmd-shim a partir do `bin` de `apps/cli/package.json:6`, mas o shebang é `/bin/sh`, não `node` — **hipótese**: o shim gerado chama `sh`, inútil fora do Git Bash; e `CLI_DIR` aponta para `apps/cli/bin`, não para `.bin`.) | `apps/cli/bin/mess:1-2`, `service.ts:38` (`CLI_DIR`), `package.mjs:31` | Gerar `mess.cmd` (dev e pacote) e manter o `sh` (Claude Code no Windows executa via Git Bash). |
| 2 | `whichOnPath` ignora `PATHEXT` e usa `X_OK`; `includes("/")` não reconhece `\`. É só a **sonda** de disponibilidade (ver A), mas sem ela `findBrowser`/`findAdb`/`probeIsolation` nunca acham `.exe`. | `apps/runtime/src/providers.ts:18-24`; usado em `portal.ts:21`, `device.ts:18,24,30`, `isolation.ts:12,67,73`, `providers.ts:53-54` | `PATHEXT` + sem `X_OK` no Windows + reconhecer `\`. |
| 6 | Socket unix `agent.sock` + `chmod`/`unlink`; `existsSync` num named pipe **abre uma conexão cliente** (efeito colateral). O CLI monta o caminho com concatenação `${d}/agent.sock` e `HOME`. | `config.ts:58`, `apps/runtime/src/index.ts:32,46,62,65-66`, `apps/cli/src/index.ts:12-14` | Pipe `\\.\pipe\messai-<hash(dataDir)>`; pular `chmod`/`unlink`/`existsSync` no Windows; `defaultSocket()` do CLI replicando a regra e usando `USERPROFILE`. `http.request({ socketPath })` e `listen({ path })` aceitam named pipe (suporte do `net` do Node — não é hipótese). |

### Alto
| ID | Problema | Evidência | Correção |
|---|---|---|---|
| C | Chave **`PATH` vs `Path`**: copia `process.env` (`Path`) e grava `PATH` → duas chaves; `CLI_DIR` pode nunca entrar no PATH do terminal. | `service.ts:2050-2051` (`plan`), `:1538-1539` (`hookEnv`), `:2082` (`PATH: baseEnv["PATH"]!` no `wrapInTmux`) | Normalizar a chave existente (case-insensitive) num helper `prependPath`. |
| D | **Pasta de dados diverge**: desktop aceita ponteiro só se `startsWith("/")`; runtime aceita `isAbsolute`. Com `D:\MessAI`, desktop lê token no lugar errado → health falha → loop de restart. | `desktop/main:15` vs `apps/runtime/src/data.ts:20`; `desktop/main:19` (`PORT`), `:24` (`runtime.token`) | Unificar com `isAbsolute` do `node:path`. |
| E | **`findBrowser()` só conhece binários Linux**; Chrome/Edge não ficam no PATH no Windows → portais não funcionam. | `portal.ts:18-23`, erro em `:291` | Caminhos padrão de `msedge.exe` (presente em todo Win10/11) e `chrome.exe` (`Program Files`, `Program Files (x86)`, `LocalAppData`); validar `--remote-debugging-pipe` com fds 3/4 (**hipótese**: funciona, é o que o Puppeteer usa). |
| 3 | `resolveDefaultShell` → `MESS_SHELL` > `userInfo().shell` (**rev. 6**: novo; no Windows devolve `null`) > `$SHELL` > `/bin/bash`. | `config.ts:31-35` | Cadeia pwsh → powershell → `%COMSPEC%` em `win32`. |
| 4 | Desktop sobe runtime com `detached: true` → (**hipótese**) console; fallback `process.kill(pid,"SIGTERM")` vira `TerminateProcess` e o handler `SIGTERM` do runtime nunca roda (sem `shutdownAll()`). O caminho normal é o endpoint `/v1/shutdown` (`desktop/main:69`), que funciona no Windows. | `desktop/main:101`, `:75-76`, `apps/runtime/src/index.ts:71` | `detached` só fora do Windows + `windowsHide: true`; fallback via `taskkill /T`. |
| 5 | `/proc`/`ps` no monitor e em `pidOnPort`; `process.kill(-pid)` (grupo) lança e é engolido → Chrome headless, emulador e hooks órfãos. | `procs.ts:12-23`, `desktop/main:42-57`, `service.ts:1628`, `device.ts:196,242`, `portal.ts:256` | `killTree(pid)` → `taskkill /PID <pid> /T /F`; degradar monitor. |
| K | **CRLF já está no working tree da máquina Windows.** O clone lá tem `core.autocrlf=true` e `git ls-files --eol` mostra `w/crlf` em `apps/cli/bin/mess`, `abrir.sh`, `scripts/package.mjs` e todos os `.ts`. (**Verificado na máquina Windows**; no Linux o índice está `i/lf` em todos — conferido na rev. 6.) Com `#!/bin/sh\r` o launcher não executa no Git Bash, e o launcher gerado por `package.mjs:31` herdaria o problema. Não há `.gitattributes` no repo. | `apps/cli/bin/mess:1`, `package.mjs:31`, ausência de `.gitattributes` | `.gitattributes` (conteúdo exato na seção "Guia prático", §10.2) **e renormalizar o checkout**. Teste no CI Windows: `bash.exe apps/cli/bin/mess --help`. |
| M | **Nome do binário com `\` ou extensão quebra a detecção de agente.** `applyRole`/`applySkills` comparam `command.split("/").pop() === "claude"`; `agentKind` usa `/(^|[\s/])claude([\s/-]|$)/` — `C:\…\claude.cmd`, `claude.exe` ou `claude.cmd` não casam → sem papel/skills, sem `--dangerously-skip-permissions` (**rev. 6**: agora via `withAgentAutonomy` → `withClaudeAutonomy`, que também depende de `agentKind`; o mesmo vale para codex/agy/opencode), sem pré-trust (`service.ts:2072`), turno não detectado (`sessions.ts:87`, `:326`). | `domain:161-172` (`AGENT_BINS`/`agentKind`), `:292`, `:302`, `:855-865` (`withClaudeAutonomy`), `:880-903` (`AGENT_AUTONOMY`/`withAgentAutonomy`); `sessions.ts:87` | `binaryName(command)` no `domain` (tira diretório por `/` **e** `\` e sufixo `.exe/.cmd/.ps1`) usado por `agentKind`/`applyRole`/`applySkills`. **E** o `resolveSpawnCommand()` de A roda só no `pty.spawn` (`sessions.ts:79`), nunca altera `session.command` gravado. Teste unitário com `C:\x\claude.cmd` e `codex.cmd`. |

### Médio
| ID | Problema | Evidência | Correção |
|---|---|---|---|
| F | Rotinas com **`/bin/sh -c` fixo**; hooks com `<defaultShell> -c` (pwsh aceita `-c`, `cmd` exige `/c`). | `service.ts:410` (rotinas), `:1586` (hook `run`), `:1876` (teardown) | `shellCommandArgs(shell, cmd)` por shell; documentar "PowerShell no Windows". |
| G | Hint/skills ensinam sintaxe POSIX (`"$MESS_CLI"`, aspas simples). Codex no Windows usa PowerShell (`$env:MESS_CLI`). | `presets.ts:9`, `skills/*/SKILL.md:9-16` | Variante do hint por plataforma/shell, ou exigir Git Bash; `MESS_CLI_CMD` nas skills. |
| H | **Bracketed paste** (`\x1b[200~…`) no ConPTY depende da versão do Windows → briefing pode chegar solto/sem Enter (**hipótese**). **Encoding**: console em codepage OEM/1252 → mojibake em pt-BR. | `sessions.ts:222-231` (`deliver`: paste + `\r` atrasado 2×), `:97` (`onData`) | Testar `deliver` no ConPTY; forçar UTF-8 (`chcp 65001` / `[Console]::OutputEncoding`) no shell spawnado. |
| N | **`detached: true` em processos de console pode abrir janela de console no Windows** (hooks, emulador, scrcpy) — **hipótese** (a doc do Node diz "terá seu próprio console"; o libuv usa `DETACHED_PROCESS`, que *não* cria janela — só o teste decide). Nenhum `spawn` do repo usa `windowsHide`. | `service.ts:1586`, `device.ts:184,222`, `portal.ts:101`, `desktop/main:101`; `grep windowsHide` = 0 ocorrências | `windowsHide: true` em todo `spawn` auxiliar; `detached` só fora do Windows (ver #4/F). |
| I | `0o600`/`0o700`/`chmod` são no-op no Windows; fora de `%USERPROFILE%` (ex.: `D:\MessAI`) o `runtime.token` (token mestre) fica legível por `Users`. | `config.ts:46-53`, `apps/runtime/src/index.ts:66-67`, `data.ts:20,96-99`, `service.ts:1332-1336` (anexos), `desktop/main:99` | Ajustar ACL (`icacls`) ou avisar na UI ao mover a pasta de dados para fora do perfil. |
| J | Encerramento forçado/logoff deixa órfãos (claude.exe, pwsh, Chrome, emulador). | `desktop/main:75-76` | Job Object (kill-on-close) amarrando filhos ao runtime; no mínimo `taskkill /T` também no fallback. |
| L | Empacotamento: `package.mjs:50` `--linux` fixo; desktop só tem target `linux` (`apps/desktop/package.json:45-53`), sem `.ico`. **node-pty 1.0.0 não tem prebuild Windows** (`hasInstallScript` no lock) → compila do fonte em todo `npm ci` e exige VS Build Tools **com libs Spectre-mitigated** (ponto clássico de falha). better-sqlite3 13 tem prebuild para Node e para Electron (**hipótese**: `electron-rebuild` aproveita via `prebuild-install`). **`portable` não tem auto-update.** SmartScreen bloqueia instalador **e cada update** sem assinatura. `execSync` com `"${bin("esbuild")}"` (sem `.cmd`) e `--banner:js="…;…"` passam pelo `cmd.exe` (**hipótese**: funciona, `cmd` aplica PATHEXT a caminho completo). | `package.mjs:26,30,31,41,50`, `apps/desktop/package.json:45-53`, `desktop/main:249-263,392-393` (auto-update) | Ver Fase 3. |
| O | **Testes unitários Linux-only na suíte `packages apps`** (**rev. 6, novo**): `procs.test.ts` lê `/proc` e exige `rssKb > 0` → falha no Windows; `agents.test.ts:16` cria `fake-cli` com `#!/bin/sh` + `chmod 0o755` e espera `whichOnPath` achar (**hipótese**: passa, porque no Windows `accessSync(X_OK)` não verifica execução — mas vira teste sem sentido). O job `windows-latest` da Fase 2 roda exatamente essa suíte. | `apps/runtime/src/procs.test.ts:5-11`, `agents.test.ts:13-20` | `it.skipIf(process.platform === "win32")` nos casos `/proc`; no `agents.test`, criar `fake-cli.cmd` no Windows (cobre #2 com `PATHEXT`). `systemd.test.ts`, `presets.test.ts` (`"/bin/sh"` explícito), `data.test.ts` (`isAbsolute("/x/y")` é `true` em win32) e os testes puros do `domain`/`storage` passam. |
| P | **`O_NOFOLLOW` não existe no Windows** (**rev. 6, novo**): `fs.constants.O_NOFOLLOW` é `undefined` → `flags | undefined` = `flags` (não lança), mas a proteção contra escrever através de symlink/junction no editor de arquivos some. `isWithinCanonicalRoot` compara caminhos com caixa sensível; NTFS não diferencia (`C:\Users` = `c:\users`) e `realpathSync` pode devolver caixa diferente da gravada no espaço (**hipótese**) → falso `FORBIDDEN`. | `service.ts:1069`, `:1076`; `domain:443-452` | No Windows: `lstatSync` + `isSymbolicLink()` antes do `openSync`; `isWithinCanonicalRoot` com `toLowerCase()` em `win32`. Teste com `C:\A\b` vs `c:\a\b`. |
| Q | **`SHELL=<defaultShell>` é exportado ao agente** (**rev. 6, novo**): no Windows viraria `SHELL=…\pwsh.exe`. O Claude Code no Windows exige **Git Bash** e procura via `CLAUDE_CODE_GIT_BASH_PATH`/PATH; um `SHELL` apontando para pwsh pode confundir a detecção (**hipótese**). | `service.ts:2068` (`SHELL: this.cfg.defaultShell`) | Em `win32`, não exportar `SHELL` (ou exportar o `bash.exe` do Git quando existir); nunca pwsh. |
| S | **Reflink e `MESS_FORCE_COW`** (**rev. 6, novo**): sonda `COPYFILE_FICLONE_FORCE` falha em NTFS → andares copiados integralmente (lento em repos grandes), sem erro. | `service.ts:1355-1364`, `:1448` | Aceitar a degradação; medir no smoke com um repo de ~500 MB; documentar. |
| T | **Symlinks na cópia de andares** exigem privilégio ou Modo Desenvolvedor no Windows (**rev. 6, novo**); hoje `try/catch` engole → link some sem aviso. | `service.ts:1442`, `:1449` (`chmodSync` no-op) | Logar os links não copiados no status do andar; documentar "ative o Modo Desenvolvedor". |
| 7 | `abrir.sh` é bash (`ss`, `/proc`, `wmctrl`). | `abrir.sh:1` | `abrir.ps1` ou documentar `npm run desktop`. |

### Baixo (fazer junto, custo mínimo)
- `process.on("SIGUSR2")` no main do Electron — guardar por plataforma (**hipótese**: no Windows o Node não define `SIGUSR2` em `os.constants.signals` → vira listener inerte, não lança; guardar mesmo assim por clareza) — `desktop/main:408`.
- Filtro de env de nota secreta é case-sensitive (`/^(PATH|SHELL)$/`, `MESS_`) → no Windows uma nota `path` sobrescreve o PATH — `service.ts:2037`.
- Preset `shell` persiste `command: defaultShell` no banco; backup importado do Linux traz `/bin/bash` — normalizar no boot — `presets.ts:14-16`.
- systemd: **nada a ocultar** — não há opção na UI; o desktop já guarda com `process.platform === "linux"` (`desktop/main:87`) e a unidade só é instalada pelo CLI separado `messai-runtime-service` (`apps/runtime/src/service-cli.ts`, `systemd.ts`). Opcional: mensagem "só Linux" nesse CLI.
- `HOME` inexistente no Windows (`apps/cli/src/index.ts:13`); `expandHome` só trata `~/` (`domain:684`).
- `split("/").pop()` / `includes("/")` para nomes — cosmético — `service.ts:945`, `:1958`, `desktop/main:322`, `apps/desktop/src/renderer/src/TreeNode.tsx:39,45,54`, `PrefsAgents.tsx:167`.
- `ci.yml:6` só dispara em push para `main`/`auto/**` — push em `windows_version` **não roda CI** (PR roda). Adicionar `windows_version` e `win/**` à lista.
- **V** (**rev. 6, novo, hipótese**): `ensureClaudeTrust` grava `~/.claude.json` → `projects[cwd]` com o `cwd` como o Node devolve (`C:\Users\…`, barras invertidas). Se o Claude Code no Windows indexar com outra grafia (barra normal/caixa), o pré-trust não vale e o diálogo "trust this folder" volta a fechar o briefing. `service.ts:3204-3214`. Validar no smoke: recrutar Claude num diretório novo e ver se o diálogo aparece.
- Ícone: `apps/desktop/build/icon.png` é **512×512** — o electron-builder gera o `.ico` sozinho; `.ico` próprio é opcional.
- Já OK (verificado): `safeRelPath` trata `\` e drive (`domain:432-437`); `isWithinCanonicalRoot` normaliza `\` (`domain:444`, mas ver P); `COPYFILE_FICLONE`/`symlinkSync` degradam em `try/catch` (ver S/T); `git.ts:8` usa `execFile("git")` sem shell; `skills.ts` só usa `join`/`cpSync` e instala em `%USERPROFILE%\.claude\skills` etc. (`skills.ts:11-17,33-43`); `accounts.ts` só lê `~/.claude`/`~/.codex`; `rmSync` do perfil do Chrome tem `maxRetries` (`portal.ts:257`, bom para locks do Windows); `desktop/main:96` usa `node` do PATH (`MESS_NODE`) em dev e `process.execPath` + `ELECTRON_RUN_AS_NODE` empacotado — funciona no Windows; o endpoint `/v1/shutdown` é o caminho normal de parada (`desktop/main:69`).

---

## Fases (ordem final)

### Fase 0 — Máquina Windows + ferramentas (0,5–1 dia) ⟵ começar aqui
- [x] Máquina: **esta** (Windows 11 Pro build 26200, Git for Windows 2.56).
- [x] Instalado em 2026-11-07: fnm 1.39 + Node **22.23.4** (padrão do fnm; `%APPDATA%\fnm\aliases\default` no PATH do usuário), npm 10.9.9, Python 3.12.10, VS 2022 Build Tools (VCTools + Spectre, MSVC 14.44, SDK 10.0.26100). Claude Code nativo 2.1.319 já estava (`%USERPROFILE%\.local\bin\claude.exe`); Edge e Chrome presentes. **Faltam**: Codex (`npm i -g @openai/codex`), `pwsh` 7 (opcional). **Rede corporativa**: exportar `NODE_OPTIONS=--use-system-ca` antes de `npm`.
- [x] **`.gitattributes` + renormalizar o checkout (K)** — commit `chore(windows): .gitattributes e renormalização (K)`; o índice já era LF (nenhum arquivo mudou); após reescrever o working tree, `git ls-files --eol | grep -c w/crlf` = 0 e `apps/cli/bin/mess` começa com `#!/bin/sh\n`.
- [x] `npm ci` (após node-pty → 1.1.0, ver §11 L0) + `npm run build` limpo + `npx vitest run packages apps` → **4 falhas** (todas item O, detalhe em §11 O), não só `procs.test.ts`.
- [ ] Validar hipóteses: **feito** A, B, E, H (PowerShell 5.1), P, SIGUSR2, O, L0. **Pendente** (exige observação humana ou sessão interativa do Claude): N (janela de console visível), Q (`SHELL` no Claude Code), V (diálogo de trust), H com `claude`.

### Fase 1 — Núcleo multiplataforma (runtime + CLI + domain) (3–5 dias)
- [ ] `whichOnPath` com `PATHEXT`, sem `X_OK`, reconhecendo `\` (#2).
- [ ] **`resolveSpawnCommand()`** no spawn do PTY + **texto longo fora do argv** no Windows (A).
- [ ] Shell padrão Windows (#3); não exportar `SHELL=pwsh` ao agente (Q).
- [ ] Named pipe (#6), pulando `chmod`/`unlink`/`existsSync`; `defaultSocket` do CLI.
- [ ] Launcher `mess.cmd` + sh robusto a `\`; `MESS_CLI` POSIX + `MESS_CLI_CMD`; nota pwsh nas skills (#1, B, G).
- [ ] Normalizar chave `PATH` (C).
- [ ] Unificar `resolveDataDir` desktop/runtime (D).
- [ ] `findBrowser()` com Edge/Chrome do Windows (E).
- [ ] Rotinas/hooks com `shellCommandArgs` (F).
- [ ] `killTree()` + monitor degradado (#5); `windowsHide` em hooks/emulador/scrcpy/Chrome (N); desktop `detached` só fora do Windows + fallback `taskkill` (#4).
- [ ] `binaryName()` no `domain` para `agentKind`/`applyRole`/`applySkills`/`withAgentAutonomy` (M).
- [ ] Rejeitar `isolation` no Windows (`service.ts:1940-1942` e `:3004`); `tmuxAvailable()` → `false` em `win32`.
- [ ] `O_NOFOLLOW` → `lstat` no Windows; `isWithinCanonicalRoot` sem caixa em `win32` (P).
- [ ] Itens "Baixo" (SIGUSR2, filtro case-insensitive, preset shell, `HOME`/`expandHome`, `includes("/")`).
- [ ] **Testes unitários** (rodam no Linux e no `windows-latest`): `whichOnPath`+`PATHEXT`; `resolveSpawnCommand`; `binaryName` com `C:\x\claude.cmd`; normalização `PATH`; nome do pipe; tamanho da linha de comando (≤ 30 k ou via env); `resolveDataDir` com `C:\`; `shellCommandArgs` por shell; `isWithinCanonicalRoot` sem caixa. **E** `skipIf(win32)` em `procs.test.ts` + `fake-cli.cmd` em `agents.test.ts` (O).

### Fase 3 — Empacotamento Windows (2–4 dias) ⟵ **em paralelo à Fase 1** (Trilha 2)
> Antecipada: o `electron-rebuild` do node-pty no runner Windows é o risco de infra mais incerto e não depende do código do runtime. Um `.exe` cedo permite testar na máquina.
- [ ] `apps/desktop/package.json`: bloco `build.win` com target **`nsis`** (auto-update); `portable` só se aceitarmos "sem auto-update"; ícone vem de `build/icon.png`.
- [ ] `package.yml`: job `windows-latest` com `@electron/rebuild --force` (node-pty, better-sqlite3), cache, publish no mesmo release da tag (`latest.yml`). Conferir que o runner tem as **Spectre libs** (se não, `vs_installer modify` no job — **hipótese**: primeira falha provável do job).
- [ ] `package.mjs`: remover `--linux` fixo (`:50`) e escolher por `process.platform`/flag; gerar `mess.cmd` + `cli.mjs` em `resources/cli` (`:31`); skills incluídas (`:44`). Conferir no Windows o `execSync` com aspas (`:26`, `:30`, `:41`).
- [ ] Pós-build no CI: `ELECTRON_RUN_AS_NODE=1 MessAI.exe resources\cli\cli.mjs --help` (validar stdout — **hipótese**: binário GUI pode não emitir no console; alternativa: redirecionar para arquivo).

### Fase 2 — CI Windows + smoke real (1,5–2,5 dias)
- [ ] Job `windows-latest` em `ci.yml`: `npm ci`, `npm run build`, `npm rebuild node-pty better-sqlite3` (como o job Linux faz em `ci.yml:28`), `npx vitest run packages apps` (**sem** `tests/integration`). Adicionar `windows_version` e `win/**` aos `branches` do `push` (`ci.yml:6`).
- [ ] Smoke headless **pelo caminho real** (`scripts/smoke-windows.mjs`): runtime → `/v1/health` → terminal **`powershell -NoProfile`** (e `pwsh` se houver) executando `mess context` e `mess note write`; o mesmo via **Git Bash** (`C:\Program Files\Git\bin\bash.exe`, existe no runner) chamando `"$MESS_CLI" context`; `deliver` com `\r` chegando como uma linha; saída com acento (`echo "diretório"`) correta no buffer. Roteiro manual equivalente em §10.3.
- [ ] e2e Playwright/Electron em `windows-latest`: **R** (**rev. 6, novo**) — todos os `tests/e2e/*.test.ts` sobem o runtime com `spawn("node", …)` e `SHELL: "/bin/sh"` (ex.: `tests/e2e/about-updates.test.ts:17,21`) → portar o helper de boot para `MESS_SHELL` por plataforma antes de rodar `pilot`, `prefs`, `portal`.
- [ ] **Suíte de integração é Linux-only por construção**: **todos os 43** arquivos de `tests/integration` dirigem terminais com `/bin/sh`/`MESS_SHELL=/bin/sh` (ex.: `shell.test.ts:18,26`). Não vale editar 43 arquivos com `skipIf`: basta **não incluir `tests/integration` no job Windows**. Depois, portar 3–4 testes-chave (`shell`, `notes`, `lifecycle`, `routines`) para uma variante `*.win.test.ts` com `powershell`.

### Fase 4 — Portais, dispositivos, paste/encoding (2–4 dias)
- [ ] Portais: CDP por pipe com Edge/Chrome no Windows.
- [ ] adb/emulator/scrcpy `.exe` + `ANDROID_SDK_ROOT`/`MESS_ADB`/`MESS_EMULATOR`/`MESS_SCRCPY` (`device.ts:15-30`); documentar instalação.
- [ ] Bracketed paste e UTF-8 no ConPTY (H); ajustar `deliver` se preciso.
- [ ] ACL da pasta de dados fora do perfil (I); Job Object para órfãos (J); log de symlinks não copiados (T); medir cópia de andar (S).

### Fase 5 — Dev no Windows (0,5 dia)
- [ ] `abrir.ps1` (build + subir app) ou documentar `npm run desktop`.

### Fase 6 — Release + teste manual (2–4 dias)
- [ ] **Assinatura de código** (Azure Trusted Signing) **antes do primeiro release público** — SmartScreen bloqueia instalação e cada update. electron-builder 25 tem `win.azureSignOptions` (**hipótese**: disponível na 25.1.8; senão `signtool`/`AzureSignTool` em passo próprio). Conferir `publisherName` (o electron-updater valida a assinatura do instalador baixado — inferência da documentação).
- [ ] Tag de pré-release com Linux + Windows no mesmo release.
- [ ] Teste manual na máquina **a cada fase** (não só no fim) + rodada final: instalar, espaço, terminal, nota, portal, recrutar agente (Claude e Codex), nota secreta, auto-update.
- [ ] Página de instalação do **WSL2** como caminho suportado.

## Estimativa
| Fase | Dias-pessoa (rev. 5) | Dias-pessoa (rev. 6) | Por quê mudou |
|---|---|---|---|
| 0 — Máquina + ferramentas | 0,5–1 | 0,5–1 | — |
| 1 — Núcleo multiplataforma | 3–5 | **3,5–5,5** | + P (lstat/caixa) + Q + ajustes de testes unitários (O) |
| 3 — Empacotamento (paralelo à 1) | 2–4 | 2–4 | inalterado: incerteza de infra (node-pty + MSVC + Spectre no runner) |
| 2 — CI + smoke real | 1–2 | **1,5–2,5** | + porte do helper e2e (R) |
| 4 — Portais/dispositivos/encoding | 2–4 | 2–4 | — |
| 5 — Dev no Windows | 0,5 | 0,5 | — |
| 6 — Release + teste manual | 2–4 | 2–4 | + espera externa da assinatura |
| **Total** | **11–20** | **12–21** | julgamento a partir do código lido, não medido |

Relógio de parede com 2 trilhas em paralelo (§9): **8–12 dias úteis**.

## Riscos & mitigação
| Risco | Mitigação |
|---|---|
| CRLF (K) | `.gitattributes` + renormalizar antes do primeiro `npm ci`; `bash.exe apps/cli/bin/mess --help` no CI Windows. |
| Detecção de agente com `.exe/.cmd` (M) | `binaryName()` + `session.command` sempre o nome lógico (`claude`), resolução só no `pty.spawn`. |
| Spawn/argv do agente (A) | `resolveSpawnCommand` + texto longo fora do argv + teste de tamanho. |
| Agentes via Git Bash (B, C, Q) | `MESS_CLI` POSIX, chave `PATH` normalizada, sem `SHELL=pwsh`, smoke via `bash.exe`. |
| Addons nativos | Runner Windows + Spectre libs + `electron-rebuild --force` + cache; **nunca `npm run package` na máquina de dev** (lição da ABI — §10.2). |
| SmartScreen/Defender | Assinar antes do 1º release público; Defender pode flagar `winpty-agent.exe`/Chrome headless — exclusão da pasta do repo. |
| Encoding/paste (H) | UTF-8 forçado + teste de `deliver` no ConPTY. |
| Órfãos (J) | Job Object; `taskkill /T` no fallback. |
| Suíte unitária vermelha no Windows (O) | `skipIf` cirúrgico nos casos `/proc`; contagem de testes Linux inalterada. |
| Hipótese refutada no meio da Fase 1 (ex.: ConPTY sem bracketed paste) | Fase 0 existe para isso; quem cair vira item isolado; a outra trilha não para. |

## Fora de escopo (por ora)
Tauri / GUI nativa · Windows Sandbox/Job Objects como *modo isolado* (o Job Object da Fase 4 é só ciclo de vida) · runtime híbrido no WSL.

## Prioridades (próximos passos, em ordem)
0. `.gitattributes` + renormalizar o checkout (K); instalar Node 22, Python, VS Build Tools; `npm ci` uma vez e ver o node-pty compilar.
1. Validar hipóteses A/B/E/H/N/Q/V com micro-scripts (meio dia).
2. `resolveSpawnCommand()` + texto longo fora do argv (A) + `binaryName()` (M).
3. Chave `PATH` + `MESS_CLI` POSIX/`.cmd` + `SHELL` (B, C, G, Q).
4. `resolveDataDir` unificado (D).
5. Named pipe sem `existsSync`/`chmod`/`unlink` (#6).
6. `killTree()` + fallback do desktop (#4, #5, J).
7. `findBrowser()` Windows (E).
8. Hooks/rotinas em `shellCommandArgs` (F).
9. Empacotamento NSIS em paralelo desde já (Fase 3, Trilha 2).
10. UTF-8/paste (H) · `O_NOFOLLOW`/caixa (P) · ACL (I) · assinatura · itens baixos.

---

## 9. Execução em 2 trilhas (agentes de IA na máquina Windows)

> Substitui o modelo de 7 papéis/ondas da rev. 4 (resumo histórico em §12). Duas trilhas de código em worktrees separados, um integrador (que pode ser a sessão da Trilha 1 em modo "integrar"), revisão cruzada opcional por Codex. Referências ao código são de `83c1234`.

### 9.1 Resumo

| Pergunta | Resposta |
|---|---|
| Quantas sessões | **2 trilhas de código** (uma sessão Claude Code cada, em worktree próprio) + **o humano** como integrador final. Opcional: uma sessão Codex de revisão entre as fases. |
| Por que 2 | O mapa de acoplamento da rev. 4 mostrou 4 "ilhas" de arquivos, mas três delas (spawn/PTY, ciclo de vida/I-O, `service.ts`+CLI) se encontram em `service.ts` e em `packages/domain` — dividi-las entre 3 agentes gerava mais rebase do que código. A quarta ilha (empacotamento/CI/desktop main) é disjunta de verdade e tem o maior risco de infra: merece uma trilha só dela, desde o dia 1. |
| Trilha 1 — Núcleo | runtime + CLI + domain + contracts: itens **#1, #2, #3, #5 (runtime), #6, A, B, C, D (lado runtime), E, F, G, H, M, O, P, Q, S, T** e os Baixo do runtime/CLI. Branch `win/core`. |
| Trilha 2 — Empacotamento/CI/Desktop | `scripts/package.mjs`, `apps/desktop/package.json`, `.github/workflows/*`, `apps/desktop/src/main/index.ts`, `abrir.ps1`, `README`: itens **L, #4, #5 (`pidOnPort` do desktop), D (lado desktop), J, N (desktop), R, #7**, Fase 2, Fase 3, Fase 5, Fase 6. Branch `win/package`. |
| Ordem de merge | `win/core` → `windows_version` primeiro (Fase 1 verde), depois `win/package` rebaseado. Antes disso a Trilha 2 pode validar o `.exe` com o runtime ainda Linux-only (o instalador abre; o terminal falha — isso é esperado e é o que o smoke da Fase 2 vai medir). |
| Relógio | **8–12 dias úteis** (12–21 dias-pessoa). Caminho crítico: `Fase 3 (.exe no CI) → merge de win/core → smoke no .exe real → A/H → assinatura → pré-release`. |

### 9.2 Propriedade de arquivos

| Trilha | Worktree / branch | **Pode editar** | **Não edita** |
|---|---|---|---|
| **T1 Núcleo** | `..\MessAI-wt\core` → `win/core` | `apps/runtime/src/**` (inclui novos `platform.ts`, `killtree.ts` e testes), `apps/cli/**`, `packages/domain/src/**`, `packages/contracts/src/index.ts` (só `AGENT_ENV`, aditivo), `skills/*/SKILL.md`, testes unitários em `packages/apps`, `tests/integration/*.win.test.ts` (novos) | `apps/desktop/**`, `scripts/**`, `.github/**`, `tests/e2e/**` |
| **T2 Empacotamento** | `..\MessAI-wt\package` → `win/package` — **único worktree onde `npm run package`/`electron-rebuild` podem rodar** | `scripts/package.mjs`, novo `scripts/smoke-windows.mjs`, `apps/desktop/package.json` (bloco `build` e devDeps de build), `apps/desktop/src/main/index.ts`, `apps/desktop/build/**`, `.github/workflows/*.yml`, `tests/e2e/**` (helper de boot), `abrir.ps1`, `README.md` | `apps/runtime/**`, `apps/cli/**`, `packages/**`, `skills/**` |
| **Integrador** (humano, ou T1 em modo integrar) | raiz `C:\Users\ctscs\Documents\MessAI` em `windows_version` | `.gitattributes`, `plan.md` (caixinhas e hipóteses), `PROGRESS-windows.md`, resolução de conflitos | código de produto |

Regra: se um arquivo não está na sua coluna, você não edita — deixa `TODO(trilha:T2): …` no commit e registra no `PROGRESS-windows.md`. Exceção combinada: T2 precisa de `killTree`/`pidOnPort` (contrato §9.4) — T1 os cria em `apps/runtime/src/killtree.ts`; até o merge, T2 usa `taskkill` inline em `desktop/main` e troca pelo helper depois (o desktop não importa o runtime, então pode até ficar inline).

### 9.3 Worktrees, branches, ciclo

```powershell
# na raiz do repo (branch windows_version), depois de K (§10.2)
git config core.autocrlf false
git config core.longpaths true
git worktree add ..\MessAI-wt\core    -b win/core    windows_version
git worktree add ..\MessAI-wt\package -b win/package windows_version
# npm ci em SÉRIE (node-pty compila com MSVC em cada um; dois ao mesmo tempo travam a máquina):
foreach ($w in "core","package") { Push-Location ..\MessAI-wt\$w; $env:JOBS="4"; npm ci; Pop-Location }
```

- Um worktree por trilha; `node_modules` separado em cada um (junction compartilhada quebra o `tsc -b` incremental e o `electron-vite`). Exclusão do Defender é opcional e depende do aval do dono (§10.1).
- Cada trilha roda o runtime de teste com **porta e pasta de dados próprias**: T1 `MESS_PORT=47901 MESS_DATA_DIR=C:\mess-data\core`; T2 `MESS_PORT=47902 MESS_DATA_DIR=C:\mess-data\package`. A porta `47821` fixa colidiria (`config.ts:60`, `desktop/main:19`); o nome do pipe deriva do `dataDir` (#6).
- Início de toda sessão: `git fetch && git rebase origin/windows_version`, ler `plan.md` (caixinhas) e `PROGRESS-windows.md`. Rebase, não merge, em `win/*`.
- PR `win/* → windows_version` com `gh pr create --base windows_version --head win/core` por **lote coerente** (2–4 commits), corpo: itens cobertos, arquivos tocados, como testou (saídas reais). Merge com `gh pr merge --rebase` após os gates de §9.5.
- `windows_version` recebe push **só via merge de PR**. `main` é intocável.
- Comunicação entre trilhas: PR + `PROGRESS-windows.md` (tabela item × trilha × estado × hipótese confirmada/refutada). Nada de "mande mensagem para a outra sessão": o canal é o repositório.

### 9.4 Contrato mínimo entre as trilhas (combinar no dia 1, antes de codar)

T1 cria estes módulos cedo (podem nascer como stub que compila; o teste `it.todo` é o contrato). T2 só **consome** assinaturas; se faltar algo, pede por `TODO(trilha:T1)`.

```ts
// apps/runtime/src/platform.ts  (dono: T1)
export const IS_WIN = process.platform === "win32";
/** Nome real da chave PATH no env (Windows: "Path"), ou "PATH" se não existir. */
export function pathKey(env: NodeJS.ProcessEnv): string;
/** Põe `dir` na frente do PATH preservando a chave existente (C). */
export function prependPath(env: Record<string, string>, dir: string): Record<string, string>;
/** PATHEXT em minúsculas, sempre com "" primeiro ([""] fora do Windows). */
export function pathExts(env: NodeJS.ProcessEnv): string[];
/** Comando real para CreateProcess/ConPTY (A): .exe direto; .cmd/.ps1 de pacote npm → ["node", "<cli.js>"]; fora do Windows devolve igual. */
export function resolveSpawnCommand(command: string, args: string[], env: NodeJS.ProcessEnv): { command: string; args: string[]; via: "direct" | "node-shim" | "cmd" };
/** Teto seguro de linha de comando no Windows (bytes). Teste falha se argv > isso. */
export const WIN_CMDLINE_BUDGET = 30_000;
/** Shell padrão (#3): MESS_SHELL > pwsh > powershell.exe > %COMSPEC%; fora do Windows mantém a cadeia atual (config.ts:31-35). */
export function resolveDefaultShell(env: NodeJS.ProcessEnv): string;
/** Como passar "rode este comando" (F): sh/bash → ["-c", cmd]; pwsh/powershell → ["-NoProfile","-NonInteractive","-Command", cmd]; cmd.exe → ["/d","/s","/c", cmd]. */
export function shellCommandArgs(shell: string, cmd: string): string[];
/** Caminho do socket/pipe (#6): Linux <dataDir>/agent.sock; Windows \\.\pipe\messai-<sha1(dataDir normalizado).slice(0,16)>. O CLI replica a regra (não importa o runtime). */
export function socketPathFor(dataDir: string): string;
/** Env do CLI para o agente (B): MESS_CLI em POSIX (/c/Users/...) para Git Bash; MESS_CLI_CMD = <cliDir>\mess.cmd para pwsh/cmd. */
export function cliEnv(cliDir: string): { MESS_CLI: string; MESS_CLI_CMD?: string };
/** Converte C:\a\b → /c/a/b (Git Bash/MSYS). */
export function toPosixPath(p: string): string;

// packages/domain/src/index.ts  (dono: T1)
/** Nome lógico do binário: tira diretório (/ e \) e sufixo .exe/.cmd/.bat/.ps1 (M). */
export function binaryName(command: string): string;

// apps/runtime/src/killtree.ts  (dono: T1; T2 pode manter cópia inline em desktop/main até o merge)
/** Mata a árvore a partir de pid. Linux: process.kill(-pid) → fallback pid. Windows: taskkill /PID pid /T /F (síncrono, timeout 5 s). Nunca lança. */
export function killTree(pid: number, signal?: "SIGTERM" | "SIGKILL"): void;
/** PID dono de uma porta TCP local: Linux /proc/net/tcp; Windows `netstat -ano` ou Get-NetTCPConnection. */
export function pidOnPort(port: number): number | undefined;
```

Cláusulas de texto:
1. **`AGENT_ENV.cliCmd = "MESS_CLI_CMD"`** em `contracts:955-976` (T1, aditivo, primeiro commit da trilha).
2. **Launchers** (T1 define em `apps/cli/bin/`; T2 replica em `package.mjs:31` para `resources/cli/`): `mess` (sh) com `dir=$(dirname "$0")` robusto a `\` (`cygpath -u "$0"` quando existir) e `exec "${MESS_ELECTRON:-node}" "$dir/cli.mjs" "$@"` com `ELECTRON_RUN_AS_NODE=1` quando `MESS_ELECTRON` estiver setado; `mess.cmd` com `@echo off`, `set ELECTRON_RUN_AS_NODE=1` condicional e `"%MESS_ELECTRON%" "%~dp0cli.mjs" %*` com fallback `node`. Teste: `mess.cmd --help` e `bash -c '"$MESS_CLI" --help'` imprimem o mesmo.
3. **Texto longo fora do argv** (T1): `applyRole`/`applySkills` ganham opção `{ inline: boolean }`; `service.ts:2074` passa `inline: !IS_WIN || cabe`, onde `cabe` é o teste contra `WIN_CMDLINE_BUDGET`. Papel/skills já vão por `MESS_ROLE_INSTRUCTIONS`/`MESS_SKILLS_TEXT` (`service.ts:2060-2061`). **Hipótese a validar na Fase 0**: se o Claude Code aceitar `--append-system-prompt-file`, a forma "arquivo" entra no contrato.

### 9.5 Gates

| Gate | Critério | Quem |
|---|---|---|
| Por PR | `npm run build` limpo **no Windows**; `npx vitest run packages apps` verde no Windows; CI `ubuntu-latest` verde (dispara por `pull_request`); diff só com arquivos da coluna da trilha; commits pt-BR, 1 item por commit, citando o ID, **sem `Co-Authored-By`**; caixinhas do `plan.md` atualizadas no mesmo PR (ou no `PROGRESS-windows.md`) | autor + CI; revisão cruzada por Codex opcional (`gh pr review`) |
| Fim da Fase 1 (T1) | tudo da Fase 1 marcado; smoke dev-mode de §10.3 passos 1–9 verdes na máquina; contagem de testes no `ubuntu-latest` igual à de antes | T1 + humano |
| Fim da Fase 3 (T2) | `.exe` NSIS gerado no CI (ou local em `..\MessAI-wt\package`), instala, abre a janela; `cli.mjs --help` imprime | T2 + humano |
| Integração (merge T1 → depois T2) | `windows_version` com `npm run build` + `vitest run packages apps` verdes no Windows e no Linux; `.exe` do CI passa no smoke de §10.3 com o runtime empacotado (`MESS_RESOURCES`) | humano |
| Fim da Fase 2/4 | job `windows-latest` verde incluindo `scripts/smoke-windows.mjs`; e2e `pilot`/`prefs`/`portal` no runner; portal com Edge; `deliver` multilinha inteiro (H); `echo "diretório"` sem mojibake | T2 + T1 |
| Release (Fase 6) | instalador **assinado** sem SmartScreen; auto-update entre duas pré-releases; checklist manual de §10.4 Fase 6 | humano |

### 9.6 Riscos específicos de 2 trilhas

| # | Risco | Mitigação |
|---|---|---|
| 9.6.1 | `npm ci`/`electron-rebuild`/`electron-builder` concorrentes travam a máquina | `npm ci` em série; builds nativos só em `..\MessAI-wt\package` e avisados no `PROGRESS-windows.md`; `JOBS=4`; preferir o runner `windows-latest` para o pacote completo |
| 9.6.2 | ABI dos addons quebrada no dev (`electron-rebuild` recompila `node_modules/node-pty` para a ABI do Electron; o runtime dev com Node 22 passa a falhar com `NODE_MODULE_VERSION`) | `package.mjs:34-41` copia os addons para `apps/desktop/resources/node_modules` antes de recompilar — em tese não toca em `node_modules` raiz, mas a lição registrada diz que quebra. **`npm run package` é proibido fora de `..\MessAI-wt\package`**; se acontecer, `npm rebuild node-pty better-sqlite3` no worktree afetado |
| 9.6.3 | Dois processos no mesmo `node_modules` (EBUSY/EPERM: arquivo em uso por um Electron/runtime aberto) | Antes de `npm ci`/`rebuild`, matar runtime/app daquele worktree (`taskkill /IM electron.exe` só do próprio) |
| 9.6.4 | T2 bloqueada esperando `killTree` de T1 | Cópia inline em `desktop/main` (contrato §9.4); troca pelo helper após o merge |
| 9.6.5 | Hipótese refutada no meio | Fase 0 valida antes; se cair, o item vira PR isolada; a outra trilha não para |
| 9.6.6 | Sessão longa perde contexto e reimplementa algo já mergeado | Início de sessão: rebase + ler `plan.md`/`PROGRESS-windows.md`; commits pequenos permitem retomar |

### 9.7 Briefings (copiar e colar)

**T1 — Núcleo**
```
Você é a Trilha 1 (Núcleo: runtime, CLI, domain, contracts) do porte do MessAI para Windows. Trabalhe SOMENTE em C:\Users\ctscs\Documents\MessAI-wt\core (branch win/core, criada de windows_version). Leia plan.md (seções "Diagnóstico", "Fases", §9 e §10) antes de começar e, no início de cada sessão, rode `git fetch && git rebase origin/windows_version`.
Objetivo: o runtime sobe com named pipe, abre pwsh/claude/codex no ConPTY, o `mess` funciona dentro de pwsh e de Git Bash, e nada disso muda o comportamento no Linux.
Ordem: AGENT_ENV.cliCmd (contracts) → #2 → A + M → #3 + Q → #6 → #1 + B + G → C → D (runtime) → E → F → #5 (runtime) + N (runtime) → isolation/tmux off em win32 → P → O (testes unitários) → Baixo → H (depois da Fase 0 confirmar/refutar).
Arquivos permitidos: apps/runtime/src/**, apps/cli/**, packages/domain/src/**, packages/contracts/src/index.ts (só AGENT_ENV), skills/*/SKILL.md, tests/integration/*.win.test.ts. NÃO tocar em apps/desktop, scripts, .github, tests/e2e (Trilha 2).
Pronto = `npm run build` limpo; `npx vitest run packages apps` verde no Windows; teste novo por item; PR para windows_version com itens cobertos e como testou (saídas reais); caixinhas do plan.md marcadas. Runtime de teste: MESS_PORT=47901 MESS_DATA_DIR=C:\mess-data\core.
Regras: código Windows atrás de process.platform === "win32" (IS_WIN) ou em platform.ts; commits pequenos (1 item, citando o ID) em pt-BR, SEM Co-Authored-By; push só em win/core; nunca main; não refatorar o que o plano não pede; nunca npm run package/electron-rebuild; nunca npm ci enquanto o outro worktree estiver instalando; registrar no plan.md §11 toda hipótese confirmada/refutada.
```

**T2 — Empacotamento / CI / Desktop**
```
Você é a Trilha 2 (Empacotamento, CI, desktop main) do porte do MessAI para Windows. Trabalhe SOMENTE em C:\Users\ctscs\Documents\MessAI-wt\package (branch win/package). Este é o ÚNICO worktree onde `npm run package`, `electron-rebuild` e `electron-builder` podem rodar — avise no PROGRESS-windows.md antes de cada build nativo. Prefira validar no runner windows-latest do GitHub.
Objetivo: um MessAI-<versão>-x64.exe (NSIS, auto-update) sai do CI e instala; o CI Windows roda build + testes unitários; o desktop sobe e derruba o runtime sem órfãos.
Ordem: Fase 3 (build.win nsis; package.mjs sem --linux fixo + mess.cmd; package.yml windows-latest com @electron/rebuild) → #4 + N + D (lado desktop) + #5 pidOnPort (desktop/main) → Fase 2 (ci.yml windows-latest com vitest run packages apps; branches windows_version e win/**; scripts/smoke-windows.mjs; R: helper e2e com MESS_SHELL por plataforma) → Fase 5 abrir.ps1 → Fase 6 (assinatura atrás de `if: secrets`, pré-release, README WSL2).
Arquivos permitidos: scripts/**, apps/desktop/package.json (bloco build e devDeps de build), apps/desktop/src/main/index.ts, apps/desktop/build/**, .github/workflows/*.yml, tests/e2e/**, abrir.ps1, README.md. NÃO tocar em apps/runtime, apps/cli, packages, skills (Trilha 1).
Pronto = workflow verde no runner; artefato .exe baixável; instala e abre; `ELECTRON_RUN_AS_NODE=1 MessAI.exe resources\cli\cli.mjs --help` imprime; o launcher mess.cmd empacotado tem a mesma semântica do apps/cli/bin/mess.cmd (contrato §9.4). PR para windows_version com link do run do CI.
Regras: commits pt-BR citando o ID, SEM Co-Authored-By; push só em win/package; nunca main; o job linux de package.yml/ci.yml continua intocado em comportamento; JOBS=4 no node-gyp local; nunca tocar no node_modules do outro worktree; registrar hipóteses no plan.md §11.
```

---

## 10. Guia prático para os agentes executores (máquina Windows)

> Esta seção é para quem vai **executar** o plano na máquina Windows (`C:\Users\ctscs\Documents\MessAI`). Tudo que está marcado **hipótese** não foi verificado nessa máquina — confirme e registre em §11.

### 10.1 Requisitos: o que instalar (PowerShell como administrador onde indicado)

| Item | Versão | Por quê | Comando |
|---|---|---|---|
| Git for Windows | 2.56 (**já instalado**) | Git Bash é o que o Claude Code usa no Windows e o que executa `apps/cli/bin/mess` | `winget install -e --id Git.Git` (só se faltar). Depois: `git config --global core.autocrlf false`, `git config --global core.longpaths true` |
| Node.js | **22.x** (obrigatório: `engines` `>=22 <23`, `package.json:12`; Node 24 **não** serve) | runtime/CLI/dev; o Electron 45 embute o próprio Node para o pacote | Via gerenciador de versão (permite 22 mesmo com outro LTS instalado): `winget install -e --id Schniz.fnm` → `fnm install 22` → `fnm use 22` (ou `CoreyButler.NVMforWindows` → `nvm install 22` / `nvm use 22`). Conferir: `node -v` começa com `v22.` |
| npm | o que vem com o Node 22 (10.x) | `npm ci` do monorepo (workspaces) | `npm -v` |
| Python 3 | 3.10+ (3.12 recomendado) | `node-gyp` precisa (node-pty compila do fonte em todo `npm ci`) | `winget install -e --id Python.Python.3.12` |
| Visual Studio 2022 Build Tools | 17.x | compilar node-pty (ConPTY/winpty) e, no pacote, better-sqlite3 para a ABI do Electron | `winget install -e --id Microsoft.VisualStudio.2022.BuildTools --override "--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --add Microsoft.VisualStudio.Component.VC.Runtimes.x86.x64.Spectre"` — IDs do workload `VCTools` e da componente Spectre são os publicados pela Microsoft; que o node-pty 1.0.0 **exija** as libs Spectre é **hipótese** (é o erro clássico `MSB8040: Spectre-mitigated libraries are required`). Se o build falhar com isso, abra o Visual Studio Installer → Modificar → Componentes individuais → "MSVC v143 – VS 2022 C++ x64/x86 Spectre-mitigated libs (Latest)". |
| Windows SDK | vem com `--includeRecommended` | headers do ConPTY | — |
| PowerShell 7 | 7.4+ (**opcional**; a máquina só tem o 5.1) | shell padrão preferido; UTF-8 por padrão | `winget install -e --id Microsoft.PowerShell` |
| Windows Terminal | qualquer | uma aba por trilha | `winget install -e --id Microsoft.WindowsTerminal` |
| Claude Code | atual | preset `claude`; validar A/M/V | Instalador nativo: `irm https://claude.ai/install.ps1 \| iex` (gera `claude.exe` — **hipótese** sobre o caminho `%USERPROFILE%\.local\bin`). Alternativa que produz o shim `.cmd` do item A: `npm i -g @anthropic-ai/claude-code`. Instale **os dois** modos em momentos diferentes para testar A com `.exe` e com `.cmd`. |
| Codex CLI | atual | preset `codex`; validar G (PowerShell) | `npm i -g @openai/codex` (gera `codex.cmd`) |
| Chrome ou Edge | Edge já vem no Windows 11 | portais (E) | `winget install -e --id Google.Chrome` (opcional; Edge basta) |
| adb / scrcpy | **opcional** (Fase 4) | nós de dispositivo | `winget install -e --id Google.PlatformTools`; `winget install -e --id Genymobile.scrcpy` |
| GitHub CLI | 2.x | PRs e `gh pr merge --rebase` | `winget install -e --id GitHub.cli` → `gh auth login` |

Depois de instalar o VS Build Tools, **abra um terminal novo** (PATH).

**Exclusão do Defender — OPCIONAL, só com aval do dono da máquina.** Acelera `npm ci`/`tsc` e evita falso positivo no `winpty-agent.exe`, mas tira essas pastas da varredura em tempo real (qualquer coisa baixada pelo `npm ci` ou por um agente ali dentro deixa de ser examinada). Não aplicar por padrão; se aplicar, restringir às pastas do repo e remover ao fim do porte (`Remove-MpPreference -ExclusionPath ...`):
```powershell
Add-MpPreference -ExclusionPath "C:\Users\ctscs\Documents\MessAI", "C:\Users\ctscs\Documents\MessAI-wt", "C:\mess-data"
```

### 10.2 Preparação do repositório

**1. `.gitattributes` (item K)** — criar na raiz, commitar em `windows_version` **antes** de qualquer `npm ci`. Conteúdo exato:
```gitattributes
# Fim de linha: o repositório guarda LF; só .cmd/.bat nascem com CRLF (cmd.exe exige).
* text=auto eol=lf
*.sh        text eol=lf
*.mjs       text eol=lf
*.ts        text eol=lf
*.tsx       text eol=lf
*.json      text eol=lf
*.md        text eol=lf
*.yml       text eol=lf
apps/cli/bin/mess text eol=lf
*.cmd       text eol=crlf
*.bat       text eol=crlf
*.ps1       text eol=crlf
*.png       binary
*.ico       binary
*.sqlite    binary
```

**2. Renormalizar o checkout** (o working tree na máquina já está em CRLF):
```powershell
cd C:\Users\ctscs\Documents\MessAI
git switch windows_version
git config core.autocrlf false
git config core.longpaths true
git add --renormalize .
git status                      # esperado: NENHUM arquivo modificado (o índice já é LF; só o working tree estava CRLF)
# ATENÇÃO: o próximo comando DESCARTA alterações não commitadas. Só rode com `git status` limpo e com o .gitattributes JÁ commitado.
git rm --cached -r . -q ; git reset --hard   # reescreve o working tree com LF conforme .gitattributes
git ls-files --eol apps/cli/bin/mess scripts/package.mjs abrir.sh   # esperado: i/lf w/lf em todos
& "C:\Program Files\Git\bin\bash.exe" -c 'head -c 12 apps/cli/bin/mess | od -c'   # esperado: "#!/bin/sh\n" sem \r
```
Se `git status` mostrar arquivos modificados após o `--renormalize`, é porque o índice tinha CRLF em algum — commite isso junto com o `.gitattributes` (`chore(windows): .gitattributes e renormalização (K)`).

**3. Instalar dependências (uma vez por worktree, em série):**
```powershell
$env:JOBS = "4"
npm ci
```
Resultado esperado: `node-pty` compila com MSVC (dura 1–3 min; linhas `conpty.vcxproj`, `pty.vcxproj`, `winpty-agent`); `better-sqlite3` baixa prebuild para Node 22; `esbuild` baixa binário. Se falhar com `MSB8040` → Spectre libs (§10.1). Se falhar com `gyp ERR! find Python` → `npm config set python <caminho do python.exe>`. Se falhar com `Could not find any Visual Studio installation` → abra terminal novo ou `npm config set msvs_version 2022`.

**4. Garantir addons para o Node (não para o Electron):**
```powershell
npm rebuild node-pty better-sqlite3
node -e "require('node-pty'); require('better-sqlite3'); console.log('addons ok')"   # esperado: addons ok
```

**AVISO — ABI dos addons.** **Nunca rode `npm run package` nem `electron-rebuild` no worktree de desenvolvimento** (só em `..\MessAI-wt\package`, Trilha 2). O empacotamento recompila `node-pty`/`better-sqlite3` para a ABI do Electron 45 e o runtime em dev (Node 22) passa a falhar com `NODE_MODULE_VERSION … was compiled against a different Node.js version`. Conserto: `npm rebuild node-pty better-sqlite3` no worktree afetado.

### 10.3 Como testar no Windows (passo a passo)

Use PowerShell (5.1 ou 7). Substitua a porta/pasta pela da sua trilha (§9.3). Cada passo diz **esperado** e **se falhar**.

**1. Build**
```powershell
npm run build            # tsc -b
```
Esperado: sem saída de erro, `apps/runtime/dist/index.js` e `apps/cli/dist/index.js` existem. Se falhar: erro de tipo é regressão sua; erro `EPERM`/`EBUSY` em `dist` = runtime/app aberto usando o arquivo → feche (`taskkill /IM node.exe` só do seu worktree, ou feche o app).

**2. Testes unitários (sem integração)**
```powershell
npx vitest run packages apps
```
Esperado **antes** do item O: tudo verde exceto `apps/runtime/src/procs.test.ts` (`/proc`). Depois de O: tudo verde. `tests/integration` **não entra** (Linux-only). Se `better-sqlite3`/`node-pty` falharem ao carregar: §10.2 passo 4.

**3. Subir o runtime isolado**
```powershell
$env:MESS_DATA_DIR = "C:\mess-data\core"; $env:MESS_PORT = "47901"
# opcionais: MESS_SHELL (shell padrão), MESS_BROWSER (exe do navegador), MESS_ADB/MESS_EMULATOR/MESS_SCRCPY, MESS_COMPANION=0 (desliga Ollama), MESS_NODE (node usado pelo desktop em dev)
node apps\runtime\dist\index.js
```
Esperado: uma linha `messai-runtime machine=… http=http://127.0.0.1:47901 socket=\\.\pipe\messai-… data=C:\mess-data\core pid=…` (`apps/runtime/src/index.ts:68`). **Antes de #6** o `socket=` ainda será `C:\mess-data\core\agent.sock` e o `listen` falha/`chmodSync` lança → esse é o sintoma do item #6. Se o processo sair sem mensagem: veja `C:\mess-data\core\runtime.log` quando subido pelo app; no console direto o erro aparece no stderr.

**4. Health**
```powershell
$tok = (Get-Content "$env:MESS_DATA_DIR\runtime.token" -Raw).Trim()
Invoke-RestMethod -Uri "http://127.0.0.1:$env:MESS_PORT/v1/health" -Headers @{ authorization = "Bearer $tok" }
```
Esperado: `ok=True`, `protocolVersion`, `buildVersion`, `machineId` (`server.ts:105`). `401` → token errado/pasta errada (sintoma de D quando o desktop lê outra pasta). Sem resposta → runtime não subiu (passo 3).

**5. Presets e shell padrão**
```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:$env:MESS_PORT/v1/presets" -Headers @{ authorization = "Bearer $tok" } | Select-Object id, command
```
Esperado após #3: preset `shell` com `command` = caminho do `pwsh.exe` ou `powershell.exe` (antes: `/bin/bash`, sintoma de #3). `claude`/`codex`/`opencode`/`agy` com o nome lógico, **sem** `.cmd` (M).

**6. Abrir um terminal pela API e mandar um comando**
```powershell
$h = @{ authorization = "Bearer $tok"; "content-type" = "application/json" }
$ws = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$env:MESS_PORT/v1/workspaces" -Headers $h -Body (@{ name = "Smoke"; cwd = "C:\mess-data\core" } | ConvertTo-Json)
$n  = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$env:MESS_PORT/v1/workspaces/$($ws.workspaceId)/nodes" -Headers $h -Body (@{ expectedRevision = $ws.revision; kind = "terminal"; title = "T"; geometry = @{ x = 0; y = 0; w = 600; h = 300 } } | ConvertTo-Json -Depth 5)
$n.session.sessionId; $n.session.state
```
Esperado: `state` = `running` (com `pid`). `exited` imediato = spawn falhou (A/#3). A entrada vai pelo WebSocket `ws://127.0.0.1:<porta>/v1/ws?token=<tok>` com `{ "type": "attach", "sessionId": … }` e depois `{ "type": "input", "sessionId": …, "data": "…\r" }` (`server.ts:518,543`; exemplo em `tests/integration/shell.test.ts:33-34`). Em vez de escrever um cliente WS à mão, use o `scripts/smoke-windows.mjs` (Trilha 2) ou abra o app (passo 10) e digite no nó.

**7. `mess context` e `mess note write` de dentro do terminal (PowerShell)**
No terminal criado (via app ou WS), digite:
```powershell
mess context
mess note write "Smoke" "olá, diretório"
mess --help
```
Esperado: `mess context` imprime o espaço e o nó; a nota aparece ligada ao terminal; `--help` lista os comandos. `command not found`/`'mess' não é reconhecido` = `CLI_DIR` não entrou no `Path` (C) ou não existe `mess.cmd` (#1). `Fora de um terminal MessAI: a credencial (MESS_TOKEN) não chegou` (`apps/cli/src/index.ts:18`) = env não injetado. `ECONNREFUSED`/`ENOENT` no socket = #6 (`MESS_SOCKET` apontando para `agent.sock`).

**8. O mesmo via Git Bash** (é o que o Claude Code usa)
No terminal do MessAI (pwsh), entre no bash **herdando o env**:
```powershell
& "C:\Program Files\Git\bin\bash.exe" --noprofile --norc
```
e dentro dele:
```bash
echo "$MESS_CLI"            # esperado após B: /c/Users/.../apps/cli/bin/mess (POSIX), não C:\...
"$MESS_CLI" context         # esperado: mesma saída do passo 7
mess context                # esperado: também funciona (PATH com CLI_DIR)
echo "diretório ação"       # esperado: acentos corretos (H)
```
Se `"$MESS_CLI" context` der `No such file or directory` com `./dist/index.js` → B (dirname de caminho com `\`). Se a saída vier com `Ã£`/`??` → H (codepage); teste `chcp 65001` antes e registre.

**9. Deliver / bracketed paste (H) e acentos**
Com um terminal `claude` ou `codex` aberto e um segundo terminal `mess` ligado a ele: `mess ask <nome> 'linha 1
linha 2 com acentuação'` (multilinha). Esperado: o texto chega **inteiro** no campo do agente e é submetido pelo Enter atrasado (`sessions.ts:226-230`); o agente responde. Se chegar linha a linha ou sem submeter → H refutada: registrar em §11 e ajustar `deliver` (enviar por linha + `\r`).

**10. Desktop em dev**
```powershell
# com o runtime do passo 3 PARADO (o app sobe o seu próprio, com MESS_DATA_DIR/MESS_PORT do env)
$env:MESS_DATA_DIR = "C:\mess-data\core"; $env:MESS_PORT = "47901"
npm run desktop            # = npm run dev -w @messai/desktop = electron-vite dev
```
Esperado: janela do MessAI abre; no canto, versão do app; a pasta de dados mostrada em "Sobre"/Preferências é `C:\mess-data\core` (D); criar um nó terminal abre `pwsh` (#3); criar nó `claude` abre o Claude Code **sem** `ENOENT` e **sem** diálogo "trust this folder" (A, M, V); nota secreta ligada ao terminal aparece como `$env:NOME` dentro dele; portal abre uma página com Edge (E); "Encerrar tudo" não deixa `pwsh.exe`/`claude.exe`/`msedge.exe --headless` em `tasklist` (J, #5). Se a janela abrir mas o runtime não responder em 40 s: `C:\mess-data\core\runtime.log`. O desktop usa `node` do PATH em dev (`desktop/main:96`; mude com `MESS_NODE`).

**11. Pacote (só Trilha 2, só em `..\MessAI-wt\package`)**
`node scripts\package.mjs nsis` → `apps\desktop\release\MessAI-<versão>-x64.exe`. Instalar, abrir, repetir os passos 7–10 **com o runtime empacotado** (`MESS_RESOURCES` setado pelo app). Depois: `npm rebuild node-pty better-sqlite3` nesse worktree antes de voltar a rodar testes nele.

### 10.4 Checklist de aceite por fase (critérios objetivos)

**Fase 0**
- [ ] `node -v` = `v22.*`; `python --version` = 3.x; `cl.exe` acessível em terminal novo (ou `npm ci` compila o node-pty sem `MSB8040`).
- [ ] `.gitattributes` commitado; `git ls-files --eol` sem `w/crlf` em `*.sh`, `apps/cli/bin/mess`, `*.mjs`, `*.ts`.
- [ ] `npm ci` + `npm run build` + `npx vitest run packages apps` com apenas `procs.test.ts` vermelho (ou tudo verde se O já entrou).
- [ ] §11 com as hipóteses A, B, E, H, N, Q, V marcadas confirmada/refutada/parcial e evidência.

**Fase 1 (Trilha 1)**
- [ ] Runtime sobe com `socket=\\.\pipe\messai-…`; `/v1/health` responde; `mess context` responde em pwsh **e** em Git Bash.
- [ ] Preset `shell` abre pwsh/powershell; `claude` e `codex` abrem sem `ENOENT` (instalados por `npm i -g` **e** pelo instalador nativo).
- [ ] `agentKind("C:\\x\\claude.cmd")` = `claudeCode` (teste unitário); `--dangerously-skip-permissions` presente no argv do Claude recrutado.
- [ ] Linha de comando gerada para `claude` com papel + 3 skills ≤ 30 k bytes no Windows (teste).
- [ ] `isolation` na API devolve erro claro no Windows; `terminal.tmux` ausente de `features` mesmo com tmux do MSYS2 no PATH.
- [ ] `npx vitest run packages apps` verde no Windows; CI Linux verde; contagem de testes Linux inalterada.

**Fase 3 (Trilha 2)**
- [ ] `package.yml` com job `windows-latest` verde; artefato `MessAI-*-x64.exe` e `latest.yml` no release de teste.
- [ ] O `.exe` instala, abre, e `ELECTRON_RUN_AS_NODE=1 MessAI.exe resources\cli\cli.mjs --help` imprime a ajuda.
- [ ] `resources\cli\mess.cmd --help` e `bash -c '"$MESS_CLI" --help'` imprimem o mesmo.

**Fase 2**
- [ ] `ci.yml` com job `windows-latest` (`npm ci`, build, `npm rebuild`, `vitest run packages apps`) verde; dispara em push para `windows_version` e `win/**`.
- [ ] `scripts/smoke-windows.mjs` passa no runner: health → terminal pwsh → `mess context` → `mess note write` → bash.exe `"$MESS_CLI" context` → `deliver` multilinha → `echo "diretório"` íntegro no buffer.
- [ ] e2e `pilot`, `prefs`, `portal` verdes em `windows-latest` (helper de boot com `MESS_SHELL` por plataforma).

**Fase 4**
- [ ] Portal abre `https://example.com` com Edge via `--remote-debugging-pipe`; snapshot/screenshot funcionam.
- [ ] `mess ask` multilinha chega inteiro e submete no Claude e no Codex; sem mojibake em pt-BR.
- [ ] Pasta de dados em `D:\…` → aviso/ACL aplicada (`icacls` mostra só o usuário) — ou aviso na UI.
- [ ] Fechar o app com "Encerrar tudo" → `tasklist` sem `pwsh.exe`/`claude.exe`/`msedge.exe` do MessAI.

**Fase 5/6**
- [ ] `abrir.ps1` (ou `npm run desktop` documentado) sobe o app em dev.
- [ ] Instalador assinado: sem aviso SmartScreen numa máquina limpa; auto-update da pré-release N para N+1 completa.
- [ ] Rodada manual: instalar, espaço, terminal, nota, portal, recrutar Claude e Codex, nota secreta, auto-update — com desvios documentados.
- [ ] README com seção Windows (nativo) e WSL2.

### 10.5 Regras para os agentes executores

1. **Branch/worktree certos**: Trilha 1 em `..\MessAI-wt\core` (`win/core`), Trilha 2 em `..\MessAI-wt\package` (`win/package`). Nunca commitar em `main`; `windows_version` só recebe merge de PR.
2. **Não quebrar o Linux**: todo caminho novo atrás de `process.platform === "win32"` (`IS_WIN`) ou dentro de `apps/runtime/src/platform.ts`/`killtree.ts`. Nenhum `/bin/sh`, `chmod`, `kill(-pid)`, `existsSync` em pipe ou `split("/")` novo fora da camada platform. O CI `ubuntu-latest` tem que continuar verde com a mesma contagem de testes.
3. **Antes de commitar**: `npm run build` + `npx vitest run packages apps` no Windows. Teste novo por item (o teste é o contrato).
4. **Commits pequenos**, um item do plano por commit, mensagem em pt-BR citando o ID: `feat(windows): resolveSpawnCommand com PATHEXT (A)`, `fix(windows): named pipe sem existsSync/chmod (#6)`, `test(windows): binaryName com C:\x\claude.cmd (M)`. **Sem `Co-Authored-By`** (regra do dono do projeto).
5. **Diff mínimo**: sem refatoração, formatação ou renomeação não pedidas; `service.ts` recebe chamadas de uma linha aos helpers.
6. **Atualizar o plano**: ao concluir um item, marcar a caixinha `[x]` na seção "Fases" e registrar em §11 toda hipótese confirmada/refutada com a evidência (comando + saída). Fazer isso **no mesmo PR** do item.
7. **Nunca** `npm run package`/`electron-rebuild` fora de `..\MessAI-wt\package`; nunca `npm ci` em dois worktrees ao mesmo tempo; antes de `npm ci`/`rebuild`, fechar app/runtime daquele worktree.
8. **Não afirmar o que não observou**: visual (janela, bandeja, cores) fica "pendente de conferência humana"; saída de comando vai literal no PR.
9. **Porta e pasta próprias** (§9.3) para o runtime de teste; nunca a `47821`/`~/.messai` do usuário.

---

## 11. Hipóteses a validar na máquina Windows (registrar aqui: confirmada / refutada / parcial + evidência)

| ID | Hipótese | Como validar (fora do repo, em `C:\mess-qa\`) | Estado |
|---|---|---|---|
| A | `pty.spawn("claude")` falha com `ENOENT` quando só existe `claude.cmd`; `claude.exe` (instalador nativo) funciona direto; argumento multilinha de ~20 k com `% ^ & \| "` chega íntegro via `node <cli.js>` mas não via `.cmd`; `--append-system-prompt-file` existe? | script `node-pty` fora do repo (`npm i node-pty` em `C:\mess-qa`) spawnando `claude`, `claude.cmd`, `claude.exe`, `node <…\claude-code\cli.js>` com `--append-system-prompt <texto>`; `claude --help \| findstr system-prompt` | **parcial (2026-11-07)**: o instalador nativo gera `%USERPROFILE%\.local\bin\claude.exe` (**confirmado**, 345 MB); `claude --help` lista `--append-system-prompt[-file]` → **a forma "arquivo" existe** e entra no contrato (§9.4 cl. 3). **Spawn no ConPTY (node-pty 1.1.0, `C:\mess-qa\a.js`) — confirmada**: `pty.spawn("claude")` → `File not found` (node-pty não aplica PATHEXT); `pty.spawn("claude.exe")` → `2.1.319 (Claude Code)`; `"fakeagent"` com só `fakeagent.cmd` no PATH → `File not found`; `.cmd` por caminho completo com argv `linha1\nlinha2 % ^ & \| "q"` → chega só `"linha1` (**corrompe**, cortado na quebra de linha); `node <js>` com o mesmo argv → íntegro; `node <js>` com 20 016 chars multilinha → íntegro; 40 000 chars → `Cannot create process, error code: 206` (teto da linha de comando). Obs.: node-pty procura o executável no PATH do **processo pai**, não no `env` passado com chave `Path` — o `.exe` só foi achado porque `.local\bin` estava no PATH do pai (reforça C: resolver o caminho completo antes do `pty.spawn`). |
| B | `dirname 'C:\a\mess'` = `.` no Git Bash; `cygpath -u` resolve; `MESS_ELECTRON="C:\…\MessAI.exe"` funciona entre aspas | `bash.exe -c 'dirname "C:\a\mess"; cygpath -u "C:\a\mess"'` | **refutada (2026-11-07, Git 2.56)**: `dirname "C:\a\mess"` → `C:\a` (não `.`); o launcher atual `apps/cli/bin/mess` executado como `"C:\mess-qa\b2\bin\mess" x y` achou `../dist/index.js` e rodou (`B-ok [ 'x', 'y' ]`). `cygpath -u` → `/c/a/mess`. `"C:\Program Files\x\MessAI.exe"` entre aspas preservado. ⇒ `MESS_CLI` POSIX vira opcional (higiene), não bloqueante. |
| E | `msedge.exe --headless=new --remote-debugging-pipe --user-data-dir=<tmp> about:blank` responde `Target.getTargets` pelos fds 3/4 (JSON terminado em `\0`) | script Node com `spawn(..., { stdio: ["ignore","ignore","pipe","pipe","pipe"] })` | **confirmada (2026-11-07)**: `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` respondeu `{"id":1,"result":{"targetInfos":[…]}}` pelo fd 4 com `windowsHide: true`. Chrome também presente em `C:\Program Files\Google\Chrome\Application\chrome.exe`. |
| H | ConPTY entrega `\x1b[200~…\x1b[201~` + `\r` como um bloco no `pwsh` e no `claude`; `echo "diretório"` volta certo; `chcp 65001`/`[Console]::OutputEncoding` resolvem | script `node-pty` + `pwsh -NoProfile`; repetir com `claude` | **refutada no PowerShell 5.1 (2026-11-07, Windows 11 build 26200, node-pty 1.1.0)**: `powershell -NoProfile -Command 'echo "diretório ação"'` volta `diretório ação` correto **sem** forçar UTF-8 (o ConPTY já entrega UTF-8); `\x1b[200~echo "linha1 ção"\x1b[201~` + `\r` 600 ms depois no PSReadLine → executou como um bloco (`linha1 ção`). Pendente: repetir com `claude` e com `pwsh` 7 (não instalado). Ruído: ao matar o pty, o `conpty_console_list_agent.js` do node-pty imprime `Error: AttachConsole failed` no stderr — inofensivo, mas aparece no log do runtime. |
| N | `spawn(..., { detached: true })` de um app de console abre janela no Windows; `windowsHide: true` evita | `spawn("powershell.exe", ["-c","sleep 5"], { detached: true, stdio: "ignore" })` e observar | [ ] |
| Q | Claude Code no Windows ignora `SHELL=…\pwsh.exe` (ou quebra a detecção do Git Bash) | abrir `claude` com `SHELL` setado e rodar uma ferramenta Bash | [ ] |
| V | `~/.claude.json` → `projects["C:\\Users\\…"]` com `hasTrustDialogAccepted` evita o diálogo | recrutar Claude numa pasta nova; ver se o diálogo aparece; inspecionar a chave gravada pelo próprio Claude Code | [ ] |
| L0 | node-pty 1.0.0 compila com o VS 2022 atual | `npm ci` na máquina | **refutada (2026-11-07)**: com VS Build Tools 17 (MSVC 14.44.35207, Spectre instalado) + Windows SDK **10.0.26100**, `conpty.cc(127)`: `error C2065: 'PFNCREATEPSEUDOCONSOLE': identificador não declarado`. **Decisão do dono: node-pty → 1.1.0** (commit `build(windows): node-pty 1.0.0 -> 1.1.0 (L)`): traz `prebuilds/win32-x64/conpty.node` + `conpty.dll`/`OpenConsole.exe`, N-API (`node-addon-api` 7) no lugar de `nan` → `npm ci` no Windows em 27 s **sem compilar**; binário independe da ABI do Electron. No Linux continua compilando do fonte. Ambiente da máquina: rede com inspeção TLS → `npm ci`/node-gyp falham com `SELF_SIGNED_CERT_IN_CHAIN`; usar `NODE_OPTIONS=--use-system-ca` (Node 22 confia no repositório de certificados do Windows). E o shell do Claude Code exporta `NoDefaultCurrentDirectoryInExePath=1`, que impede o `GetCommitHash.bat` do winpty quando o node-pty compila do fonte — irrelevante com o prebuild. |
| L1 | runner `windows-latest` tem as Spectre libs; `electron-rebuild` do node-pty compila | primeiro run do job | **provavelmente irrelevante** para o node-pty após L0 (prebuild N-API); continua valendo para o better-sqlite3 se não houver prebuild Electron (L4). [ ] |
| L2 | `cmd.exe` resolve `"C:\…\node_modules\.bin\esbuild"` sem `.cmd` e o `--banner:js="…;…"` chega inteiro | `node scripts\package.mjs` no worktree `package` | [ ] |
| L3 | `MessAI.exe` com `ELECTRON_RUN_AS_NODE=1` escreve no console (binário GUI) | pós-build | [ ] |
| L4 | better-sqlite3 13 tem prebuild para Electron 45 (evita compilar) | log do `electron-rebuild` | [ ] |
| O | `agents.test.ts` passa no Windows mesmo com `fake-cli` sem extensão (X_OK não verifica execução) | `npx vitest run apps/runtime/src/agents.test.ts` | **refutada (2026-11-07)** — e o item O é maior que o previsto. `npx vitest run packages apps` no Windows: **4 falhas / 155 ok (159)**, em 3 arquivos: (1) `procs.test.ts` "lista o próprio processo com RSS > 0" (`/proc`, previsto); (2) `agents.test.ts` "whichOnPath … caminho absoluto precisa ser executável" — `expected 'C:\…\Temp\mes…' to be null` (sem `X_OK` real, arquivo não-executável é aceito); (3) `agents.test.ts` "extras em JSON" — o **teste** faz `e.file.split("/").pop()` e recebe o caminho inteiro com `\` (produto ok, teste não portável → usar `basename`); (4) `systemd.test.ts` — `expected '\home\x\.config\systemd\user\messai-r…' to be '/home/x/…'` (`join` em win32; systemd é Linux-only → `skipIf(win32)`). `third-party.test.ts` também falhou até regenerar os avisos após o upgrade do node-pty (já resolvido no commit). |
| P | `realpathSync` no Windows devolve caixa diferente da gravada → `isWithinCanonicalRoot` falso negativo | `node -e "console.log(require('fs').realpathSync('c:\\users'))"` | **confirmada (2026-11-07, Node 22.23.4)**: `realpathSync('c:\users')` → `c:\users` (mantém a caixa de entrada) mas `realpathSync.native` → `C:\Users` — as duas formas divergem; `fs.constants.O_NOFOLLOW` = `undefined`. |
| SIGUSR2 | `process.on("SIGUSR2")` não lança no Windows | `node -e "process.on('SIGUSR2',()=>{}); console.log('ok')"` | **confirmada (2026-11-07)**: imprime `ok`; `os.constants.signals.SIGUSR2` = `undefined`. Extra: `os.userInfo().shell` = `null` (#3). |
| Fase 6 | electron-builder 25.1.8 aceita `win.azureSignOptions` | doc/`electron-builder --help` ou build de teste | [ ] |

---

## 12. Nota histórica — modelo de 7 papéis (rev. 4)

A rev. 4 propunha 7 papéis (Orquestrador, A1 Spawn/PTY, A2 Ciclo de vida, A3 Service/CLI, A4 Empacotamento, Revisor Codex, QA) em 4 worktrees e 3 ondas, com 9–14 dias úteis de relógio. A rev. 5 concluiu, e a rev. 6 confirma, que três das quatro "ilhas" de código convergem em `service.ts` e `packages/domain` — dividi-las entre agentes gerava mais rebase do que código — e que a coordenação (contrato com stubs, propriedade por arquivo, integrações por onda) custava mais do que o paralelismo rendia. Ficou o que era bom: a trilha de empacotamento independente desde o dia 1, o contrato mínimo de `platform.ts`/`killtree.ts` (§9.4), a regra de propriedade por arquivo e os gates por PR. O detalhe do modelo antigo está em `git show 5b46fa6:plan.md`.
