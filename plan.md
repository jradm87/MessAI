# Plano — Porte do MessAI para Windows (`windows_version`)

> Branch: **`windows_version`** (da `main` em `841f02d` / v0.0.14). **Rev. 4** — rev. 3 (reavaliação + revisão crítica contra o código) + **plano de execução multi-agente** (seção final: 7 papéis, ondas, contrato, gates, briefings).
> Objetivo: instalador Windows (`.exe`) reaproveitando o código atual, sem reescrever o app.
> Convenção: toda referência a código é `arquivo:linha`; o que depende de máquina Windows real está marcado como **hipótese**.

## Decisão (ADR)
**Build nativo do Electron para Windows** (electron-builder **`nsis`**; `portable` opcional, ver Fase 3).

Por quê (verificado no código):
- Tudo que é pesado já roda em Node e tem suporte Windows: node-pty (ConPTY), better-sqlite3, Fastify (named pipe), electron-updater (NSIS).
- **Tauri** ainda precisaria do runtime Node como sidecar e da reimplementação do host do xterm/React Flow — mais trabalho, mesmo risco. Fica como otimização futura (binário/RAM-base).
- **Portais NÃO dependem do Electron:** cada portal é um **Chromium headless separado dirigido por CDP via pipe** (`apps/runtime/src/portal.ts:11-14,97-103`), não `BrowserView`. (A rev. 1/2 dizia o contrário — corrigido.)
- **GUI nativa Rust**: reescrita total → descartada.
- **WSL2 (AppImage + WSLg) = caminho suportado oficialmente**, não só "alternativa": é o único modo em que tmux, bubblewrap (modo isolado), hooks/rotinas em `sh` e a suíte de integração funcionam 100%. Ganha página de instalação enquanto o nativo amadurece. (Híbrido "`.exe` nativo + runtime no WSL" é possível via HTTP em localhost, mas é over-engineering agora.)
- **Segurança no Windows:** o named pipe não tem `chmod`; a autenticação fica no **Bearer** + credencial por terminal com escopo (`server.ts:38-55`, `service.ts:2054`). Decisão registrada.

## Degradações aceitas no Windows (feature-flags)
- **tmux** ausente → sem sessões duráveis / `--persist` (`tmuxAvailable()` já desliga).
- **bubblewrap** ausente → sem modo isolado. A API deve **rejeitar** `isolation` no Windows (hoje cai em `/bin/sh` e o terminal nasce "exited" sem mensagem — `isolation.ts:51`, `service.ts:2074`).
- **Monitor de processos (#80)**: v1 só raiz/memória (sem `/proc`) ou oculto.
- **Hooks e rotinas** rodam em **PowerShell** no Windows (decisão de produto; documentar).
- Shell padrão: `MESS_SHELL` > `pwsh` > `powershell.exe` > `%COMSPEC%`.

---

## Diagnóstico consolidado (o que quebra no Windows)

### Bloqueantes
| ID | Problema | Evidência | Correção |
|---|---|---|---|
| A | **Spawn do agente no ConPTY**: `pty.spawn("claude", …)` → `CreateProcess` não resolve `.cmd` (instalação via `npm i -g` gera `claude.cmd`/`codex.cmd`) → `ENOENT`. E o `--append-system-prompt` multilinha gigante (hint + papel + skills) vai num único argv: via shim `.cmd` quebras de linha e `% ^ & \| "` corrompem o argumento, e a linha tem teto de 32 767 chars. | `sessions.ts:79-85`, `presets.ts:9,17`, `node-pty/lib/windowsPtyAgent.js:76,257-300`, `domain/index.ts:290-308`, `contracts:973` | `resolveSpawnCommand()` com `PATHEXT` aplicado ao `plan.command` (preferir `.exe`; se `.cmd`, chamar `node <cli.js>` do pacote). **Tirar texto longo do argv no Windows**: papel/skills/hint por `MESS_ROLE_INSTRUCTIONS`/`MESS_SKILLS_TEXT` (já existem, `contracts:962,965`) ou arquivo. Teste que falha se a linha gerada passar de ~30 k. |
| B | **`$MESS_CLI` com `\` quebra o launcher sh no Git Bash**: `dirname 'C:\a\mess'` = `.` → procura `./cli.mjs`. As skills/hint mandam usar `"$MESS_CLI"`. Hint usa `$MESS_CLI` **sem aspas** (quebra com espaços, até no Linux). | `service.ts:2063`, `package.mjs:31`, `apps/cli/bin/mess:2`, `presets.ts:9`, `skills/messai-manager/SKILL.md:9` | Exportar `MESS_CLI` em forma POSIX (`/c/Users/...`) para o Git Bash **e** `MESS_CLI_CMD` (`mess.cmd`) para pwsh; launcher robusto a `\`; aspas no hint/skills. |
| 1 | CLI `mess` é `#!/bin/sh` (dev e pacote). | `apps/cli/bin/mess:1-2`, `package.mjs:31` | Gerar `mess.cmd` e manter o `sh` (Claude Code no Windows executa via Git Bash). |
| 2 | `whichOnPath` ignora `PATHEXT` e `X_OK`; `includes("/")` não reconhece `\`. É só a **sonda** de disponibilidade (ver A). | `providers.ts:18-27`; usado em `portal.ts:21`, `device.ts:18,24,30`, `isolation.ts:12,67,73` | `PATHEXT` + sem `X_OK` no Windows + reconhecer `\`. |
| 6 | Socket unix `agent.sock` + `chmod`/`unlink`; `existsSync` num named pipe **abre uma conexão cliente** (efeito colateral). | `config.ts:58`, `runtime/index.ts:32,46,62,65-66`, `cli/index.ts:12-13,22` | Pipe `\\.\pipe\messai-<hash(dataDir)>`; pular `chmod`/`unlink`/`existsSync` no Windows; `defaultSocket()` do CLI com `USERPROFILE`. |

### Alto
| ID | Problema | Evidência | Correção |
|---|---|---|---|
| C | Chave **`PATH` vs `Path`**: copia `process.env` (`Path`) e grava `PATH` → duas chaves; `CLI_DIR` pode nunca entrar no PATH do terminal. | `service.ts:2047-2048`, `:1536-1537` | Normalizar a chave existente (case-insensitive). |
| D | **Pasta de dados diverge**: desktop aceita ponteiro só se `startsWith("/")`; runtime aceita `isAbsolute`. Com `D:\MessAI`, desktop lê token no lugar errado → health falha → loop de restart. | `desktop/main/index.ts:15` vs `runtime/src/data.ts:20`, `index.ts:82-108` | Unificar com `isAbsolute`. |
| E | **`findBrowser()` só conhece binários Linux**; Chrome/Edge não ficam no PATH no Windows → portais não funcionam. | `portal.ts:18-23` | Caminhos padrão de `msedge.exe` (presente em todo Win10/11) e `chrome.exe`; validar `--remote-debugging-pipe` (**hipótese**: funciona, é o que o Puppeteer usa). |
| 3 | `resolveDefaultShell` → `$SHELL`/`/bin/bash`. | `config.ts:30-35` | Cadeia pwsh → powershell → `%COMSPEC%`. |
| 4 | Desktop sobe runtime com `detached: true` → console; fallback `process.kill(pid,"SIGTERM")` vira `TerminateProcess` e o handler `SIGTERM` do runtime nunca roda (sem `shutdownAll()`). | `desktop/main/index.ts:101,75-76`, `runtime/index.ts:71` | `detached` só fora do Windows + `windowsHide: true`; fallback via `taskkill /T`. |
| 5 | `/proc`/`ps` no monitor e em `pidOnPort`; `process.kill(-pid)` (grupo) lança e é engolido → Chrome headless, emulador e hooks órfãos. *(Correção: não há `kill(-pid)` em `sessions.ts` — lá é `proc.kill()` do node-pty, que funciona.)* | `procs.ts:12-23`, `desktop/main/index.ts:46-54`, `service.ts:1626`, `device.ts:196,242`, `portal.ts:256` | `killTree(pid)` → `taskkill /PID <pid> /T /F`; degradar monitor. |

### Médio
| ID | Problema | Evidência | Correção |
|---|---|---|---|
| F | Rotinas com **`/bin/sh -c` fixo**; hooks com `<shell> -c` (pwsh aceita `-c`, `cmd` exige `/c`). | `service.ts:408`, `:1584`, `:1874` | Usar `defaultShell` com flag certa por shell; documentar "PowerShell no Windows". |
| G | Hint/skills ensinam sintaxe POSIX (`$MESS_CLI`, aspas simples). Codex no Windows usa PowerShell (`$env:MESS_CLI`). | `presets.ts:9`, `skills/*/SKILL.md` | Variante do hint por plataforma/shell, ou exigir Git Bash. |
| H | **Bracketed paste** (`\x1b[200~…`) no ConPTY depende da versão do Windows → briefing pode chegar solto/sem Enter (**hipótese**). **Encoding**: console em codepage OEM/1252 → mojibake em pt-BR. | `sessions.ts:226-230`, `:92`, `:171` | Testar `deliver` no ConPTY; forçar UTF-8 (`chcp 65001` / `[Console]::OutputEncoding`) no shell spawnado. |
| I | `0o600`/`chmod` são no-op no Windows; fora de `%USERPROFILE%` (ex.: `D:\MessAI`) o `runtime.token` (token mestre) fica legível por `Users`. | `config.ts:46-53`, `runtime/index.ts:67`, `data.ts:20,96-99`, `service.ts:1330-1334` | Ajustar ACL (`icacls`) ou avisar na UI ao mover a pasta de dados para fora do perfil. |
| J | Encerramento forçado/logoff deixa órfãos (claude.exe, pwsh, Chrome, emulador). | `desktop/main/index.ts:75-76` | Job Object (kill-on-close) amarrando filhos ao runtime; no mínimo `taskkill /T` também no fallback. |
| L | Empacotamento: `package.mjs:50` `--linux` fixo; desktop só tem target `linux`, sem `.ico`. **node-pty 1.0.0 não tem prebuild Windows** → compila do fonte e exige VS Build Tools **com libs Spectre-mitigated** (ponto clássico de falha). **`portable` não tem auto-update.** SmartScreen bloqueia instalador **e cada update** sem assinatura. | `package.mjs:31,50`, `apps/desktop/package.json:45-53`, `desktop/main/index.ts:317` | Ver Fase 3. |
| 7 | `abrir.sh` é bash (`ss`, `/proc`, `wmctrl`). | `abrir.sh:1` | `abrir.ps1` ou documentar `npm run dev`. |

### Baixo (fazer junto, custo mínimo)
- `process.on("SIGUSR2")` no main do Electron — guardar por plataforma (**hipótese**: pode lançar no Windows) — `desktop/main/index.ts:394`.
- Filtro de env de nota secreta é case-sensitive (`/^(PATH|SHELL)$/`, `MESS_`) → no Windows uma nota `path` sobrescreve o PATH — `service.ts:2034`.
- Preset `shell` persiste `command: defaultShell` no banco; backup importado do Linux traz `/bin/bash` — normalizar no boot — `presets.ts:16`.
- Ocultar opção systemd ("manter runtime vivo") no Windows — `systemd.ts`, `index.ts:87`.
- `HOME` inexistente no Windows (`cli/index.ts:12`); `expandHome` só trata `~/` (`domain:665`).
- `split("/").pop()` para nomes — cosmético — `service.ts:1955`, `TreeNode.tsx:54`, `PrefsAgents.tsx:167`.
- Já OK (verificado): `safeRelPath` trata `\` e drive (`domain:433-436`); `isWithinCanonicalRoot` normaliza `\` (`domain:444`); `COPYFILE_FICLONE`/`symlinkSync` degradam em `try/catch`.

---

## Fases (ordem final)

### Fase 0 — VM Windows + ferramentas (1 dia) ⟵ começar aqui
- [ ] VM **Windows 11** (imagem de avaliação Microsoft, 90 dias grátis).
- [ ] Instalar Node 22, Git for Windows, Claude Code, Codex, Chrome; VS Build Tools (C++ + **Spectre libs**).
- [ ] Validar hipóteses A, B, E, H na primeira semana.

### Fase 1 — Núcleo multiplataforma (runtime + CLI) (6–9 dias)
- [ ] `whichOnPath` com `PATHEXT`, sem `X_OK`, reconhecendo `\` (#2).
- [ ] **`resolveSpawnCommand()`** no spawn do PTY + **texto longo fora do argv** no Windows (A).
- [ ] Shell padrão Windows (#3).
- [ ] Named pipe (#6), pulando `chmod`/`unlink`/`existsSync`.
- [ ] Launcher `mess.cmd` + sh robusto a `\`; `MESS_CLI` POSIX + `MESS_CLI_CMD`; aspas no hint/skills (#1, B, G).
- [ ] Normalizar chave `PATH` (C).
- [ ] Unificar `resolveDataDir` desktop/runtime (D).
- [ ] `findBrowser()` com Edge/Chrome do Windows (E).
- [ ] Rotinas/hooks com `defaultShell` (F).
- [ ] `killTree()` + monitor degradado (#5); desktop `windowsHide` + fallback `taskkill` (#4).
- [ ] Rejeitar `isolation` no Windows.
- [ ] Itens "Baixo" (SIGUSR2, filtro case-insensitive, systemd, preset shell).
- [ ] **Testes unitários** (rodam no Linux e no `windows-latest`): `whichOnPath`+`PATHEXT`; `resolveSpawnCommand`; normalização `PATH`; nome do pipe; tamanho da linha de comando (papel+skills ≤ 30 k ou via env/arquivo); `resolveDataDir` com `C:\`.

### Fase 3 — Empacotamento Windows (2–4 dias) ⟵ **em paralelo à Fase 1**
> Antecipada: o `electron-rebuild` do node-pty no runner Windows é o risco de infra mais incerto e não depende do código do runtime. Um `.exe` cedo permite testar na VM.
- [ ] `apps/desktop/package.json`: target `win` → **`nsis`** (auto-update); `portable` só se aceitarmos "sem auto-update"; ícone `.ico`.
- [ ] `package.yml`: job `windows-latest` com `@electron/rebuild --force` (node-pty, better-sqlite3), cache, publish no mesmo release da tag (`latest.yml`).
- [ ] `package.mjs`: remover `--linux` fixo; gerar `mess.cmd` + `cli.mjs` em `resources/cli`; skills incluídas.
- [ ] Pós-build no CI: `MessAI.exe` com `ELECTRON_RUN_AS_NODE=1 resources\cli\cli.mjs --help` (validar stdout — **hipótese**: binário GUI pode não emitir no console).

### Fase 2 — CI Windows + smoke real (2–3 dias)
- [ ] Job `windows-latest` em `ci.yml`: `npm ci`, `npm run build`, `vitest run packages apps`.
- [ ] Smoke headless **pelo caminho real**: runtime → `/v1/health` → terminal **`pwsh -NoProfile`** executando `mess context` e `mess note write`; o mesmo via **Git Bash** (`C:\Program Files\Git\bin\bash.exe`, existe no runner) chamando `"$MESS_CLI" context`; `deliver` com `\r` chegando como uma linha; saída com acento (`echo "diretório"`) correta no buffer.
- [ ] e2e Playwright/Electron em `windows-latest` (há sessão gráfica): ao menos `pilot`, `prefs`, `portal`.
- [ ] `skipIf(win32)` nos testes que dependem de `sh -c`/`cat`/tmux/bwrap (≈43 arquivos de integração) — cobertura Linux inalterada.

### Fase 4 — Portais, dispositivos, paste/encoding (3–5 dias)
- [ ] Portais: CDP por pipe com Edge/Chrome no Windows.
- [ ] adb/emulator/scrcpy `.exe` + `ANDROID_SDK_ROOT`/`MESS_*`; documentar instalação.
- [ ] Bracketed paste e UTF-8 no ConPTY (H); ajustar `deliver` se preciso.
- [ ] ACL da pasta de dados fora do perfil (I); Job Object para órfãos (J).

### Fase 5 — Dev no Windows (0,5–1 dia)
- [ ] `abrir.ps1` (build + subir app) ou documentar `npm run dev`.

### Fase 6 — Release + teste manual (3–5 dias)
- [ ] **Assinatura de código** (Azure Trusted Signing é barato) **antes do primeiro release público** — SmartScreen bloqueia instalação e cada update.
- [ ] Tag de pré-release com Linux + Windows no mesmo release.
- [ ] Teste manual na VM **a cada fase** (não só no fim) + rodada final: instalar, espaço, terminal, nota, portal, recrutar agente (Claude e Codex), nota secreta, auto-update.
- [ ] Página de instalação do **WSL2** como caminho suportado.

## Estimativa
| Fase | Dias-pessoa |
|---|---|
| 0 — VM + ferramentas | 1 |
| 1 — Núcleo multiplataforma | 6–9 |
| 3 — Empacotamento (paralelo à 1) | 2–4 |
| 2 — CI + smoke real | 2–3 |
| 4 — Portais/dispositivos/encoding | 3–5 |
| 5 — Dev no Windows | 0,5–1 |
| 6 — Release + teste manual | 3–5 |
| **Total** | **17–28** |

## Riscos & mitigação
| Risco | Mitigação |
|---|---|
| Sem máquina Windows | VM desde a Fase 0; smoke pelo caminho real (PTY→shell→`mess`→pipe) no CI. CI não substitui a VM. |
| Spawn/argv do agente (A) | `resolveSpawnCommand` + texto longo fora do argv + teste de tamanho. |
| Agentes via Git Bash (B, C) | `MESS_CLI` POSIX, chave `PATH` normalizada, smoke via `bash.exe`. |
| Addons nativos | Runner Windows + Spectre libs + `electron-rebuild --force` + cache; **nunca `npm run package` na máquina de dev** (lição da ABI). |
| SmartScreen/Defender | Assinar antes do 1º release público; Defender pode flagar `winpty-agent.exe`/Chrome headless. |
| Encoding/paste (H) | UTF-8 forçado + teste de `deliver` no ConPTY. |
| Órfãos (J) | Job Object; `taskkill /T` no fallback. |

## Fora de escopo (por ora)
Tauri / GUI nativa · Windows Sandbox/Job Objects como *modo isolado* (o Job Object da Fase 4 é só ciclo de vida) · runtime híbrido no WSL.

## Prioridades (próximos passos, em ordem)
1. VM Windows 11 + ferramentas; validar hipóteses A/B/E/H.
2. `resolveSpawnCommand()` + texto longo fora do argv (A).
3. Chave `PATH` + `MESS_CLI` POSIX/`.cmd` + aspas no hint (B, C, G).
4. `resolveDataDir` unificado (D).
5. Named pipe sem `existsSync`/`chmod`/`unlink` (#6).
6. `killTree()` + fallback do desktop (#4, #5, J).
7. `findBrowser()` Windows (E).
8. Hooks/rotinas em `defaultShell` (F).
9. Empacotamento NSIS em paralelo desde já (Fase 3).
10. UTF-8/paste (H) · ACL (I) · assinatura · itens baixos.

---

## Execução multi-agente (100% IA numa máquina Windows)

> Como executar este plano com vários agentes de IA em paralelo (Orquestrador + sub-agents em worktrees). Referências ao código são do estado da branch em `074e34c`.

### 0. Resumo executivo

| Pergunta | Resposta |
|---|---|
| Quantos agentes | **7 papéis, no máximo 6 sessões vivas ao mesmo tempo** (1 Orquestrador + 4 trilhas de código + 1 Revisor Codex + 1 QA/Smoke que entra na Onda 0 como "validador de hipóteses" e volta na Onda 2) |
| Por que não mais | Os itens do plan.md se concentram em **4 conjuntos de arquivos disjuntos**; o quinto conjunto (`service.ts`) é serial por natureza. Mais agentes = mais rebase em `service.ts` e `packages/domain/src/index.ts`, e mais `tsc -b`/`vitest`/`node-gyp` disputando CPU |
| Por que não menos | Fase 3 (empacotamento/`electron-rebuild`) é independente e é a maior incerteza de infra — tem que começar no dia 1 em worktree próprio. `service.ts` precisa de um dono único. Spawn/PTY (A) e ciclo de vida/pipe (#6, #5, #4) não se tocam e são os dois maiores blocos de código |
| Ondas | **Onda 0** (preparo + validar hipóteses A/B/E/H + contrato) → **Onda 1** (Fase 1 em 3 trilhas + Fase 3 em paralelo) → **Onda 2** (integração, Fase 2 CI/smoke, Fase 4, skipIf) → **Onda 3** (Fase 5/6: assinatura, pré-release, teste manual) |
| Relógio de parede | **9–14 dias úteis** (vs. 17–28 dias-pessoa sequenciais); cenário agressivo 7–8 dias se as hipóteses A/E/H se confirmarem na Onda 0 e a assinatura (Azure Trusted Signing) for contratada no dia 1 |
| Caminho crítico | `Fase 3 (.exe no CI) → smoke no .exe real → A/H (spawn, paste, encoding) → assinatura → pré-release`. O código do `service.ts` (trilha A3) é o segundo caminho mais longo |

---

### 1. Mapa de acoplamento (evidência do código)

O que define paralelismo é **quem toca qual arquivo**. Levantamento por item do plan.md:

| Item | Arquivos que precisa tocar | Observação de acoplamento |
|---|---|---|
| **A** spawn no ConPTY + argv longo | `sessions.ts:84-90` (`pty.spawn(plan.command, …)`), `packages/domain/src/index.ts:290-310` (`applySkills`/`applyRole` concatenam no `--append-system-prompt`), `service.ts:2066-2068` (chama `applyRole`/`applySkills`/`planLocalTerminal`), `presets.ts:9,17` | Cruza 3 donos. Solução: `resolveSpawnCommand()` vive em módulo novo e é chamado em **`sessions.ts:84`** (não em `service.ts`); `applyRole`/`applySkills` ganham opção `{ inline: boolean }`; `service.ts` só passa a flag |
| **B** `MESS_CLI` POSIX + `MESS_CLI_CMD` | `service.ts:2063` (`[AGENT_ENV.cli]: join(CLI_DIR,"mess")`), `apps/cli/bin/mess:2`, `scripts/package.mjs:31`, `presets.ts:9` (hint), `skills/*/SKILL.md` (7 arquivos, já usam `"$MESS_CLI"` com aspas; só o hint não usa), `packages/contracts/src/index.ts:960` (novo `AGENT_ENV.cliCmd`) | `contracts` é importado por todos; adicionar uma chave em `AGENT_ENV` é aditivo e seguro, mas só **um** agente deve editar `contracts` |
| **C** `PATH` vs `Path` | `service.ts:1536-1537` (`hookEnv`) e `:2047-2048` (`plan`) | Mesmo padrão nos dois lugares; extrair `withCliOnPath(baseEnv, CLI_DIR)` |
| **D** pasta de dados | `apps/desktop/src/main/index.ts:15` (`startsWith("/")`) vs `apps/runtime/src/data.ts:20` (`isAbsolute`) | Desktop e runtime; o desktop não importa `data.ts` — basta `isAbsolute` do `node:path` |
| **E** `findBrowser()` | `portal.ts:18-23` | Depende de `whichOnPath` (#2) só para a sonda; os caminhos fixos de `msedge.exe`/`chrome.exe` são independentes |
| **F** rotinas/hooks shell | `service.ts:408` (`execFileP("/bin/sh",["-c",…])`), `:1584` (`spawn(defaultShell,["-c",cmd],{detached:true})`), `:1874` (teardown) | Só `service.ts` + helper `shellCommandArgs(shell, cmd)` em módulo novo |
| **G** hint/skills POSIX | `presets.ts:9`, `skills/*/SKILL.md:9-15` | Texto; zero acoplamento de código |
| **H** paste/UTF-8 | `sessions.ts:226-230` (bracketed paste), `:92` (`onData`); env do shell em `service.ts` `plan()` (ex.: `PYTHONIOENCODING`/`chcp`) | Depende de hipótese validada na Onda 0 |
| **I** ACL do token | `config.ts:46-53`, `data.ts:96-99`, `service.ts:1330-1334` (anexos `0o600`) | Baixo risco de conflito; `icacls` em helper |
| **J** órfãos / Job Object | `apps/desktop/src/main/index.ts:75-76`, `index.ts` do runtime (`shutdown`) | Job Object puro em Node não existe sem addon → ver risco §6 |
| **L** empacotamento | `scripts/package.mjs:31,50`, `apps/desktop/package.json:45-53`, `.github/workflows/package.yml`, `build/icon.ico` | Totalmente disjunto do runtime |
| **#1** `mess.cmd` | `apps/cli/bin/mess`, novo `apps/cli/bin/mess.cmd`, `package.mjs:31` | O launcher dev (A3) e o empacotado (A4) têm que ter a **mesma semântica** → contrato |
| **#2** `whichOnPath` | `providers.ts:18-27`; consumidores `portal.ts:21`, `device.ts:18,24,30`, `isolation.ts:12,67,73` | Mudança interna; assinatura mantida → não quebra ninguém |
| **#3** shell padrão | `config.ts:30-35` | Isolado |
| **#4** `detached`/`SIGTERM` | `apps/desktop/src/main/index.ts:75-76,101` | Isolado no desktop |
| **#5** `/proc`, `kill(-pid)` | `procs.ts:12-23`, `desktop/main/index.ts:46-54` (`pidOnPort`), `service.ts:1626` (`stopFloorHook`), `device.ts:196,242`, `portal.ts:256` | `killTree()` em módulo novo; 4 call-sites em 4 arquivos (3 donos diferentes) → contrato |
| **#6** named pipe | `config.ts:58`, `runtime/index.ts:32,46,62,65-66`, `cli/index.ts:12-13` | `socketPathFor(dataDir)` em módulo novo; CLI replica a regra (CLI não importa runtime) |
| **#7** `abrir.sh` | novo `abrir.ps1` | Isolado |
| Baixo | `desktop/main/index.ts:394` (SIGUSR2), `service.ts:2034` (filtro secreto), `presets.ts:16` (preset shell), `systemd.ts` + `desktop/main/index.ts:87`, `cli/index.ts:12` (`HOME`), `domain:665` (`expandHome`), `service.ts:1955` (`split("/")`) | Espalhado, mas cada um cai no dono natural do arquivo |

**Conclusão:** `service.ts` é tocado por B, C, F, #5, rejeição de `isolation`, 2 itens Baixo e indiretamente por A/H. Todos esses cabem num único agente **se os helpers forem extraídos para módulos novos** — aí o `service.ts` recebe apenas chamadas de uma linha, e o agente dono dele faz esses commits em ordem.

---

### 2. Agentes: quantidade, papéis, propriedade de arquivos

#### 2.1 Quantos e por quê

**7 papéis; 6 sessões concorrentes no pico (Onda 1); 4–5 na média.**

Justificativa por restrição:

1. **Conflitos de merge.** Há exatamente quatro "ilhas" de arquivos que podem avançar sem rebase entre si: (i) spawn/PTY/domínio puro, (ii) ciclo de vida + I/O (config/index/data/procs/portal/device + desktop main), (iii) `service.ts` + CLI + textos, (iv) empacotamento/CI. Um quinto agente de código só entraria em alguma dessas ilhas → conflito.
2. **Máquina.** Uma sessão do Claude Code/Codex ocupa ~0,5–1 GB; cada worktree precisa de `node_modules` próprio (~1,5 GB em disco, não RAM); `tsc -b` do monorepo pega ~1–2 GB por rodada; `electron-rebuild` do node-pty com MSVC e o `electron-builder` saturam todos os núcleos por 5–15 min. Com 32 GB/8+ núcleos, 6 sessões + 1 build nativo por vez cabem. Com 16 GB, reduzir a 4 sessões (ver §2.4).
3. **Caminho crítico.** Fase 3 não depende de código e é a maior incerteza → precisa de um agente dedicado desde o dia 1. Revisão cruzada por outra família de modelo (Codex) é o gate que mais barra regressão → agente próprio, não "mais um dev".

#### 2.2 Papéis e propriedade de arquivos (quem pode editar o quê)

| Agente | Modelo sugerido | Worktree / branch | **Arquivos que PODE editar** | Itens do plan.md |
|---|---|---|---|---|
| **O — Orquestrador/Integrador** | Claude Code (sessão principal, no repo raiz `koba` em `windows_version`) | `koba/` (raiz) | `windows-contract.md` (novo, na raiz), stubs iniciais de `apps/runtime/src/platform.ts`, `apps/runtime/src/killtree.ts`, `apps/runtime/src/platform.test.ts`, `apps/runtime/src/killtree.test.ts`, `.gitattributes`; **resolução de conflitos** em merges; `PROGRESS-windows.md` (status) | Fase 0 (setup), integração de todas as ondas, decisão de "pronto" junto com o humano |
| **A1 — Spawn/PTY/Domínio** | Claude Code | `../koba-wt/a1-spawn` → `wt/a1-spawn` | `apps/runtime/src/platform.ts` (após stub), `apps/runtime/src/platform.test.ts`, `apps/runtime/src/sessions.ts`, `apps/runtime/src/providers.ts`, `apps/runtime/src/isolation.ts`, `apps/runtime/src/presets.ts` (+ `presets.test.ts`), `packages/domain/src/index.ts` **somente** nas funções `applyRole`, `applySkills`, `skillsText`, `roleText`, `expandHome` (+ testes em `packages/domain`) | **#2, A, G (hint), Baixo: preset `shell` normalizado no boot, `expandHome` com `~\`; rejeição de `isolation` no Windows (lado `buildIsolatedPlan`/`probeIsolation`); H (Onda 2)** |
| **A2 — Ciclo de vida/I-O/Desktop main** | Claude Code | `../koba-wt/a2-lifecycle` → `wt/a2-lifecycle` | `apps/runtime/src/killtree.ts` (+ test), `apps/runtime/src/config.ts`, `apps/runtime/src/index.ts`, `apps/runtime/src/data.ts` (+ test), `apps/runtime/src/procs.ts` (+ test), `apps/runtime/src/portal.ts`, `apps/runtime/src/device.ts`, `apps/runtime/src/systemd.ts`, `apps/desktop/src/main/index.ts` | **#3, #6 (runtime), D (ambos os lados), #4, #5 (procs/portal/device/pidOnPort), E, Baixo: SIGUSR2, ocultar systemd; I e J (Onda 2); Fase 4 portais/dispositivos (Onda 2)** |
| **A3 — Service + CLI + textos** | Claude Code | `../koba-wt/a3-service` → `wt/a3-service` | `apps/runtime/src/service.ts` (**dono único**), `apps/cli/src/index.ts`, `apps/cli/bin/mess`, `apps/cli/bin/mess.cmd` (novo), `packages/contracts/src/index.ts` **somente** `AGENT_ENV` (aditivo), `skills/*/SKILL.md`, `tests/integration/*.test.ts` (só para `skipIf`, Onda 2) | **B, C, F, #1, #5 (call-site `service.ts:1626`), #6 (lado CLI: `defaultSocket`, `HOME`), rejeição de `isolation` na API (`service.ts:1939`, `:3003`, `:2074`), Baixo: filtro de secreto case-insensitive, `split("/")`; `skipIf(win32)` nos ~43 testes de integração (Onda 2)** |
| **A4 — Empacotamento/CI** | Claude Code (ou Codex — tarefa é de infra/YAML) | `../koba-wt/a4-package` → `wt/a4-package` — **único worktree onde `npm run package`/`electron-rebuild` podem rodar** | `scripts/package.mjs`, `apps/desktop/package.json` (bloco `build` e devDeps de build), `apps/desktop/build/icon.ico`, `.github/workflows/package.yml`, `.github/workflows/ci.yml`, novo `scripts/smoke-windows.mjs`, novo `abrir.ps1`, `README.md` (seção Windows/WSL2) | **L, Fase 3 inteira, Fase 2 (job CI + script de smoke), #7/Fase 5, Fase 6 (pipeline de assinatura + pré-release)** |
| **R — Revisor** | **Codex** (`codex` CLI, família diferente da que escreve) | `../koba-wt/review` → checkout da branch sob revisão (somente leitura) | **Nenhum arquivo do repo.** Escreve revisão via `gh pr review` (comentários inline) ou em `../koba-wt/review/REVIEW-<branch>.md` fora do repo | Revisa **toda** PR antes do merge; checa conformidade com `windows-contract.md` e com o mapa de propriedade |
| **QA — Validador/Smoke** | Codex (Onda 0 e 2–3) — pode ser a mesma sessão de R quando ociosa, mas com prompt distinto | `../koba-wt/qa` → checkout de `windows_version` integrado; **roda runtime com `MESS_PORT`/`MESS_DATA_DIR` próprios** | Scripts de prova em `../koba-qa/` (fora do repo); relatório `../koba-qa/REPORT-onda<N>.md`. Nada no repo | Onda 0: valida hipóteses A, B, E, H. Onda 2–3: smoke PTY → pwsh/Git Bash → `mess` → named pipe; e2e; checklist de teste manual (Fase 6) |

Regra de ouro: **se um arquivo não está na sua coluna, você não edita — pede ao dono via Orquestrador.** Para mudanças fora da coluna o agente comita um `TODO(owner:A2): …` na própria branch e avisa.

#### 2.3 Por que esta divisão e não outra

- **`service.ts` com dono único (A3)** e **helpers em módulos novos** (`platform.ts`, `killtree.ts`). Com isso, as alterações de B/C/F/#5/isolation no `service.ts` viram ~10 linhas em 6 pontos (`:408`, `:1536`, `:1584`, `:1626`, `:1874`, `:2034`, `:2047`, `:2063`, `:2074`) feitas por quem tem o arquivo inteiro em contexto.
- **`sessions.ts` com A1, não A3**: o `resolveSpawnCommand()` tem que acontecer no ponto do `pty.spawn` (`sessions.ts:84`), inclusive no reattach/respawn (`recoverPersistent`), senão o plano gravado no banco continua com `claude` sem `.cmd`.
- **`desktop/main/index.ts` com A2, não A4**: os itens do desktop main (D, #4, `pidOnPort`, SIGUSR2, J) são de ciclo de vida de processo — a mesma cabeça que faz `killTree`/named pipe. A4 fica só com empacotamento, que é lento, bloqueante e precisa de worktree isolado.
- **`packages/contracts` e `packages/domain` praticamente congelados**: só A3 adiciona chaves em `AGENT_ENV`; só A1 mexe em `applyRole`/`applySkills`/`expandHome`. Qualquer outra mudança nesses pacotes passa pelo Orquestrador (eles são importados por tudo e um conflito ali cascateia).

#### 2.4 Variante para máquina de 16 GB / 4 núcleos

4 sessões: **O**, **A1+A3 fundidos** (spawn + service + CLI; serial, mas é o mesmo agente), **A2**, **A4**. R e QA rodam **entre** ondas, não durante (o Codex revisa quando as trilhas estão paradas aguardando merge). Custo: +2–3 dias de relógio.

---

### 3. Ondas de paralelismo, grafo de dependências, caminho crítico

#### 3.1 Grafo de dependências entre itens

```
Onda 0 (preparo)
  CONTRATO ─────────────┬──────────────┬──────────────┬─────────────┐
  (platform.ts stub,    │              │              │             │
   killtree.ts stub,    ▼              ▼              ▼             ▼
   mess/mess.cmd spec) A1            A2             A3            A4
                      #2 ──► A       #3   #6   D   #1 ◄─(spec)─ Fase 3 (nsis, icon,
                      G(hint)        E ◄─(#2)       B ◄─(A1 opt)   package.mjs, package.yml)
                      preset shell   #5 killTree ──► #5 call-site   │
                      isolation(bwrap)   #4         C, F            │
                                         SIGUSR2    isolation(API)  │
                                         systemd    Baixo(secret,split)
                                                    CLI defaultSocket/HOME
         │               │               │              │           │
         ▼               ▼               ▼              ▼           ▼
Onda 1 → INTEGRAÇÃO 1 (ordem de merge: A2 → A1 → A3 → A4)  ──► Fase 1 "verde" (build + vitest win+linux)
         │
         ├─► Fase 2 (A4: job windows-latest em ci.yml + scripts/smoke-windows.mjs; QA roda smoke real)
         ├─► H (A1)  ◄── precisa do resultado da hipótese H (Onda 0) e do runtime integrado
         ├─► I, J (A2) · Fase 4 portais/adb (A2)
         ├─► skipIf(win32) (A3) · e2e Playwright win (A4/QA)
         ▼
Onda 2 → INTEGRAÇÃO 2 ──► .exe do CI instala e passa no smoke
         │
         ├─► Fase 5 abrir.ps1 (A4) · Fase 6 assinatura (A4 + humano) · pré-release (A4) · WSL2 doc (A4)
         ├─► teste manual (QA + humano) → bugs voltam aos donos
         ▼
Onda 3 → RELEASE
```

Dependências "duras" (precisa do merge do outro para **rodar**, não para compilar — os stubs garantem compilação):

| Depende | De | Por quê |
|---|---|---|
| A3 #5 (call-site `service.ts:1626`) | A2 `killTree()` | Assinatura no stub; comportamento só após merge de A2 |
| A3 C (`PATH` key) | A1 `platform.ts` (`pathKey(env)`) | Mesmo motivo |
| A2 E (`findBrowser`) | A1 #2 (`whichOnPath` com `PATHEXT`) | Para a sonda; os caminhos fixos de Edge/Chrome funcionam antes |
| A4 Fase 3 `package.mjs` launcher | A3 #1 (spec do `mess.cmd`) | Resolvido pelo contrato (texto dos dois launchers fixado na Onda 0) |
| Fase 2 smoke | Integração 1 | Precisa do pipe, do shell e do CLI funcionando juntos |
| H | Onda 0 (hipótese) + Integração 1 | Precisa de PTY real com `pwsh` e do `deliver` |
| Fase 6 assinatura | Conta Azure Trusted Signing (**humano**, lead time de dias) | Começar o cadastro no dia 1 |

#### 3.2 Ondas (o que roda junto)

**Onda 0 — Preparo e hipóteses (dia 1; 0,5–1 dia)**
- **O**: cria `.gitattributes` (`eol=lf` para `*.sh`, `apps/cli/bin/mess`, `*.mjs`), configura `core.autocrlf=false` e `core.longpaths=true`; cria os 4 worktrees; roda `npm ci` **um worktree por vez** (node-pty 1.0.0 compila do fonte no Windows — plan.md L; 4 compilações simultâneas travam a máquina); escreve `windows-contract.md` + stubs + testes `it.todo` (ver §4.3); abre `PROGRESS-windows.md`.
- **QA**: valida hipóteses com micro-scripts fora do repo: (A) `node-pty` spawn de `claude` vs `claude.cmd` vs `node <cli.js>` com argumento multilinha de 20 k; (B) `dirname 'C:\…'` no Git Bash e `MSYS_NO_PATHCONV`; (E) `msedge.exe --headless=new --remote-debugging-pipe` respondendo `Target.getTargets` por fds 3/4; (H) `\x1b[200~…\x1b[201~` no ConPTY com `pwsh` e com `claude`; encoding com `echo "diretório"`. Entrega `REPORT-onda0.md` com "confirmada/refutada/parcial" por hipótese.
- **A4**: começa Fase 3 imediatamente (não depende de nada): target `nsis`, `.ico`, `package.mjs` sem `--linux` fixo, job `windows-latest` em `package.yml` com `@electron/rebuild --force`; primeiro `.exe` no CI (ou local, no worktree dele).
- **A1/A2/A3**: começam só depois que o contrato está comitado em `windows_version` (meio-dia).

**Onda 1 — Fase 1 em 3 trilhas + Fase 3 (dias 2–5)**
- A1: #2 → A → G(hint) → preset shell → `expandHome` → `isolation` no `buildIsolatedPlan`.
- A2: `killTree()` **primeiro** (desbloqueia A3) → #6 → #3 → D → #4 → #5 (`procs.ts` degradado, `pidOnPort`, `portal.ts:256`, `device.ts:196,242`) → E → SIGUSR2 → ocultar systemd.
- A3: #1 (`mess.cmd` + launcher sh robusto a `\`) → B → C → F → #5 call-site → `isolation` na API → Baixo → CLI `defaultSocket`/`HOME` → aspas nas skills (G).
- A4: Fase 3 até ter `.exe` que abre, com pós-build `ELECTRON_RUN_AS_NODE=1 MessAI.exe resources\cli\cli.mjs --help`.
- R: revisa cada PR assim que abre (ver §5).
- **Integração 1** (O): ordem de merge **A2 → A1 → A3 → A4**. A3 faz `git rebase windows_version` depois de A2 e A1 entrarem (é quem tem mais call-sites). Gate da onda em §5.

**Onda 2 — Integração, CI real, Fase 4, skipIf (dias 5–9)**
- A4: job `windows-latest` em `ci.yml` (`npm ci`, `npm run build`, `vitest run packages apps`), `scripts/smoke-windows.mjs` (runtime → `/v1/health` → terminal `pwsh -NoProfile` rodando `mess context` e `mess note write` → o mesmo via `C:\Program Files\Git\bin\bash.exe` com `"$MESS_CLI" context` → `deliver` com `\r` → acento no buffer); e2e Playwright `pilot`, `prefs`, `portal` no runner.
- QA: executa o smoke na máquina real em **dev mode** (worktree `qa`) e no **`.exe` instalado** (Fase 3). Abre bugs por dono.
- A1: H (paste/UTF-8) conforme `REPORT-onda0.md`; ajuste do `deliver` (`sessions.ts:226-230`) se preciso.
- A2: I (ACL via `icacls` fora de `%USERPROFILE%` + aviso na UI → aviso vai por `settings`/`health`, UI é texto só), J (ver risco §6.7), Fase 4 portais (CDP por pipe com Edge) e adb/emulator `.exe`.
- A3: `skipIf(process.platform === "win32")` nos ~43 testes de integração que usam `sh -c`/`cat`/tmux/bwrap (`tests/integration/*.test.ts`, 43 arquivos batem no grep) — muitos arquivos, zero código de produção, baixo conflito.
- **Integração 2**: CI verde em `ubuntu-latest` **e** `windows-latest`; `.exe` do CI instala e passa no smoke do QA.

**Onda 3 — Release (dias 9–14)**
- A4: `abrir.ps1` (#7), pipeline de assinatura (Azure Trusted Signing: `signtool`/`AzureSignTool` no `package.yml`), tag de pré-release com Linux + Windows no mesmo release, página WSL2 no README.
- QA + humano: rodada manual do plan.md Fase 6 (instalar, espaço, terminal, nota, portal, recrutar Claude e Codex, nota secreta, auto-update entre duas versões assinadas). Visual = humano.
- A1/A2/A3: só correções nos arquivos próprios, uma PR por bug.

#### 3.3 Caminho crítico

1. **Fase 3 → `.exe` real** (A4; 2–4 dias, incerteza alta: Spectre libs, `electron-rebuild` do node-pty, Defender flagando `winpty-agent.exe`).
2. **Integração 1** (dia 4–5) — gargalo humano/O: 4 merges com revisão.
3. **Smoke no `.exe`** → descobre o que só aparece empacotado (ex.: `MESS_RESOURCES`, `MESS_ELECTRON` no launcher `.cmd`, `winpty-agent.exe` dentro do asar/unpacked).
4. **A + H** (spawn + paste/encoding) — o que de fato faz o produto "funcionar" no Windows; só termina depois do smoke.
5. **Assinatura** — lead time externo; se não começar no dia 1, vira o caminho crítico sozinha.

---

### 4. Mecânica de coordenação no Windows

#### 4.1 Worktrees e branches

```powershell
# Orquestrador, na raiz koba (branch windows_version)
git config core.autocrlf false
git config core.longpaths true
git worktree add ..\koba-wt\a1-spawn     -b wt/a1-spawn     windows_version
git worktree add ..\koba-wt\a2-lifecycle -b wt/a2-lifecycle windows_version
git worktree add ..\koba-wt\a3-service   -b wt/a3-service   windows_version
git worktree add ..\koba-wt\a4-package   -b wt/a4-package   windows_version
git worktree add ..\koba-wt\qa           windows_version --detach     # QA: só checkout
git worktree add ..\koba-wt\review       windows_version --detach     # R: só checkout
# npm ci em SÉRIE (node-pty compila com MSVC em cada um):
foreach ($w in "a1-spawn","a2-lifecycle","a3-service","a4-package","qa") { Push-Location ..\koba-wt\$w; $env:JOBS="4"; npm ci; Pop-Location }
```

- Um worktree por agente; `node_modules` separado em cada um (no Windows, junction compartilhada de `node_modules` quebra o `tsc -b` incremental e o `electron-vite`).
- **`main` é intocável.** Nenhum agente faz checkout, merge ou push em `main`. PRs sempre `wt/* → windows_version`.
- Excluir `..\koba*` do Windows Defender (varredura em tempo real deixa `npm ci`/`tsc` 2–3× mais lento e flaga `winpty-agent.exe`).
- Cada agente roda o runtime de teste com **porta e pasta de dados próprias** (`MESS_PORT=4790N`, `MESS_DATA_DIR=C:\mess-data\aN`) — o nome do pipe deriva do `dataDir` (#6), então não colidem; a porta HTTP `47821` fixa colidiria (`config.ts:60`, `desktop/main/index.ts:19`).

#### 4.2 Regras de commit e integração

- **Commits pequenos, um item do plan.md por commit** (ou menos), mensagem no padrão já usado no repo: `feat(windows): resolveSpawnCommand com PATHEXT (A)`, `fix(windows): named pipe sem existsSync/chmod (#6)`, `test(windows): …`. Em português. **Sem `Co-Authored-By`** (regra do dono do projeto).
- Cada agente faz `git fetch && git rebase origin/windows_version` **no início de cada sessão de trabalho** e antes de abrir PR. Rebase, não merge, nas branches `wt/*` (histórico linear facilita a revisão do Codex).
- PR aberta com `gh pr create --base windows_version --head wt/aN-…` com corpo: itens do plan.md cobertos, arquivos tocados, como testou. Uma PR por "lote coerente" (2–4 commits), não uma PR gigante no fim.
- Integração pelo Orquestrador: **`gh pr merge --rebase`** após (a) CI verde, (b) revisão do R aprovada, (c) checagem de propriedade (`git diff --name-only origin/windows_version...wt/x` contra a tabela §2.2). Ordem padrão de merge na Onda 1: **A2 → A1 → A3 → A4** (quem tem mais call-sites rebaseia por último).
- Conflito em `service.ts`: só A3 resolve (é o dono). Conflito em `domain`/`contracts`: O resolve com A1/A3 em chamada curta (mandar o diff aos dois, decidir, aplicar).
- Push só na própria branch `wt/*`. `windows_version` recebe push **só do Orquestrador** (via merge de PR).

#### 4.3 Contrato combinado na Onda 0 (`windows-contract.md` + stubs compiláveis)

O Orquestrador comita isto **antes** de A1/A2/A3 começarem. Os stubs compilam (`throw new Error("TODO")` ou implementação Linux-only) e os testes nascem como `it.todo` com o nome da regra — o teste é o contrato.

```ts
// apps/runtime/src/platform.ts  (dono final: A1)
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
/** Shell padrão (#3): MESS_SHELL > pwsh > powershell.exe > %COMSPEC%; fora do Windows mantém a cadeia atual. */
export function resolveDefaultShell(env: NodeJS.ProcessEnv): string;
/** Como passar "rode este comando" para o shell (F): sh/bash → ["-c", cmd]; pwsh/powershell → ["-NoProfile","-NonInteractive","-Command", cmd]; cmd.exe → ["/d","/s","/c", cmd]. */
export function shellCommandArgs(shell: string, cmd: string): string[];
/** Caminho do socket/pipe (#6): Linux <dataDir>/agent.sock; Windows \\.\pipe\messai-<sha1(dataDir normalizado).slice(0,16)>. */
export function socketPathFor(dataDir: string): string;
/** Env do CLI para o agente (B): MESS_CLI em POSIX (/c/Users/...) para Git Bash; MESS_CLI_CMD = <cliDir>\mess.cmd para pwsh/cmd. */
export function cliEnv(cliDir: string): { MESS_CLI: string; MESS_CLI_CMD?: string };
/** Converte C:\a\b → /c/a/b (Git Bash/MSYS). */
export function toPosixPath(p: string): string;

// apps/runtime/src/killtree.ts  (dono: A2)
/** Mata a árvore a partir de pid. Linux: process.kill(-pid) → fallback pid. Windows: taskkill /PID pid /T /F (sincrono, timeout 5 s). Nunca lança. */
export function killTree(pid: number, signal?: "SIGTERM" | "SIGKILL"): void;
/** PID dono de uma porta TCP local (desktop/#5): Linux /proc/net/tcp; Windows `netstat -ano` ou Get-NetTCPConnection. */
export function pidOnPort(port: number): number | undefined;
```

Mais três cláusulas de contrato (texto, não código):

1. **`AGENT_ENV.cliCmd = "MESS_CLI_CMD"`** adicionado em `packages/contracts/src/index.ts` (A3, aditivo, Onda 1 dia 1, PR separada e mergeada primeiro — A4 e A1 dependem do nome).
2. **Launchers** (A3 define em `apps/cli/bin/`, A4 replica em `package.mjs` para `resources/cli/`):
   - `mess` (sh): `#!/bin/sh` + `dir=$(dirname "$0")` robusto: se `$0` contiver `\`, converter via `cygpath -u "$0"` quando existir; `exec "${MESS_ELECTRON:-node}" "$dir/cli.mjs" "$@"` (pacote) / `.../dist/index.js` (dev), com `ELECTRON_RUN_AS_NODE=1` quando `MESS_ELECTRON` estiver setado.
   - `mess.cmd`: `@echo off` + `set ELECTRON_RUN_AS_NODE=1` condicional + `"%MESS_ELECTRON%" "%~dp0cli.mjs" %*` com fallback `node`. Teste: `mess.cmd --help` e `bash -c '"$MESS_CLI" --help'` devem imprimir o mesmo.
3. **Flag `inline` em `applyRole`/`applySkills`** (A1): `applyRole(command, args, role, { inline: boolean })` — `inline=false` não toca no argv (papel/skills já vão por `MESS_ROLE_INSTRUCTIONS`/`MESS_SKILLS_TEXT`, `service.ts:2058-2059`). `service.ts` passa `inline: !IS_WIN || ok`, onde `ok` = resultado de um teste de tamanho. **Hipótese a validar na Onda 0**: se o Claude Code aceitar `--append-system-prompt-file` (ou ler um arquivo via env), a forma "arquivo" entra no contrato; senão, no Windows só o hint curto vai no argv e o resto por env.

#### 4.4 Como lançar as sessões

- Uma **janela do Windows Terminal por agente**, cada aba já em `cd ..\koba-wt\<nome>`; `claude` (ou `codex`) é iniciado **dentro do worktree** para que o `cwd` e o contexto do projeto sejam os daquele worktree. Sessões de longa duração (dias) com `claude --resume` são mais estáveis do que sub-agents do tipo `Agent` dentro de uma única sessão (sub-agents dividem o orçamento de contexto da sessão-mãe e não sobrevivem a ela).
- O Orquestrador usa sub-agents (ferramenta `Agent`, curta duração) só para tarefas atômicas: checagem de propriedade, resumo de uma PR, disparar `gh pr review` pedindo revisão ao Codex, resolver um conflito.
- Comunicação entre agentes: pela **PR** (comentários) e pelo `PROGRESS-windows.md` (O atualiza; os outros leem no início da sessão). Nada de "mande mensagem para o A2" — o canal é o repositório. (Quando o porte estiver funcional, o próprio MessAI, com andares/worktrees e Maestro, pode orquestrar isto — é literalmente o produto — mas não antes.)

---

### 5. Gates de qualidade

#### 5.1 Por PR (todas as ondas)

| Gate | Comando / critério | Quem |
|---|---|---|
| Build limpo | `npm run build` (`tsc -b` estrito) no worktree do autor, **Windows** | autor |
| Unit | `npx vitest run packages apps` no Windows; novo teste por item (lista do plan.md Fase 1: `whichOnPath`+`PATHEXT`, `resolveSpawnCommand`, normalização `PATH`, nome do pipe, teto de argv ≤ 30 k, `resolveDataDir` com `C:\`) | autor |
| Linux não regride | CI `ubuntu-latest` (`ci.yml`) verde — a PR dispara via `pull_request` | CI |
| Propriedade | `git diff --name-only origin/windows_version...HEAD` só com arquivos da coluna do agente (ou `TODO(owner:…)` justificado) | O |
| Revisão cruzada | **Codex** (R) faz `codex` review da PR: contrato respeitado? `process.platform` guardado? nada de `/bin/sh` novo? `try/catch` engolindo erro em caminho Windows? Teste cobre o que o item diz? | R |
| Commit | mensagens pt-BR, sem `Co-Authored-By`, um item por commit | O |

#### 5.2 Por onda

**Gate da Onda 0** → `REPORT-onda0.md` com as 4 hipóteses marcadas; `windows-contract.md` + stubs mergeados; 5 worktrees com `npm ci` ok; `.gitattributes` com `eol=lf`.

**Gate da Onda 1 (Fase 1 + 3)** →
1. `windows_version` integrado: `npm run build` + `vitest run packages apps` verdes **no Windows e no Linux**.
2. Smoke dev-mode (QA, na máquina): `node apps/runtime/dist/index.js` sobe com pipe `\\.\pipe\messai-…`; app `npm run desktop` conecta; criar terminal preset **shell** abre `pwsh`; dentro dele `mess context` responde; terminal **claude** não cai em `ENOENT` (A); terminal **codex** idem; `"$MESS_CLI" context` dentro de `bash.exe` responde (B); nota secreta chega como env; "Encerrar tudo" não deixa `pwsh.exe`/`claude.exe` órfãos (`tasklist`).
3. `.exe` da Fase 3 gerado (CI ou local no worktree A4), instala, abre, e `ELECTRON_RUN_AS_NODE=1 MessAI.exe resources\cli\cli.mjs --help` imprime (hipótese do plan.md Fase 3).
4. R assinou a Integração 1 (revisão do diff integrado `windows_version@antes...depois`, não só PR a PR).

**Gate da Onda 2 (Fase 2 + 4)** → job `windows-latest` em `ci.yml` verde incluindo `scripts/smoke-windows.mjs`; e2e `pilot`/`prefs`/`portal` no runner; portal abre com Edge via CDP por pipe no `.exe` instalado; `deliver` de briefing multilinha chega inteiro e submete (H); `echo "diretório"` sem mojibake; `.exe` do CI passa no smoke do QA; ~43 integrações com `skipIf` e cobertura Linux inalterada (contagem de testes rodados no `ubuntu-latest` igual à de antes).

**Gate da Onda 3 (Fase 5 + 6)** → instalador **assinado** sem aviso de SmartScreen; auto-update de uma pré-release para a seguinte funciona; checklist manual da Fase 6 com todos os itens ✓ ou com desvio documentado; página WSL2 publicada.

#### 5.3 Quem decide "pronto"

- **Pronto da PR**: Orquestrador, com (a) CI, (b) aprovação do R, (c) propriedade ok. Nenhum agente mergeia a própria PR.
- **Pronto da onda**: Orquestrador propõe com o `REPORT-onda<N>.md` do QA; **o humano confirma** (é ele quem olha a tela — o plan.md marca o visual como "pendente de conferência humana", e `PROGRESS.md` já registra essa regra).
- **Pronto do release**: humano, após a rodada manual da Fase 6 e a assinatura.

---

### 6. Riscos específicos de multi-agente e mitigação

| # | Risco | Mitigação concreta |
|---|---|---|
| 6.1 | **Conflito em `service.ts`** (3336 linhas, 9 pontos tocados) | Dono único (A3); helpers em `platform.ts`/`killtree.ts`; A3 mergeia por último na Onda 1 e rebaseia antes; commits de 1 item para o Codex revisar |
| 6.2 | **Conflito em `packages/domain`/`contracts`** (importados por tudo) | Congelados exceto `applyRole`/`applySkills`/`expandHome` (A1) e `AGENT_ENV` (A3, PR aditiva mergeada no dia 1 da Onda 1) |
| 6.3 | **Agente diverge do contrato** (ex.: A2 implementa `killTree` assíncrona, A3 chama síncrona) | Stubs com assinatura fixa + testes `it.todo` nascem na Onda 0 e são o contrato; mudar assinatura exige PR no `windows-contract.md` aprovada por O; R checa conformidade a cada PR |
| 6.4 | **Builds nativos concorrentes travam a máquina** (`npm ci` com node-gyp do node-pty ×4, `electron-rebuild`, `electron-builder`) | `npm ci` em série na Onda 0; `electron-rebuild`/`npm run package` **só** no worktree `a4-package` e **só** com aviso prévio no `PROGRESS-windows.md` (os outros não rodam `vitest` naquela janela); `JOBS=4` no node-gyp; preferir o runner `windows-latest` para pacote completo e deixar a máquina local para dev |
| 6.5 | **ABI dos addons quebrada no dev** (`electron-rebuild` recompila `node_modules/node-pty` para a ABI do Electron; o runtime dev com Node 22 passa a falhar com `NODE_MODULE_VERSION`) | `package.mjs:34-40` copia os addons para `apps/desktop/resources/node_modules` antes de recompilar, então em tese não toca em `node_modules` raiz — mas a lição registrada no plan.md diz que quebra. Regra: **`npm run package` é proibido fora de `a4-package`**; se acontecer, `npm rebuild node-pty better-sqlite3` no worktree afetado. O checa `git diff` e `npm ls node-pty` no smoke |
| 6.6 | **Dois agentes no mesmo `node_modules`** (EBUSY/EPERM no Windows: arquivo em uso por um Electron/runtime aberto) | Um worktree = um `node_modules`; antes de `npm ci`/`rebuild`, matar runtime/app daquele worktree (`taskkill /IM electron.exe` só do próprio); nunca `npm i` na raiz `koba` durante a Onda 1 |
| 6.7 | **J (Job Object) não existe em Node puro** — precisa de addon nativo ou de `koffi`/FFI (mais um addon para a ABI do Electron) | Onda 2: implementar o "mínimo" do plan.md (`taskkill /T` no fallback e no `shutdown`, mais varredura de órfãos por pid-file ao subir); Job Object vira ADR separada se o smoke mostrar órfãos frequentes; **não** colocar no caminho crítico |
| 6.8 | **CRLF** quebra `#!/bin/sh` do `apps/cli/bin/mess` e o launcher gerado | `.gitattributes` com `eol=lf` para `*.sh`, `apps/cli/bin/mess`, `*.mjs`; `core.autocrlf=false` em todos os worktrees; teste do launcher no CI Windows via `bash.exe` |
| 6.9 | **Portas/pipes colidindo** entre runtimes de teste de agentes diferentes | `MESS_PORT` e `MESS_DATA_DIR` distintos por agente (§4.1); pipe hash do dataDir (#6) garante nomes diferentes |
| 6.10 | **Hipótese refutada no meio da Onda 1** (ex.: ConPTY não aceita bracketed paste) | Onda 0 existe para isso; se cair algo, O reescreve só o item no contrato e o dono ajusta — os outros não param |
| 6.11 | **Revisor da mesma família aprova viés** | R é **Codex**, não Claude; na Integração 1 e 2 a revisão é do diff integrado, não só das PRs |
| 6.12 | **Assinatura/SmartScreen** chega tarde | Cadastro Azure Trusted Signing no dia 1 (humano); A4 já deixa o passo de `signtool` no `package.yml` atrás de um `if: secrets.AZURE_…` |
| 6.13 | **Agentes "melhorando" fora do escopo** (refatoração do `service.ts` inteiro, mudar estilo de linhas longas) | Briefing explícito: "sem refatoração não pedida"; R rejeita PR com diff > o necessário; O mede `git diff --stat` |
| 6.14 | **Sessão longa perde contexto** e reimplementa algo já mergeado | Início de toda sessão: `git fetch && git rebase origin/windows_version`, ler `PROGRESS-windows.md` e `windows-contract.md`; commits pequenos permitem retomar de onde parou |

---

### 7. Briefings prontos (copiar e colar)

> Todos em pt-BR. Cada agente recebe o seu e mais o link do `plan.md` e do `windows-contract.md`. Substitua `<…>` conforme a máquina.

#### 7.1 Orquestrador (O)

```
Você é o ORQUESTRADOR/INTEGRADOR do porte do MessAI para Windows. Repo: C:\…\koba, branch windows_version. Plano: plan.md (rev. 4). Mapa de execução multi-agente: seção "Execução multi-agente" do plan.md. Você NÃO implementa itens do plano; você integra.

Responsabilidades:
1. Onda 0: .gitattributes (eol=lf em *.sh, apps/cli/bin/mess, *.mjs), core.autocrlf=false, core.longpaths=true; criar worktrees ..\koba-wt\{a1-spawn,a2-lifecycle,a3-service,a4-package,qa,review}; npm ci EM SÉRIE com JOBS=4; escrever windows-contract.md + stubs compiláveis apps/runtime/src/platform.ts e killtree.ts + testes it.todo (assinaturas em plan.md, seção "Execução multi-agente" §4.3); abrir PROGRESS-windows.md. Commitar tudo isso em windows_version antes de liberar A1/A2/A3.
2. A cada PR wt/* → windows_version: checar CI verde, revisão do Codex (R) aprovada, e que `git diff --name-only origin/windows_version...<branch>` só contém arquivos da coluna do autor (tabela §2.2). Mergear com `gh pr merge --rebase`. Ordem de merge na Onda 1: A2 → A1 → A3 → A4.
3. Resolver conflitos só em packages/domain e packages/contracts (chamando A1/A3). Conflito em service.ts é do A3.
4. Manter PROGRESS-windows.md: por agente, itens feitos/em curso/bloqueios; avisar janelas de build nativo (A4).
5. Fechar onda: pedir REPORT ao QA, consolidar, propor "pronto" ao humano. O humano decide.

Regras: nunca tocar em main; push em windows_version só via merge de PR; commits em pt-BR sem Co-Authored-By; nunca rodar npm run package ou electron-rebuild fora de ..\koba-wt\a4-package; nunca rodar npm ci em dois worktrees ao mesmo tempo.
```

#### 7.2 A1 — Spawn/PTY/Domínio

```
Você é o agente A1 (Spawn/PTY/Domínio) do porte do MessAI para Windows. Trabalhe SOMENTE em C:\…\koba-wt\a1-spawn (branch wt/a1-spawn, criada de windows_version). Leia plan.md e windows-contract.md antes de começar e no início de cada sessão rode `git fetch && git rebase origin/windows_version`.

Objetivo: o terminal do MessAI consegue abrir claude/codex no ConPTY e o texto longo não vai no argv.
Itens do plan.md (nesta ordem): #2 (whichOnPath com PATHEXT, sem X_OK, reconhecer `\`, providers.ts:18-27) → A (resolveSpawnCommand em platform.ts, chamado em sessions.ts:84 no pty.spawn — vale também no reattach/respawn; applyRole/applySkills com opção {inline} em packages/domain/src/index.ts:290-310; teste que falha se argv > WIN_CMDLINE_BUDGET) → G (presets.ts:9: `"$MESS_CLI"` com aspas no hint; variante curta do hint no Windows) → Baixo: preset `shell` normalizado no boot (presets.ts:16), expandHome com `~\` (domain:665) → rejeição de isolation no Windows em isolation.ts (probeIsolation devolve available=false com razão clara; buildIsolatedPlan nunca cai em /bin/sh no Windows). Onda 2: H (sessions.ts:226-230 bracketed paste; UTF-8 no shell spawnado) conforme REPORT-onda0.md.

Arquivos permitidos: apps/runtime/src/platform.ts (+ platform.test.ts), sessions.ts, providers.ts, isolation.ts, presets.ts (+ presets.test.ts), packages/domain/src/index.ts SÓ em applyRole/applySkills/roleText/skillsText/expandHome (+ testes do domain). Qualquer outro arquivo: comite um `TODO(owner:AX): …` e avise na PR.

Pronto = `npm run build` limpo; `npx vitest run packages apps` verde no Windows; teste novo por item; PR para windows_version com itens cobertos e como testou; revisão do Codex aprovada. Testes manuais: MESS_PORT=47901 MESS_DATA_DIR=C:\mess-data\a1.

Regras: commits pequenos (1 item), mensagem pt-BR `feat(windows): …`, SEM Co-Authored-By; push só em wt/a1-spawn; nunca mexer em main; não refatorar o que o plano não pede; não rodar npm run package/electron-rebuild; não rodar npm ci enquanto outro worktree estiver instalando.
```

#### 7.3 A2 — Ciclo de vida / I-O / Desktop main

```
Você é o agente A2 (Ciclo de vida, I/O, desktop main) do porte do MessAI para Windows. Trabalhe SOMENTE em C:\…\koba-wt\a2-lifecycle (branch wt/a2-lifecycle). Leia plan.md e windows-contract.md; no início de cada sessão `git fetch && git rebase origin/windows_version`.

Objetivo: runtime sobe com named pipe, shell padrão certo, pasta de dados unificada, e nada fica órfão.
Itens (nesta ordem — killTree primeiro porque A3 depende): killtree.ts (killTree + pidOnPort conforme contrato) → #6 (config.ts:58 socketPathFor; runtime/index.ts:32,46,62,65-66 pular existsSync/unlink/chmod no Windows) → #3 (config.ts:30-35: MESS_SHELL > pwsh > powershell.exe > %COMSPEC% via platform.resolveDefaultShell) → D (desktop/main/index.ts:15 usar isAbsolute; data.ts:20 já ok) → #4 (desktop/main/index.ts:101 detached só fora do Windows + windowsHide; :75-76 fallback via killTree/taskkill) → #5 (procs.ts:12-23 degradar: no Windows devolver só a raiz, via `tasklist`/wmic opcional; desktop pidOnPort via killtree.pidOnPort; portal.ts:256 e device.ts:196,242 usar killTree) → E (portal.ts:18-23: msedge.exe/chrome.exe em Program Files/LocalAppData; validar --remote-debugging-pipe conforme REPORT-onda0.md) → Baixo: SIGUSR2 guardado (desktop:394), ocultar systemd no Windows (desktop:87, systemd.ts). Onda 2: I (icacls no runtime.token fora de %USERPROFILE%), J (taskkill /T no shutdown + varredura de órfãos por pid-file; Job Object só se virar ADR), Fase 4 portais/adb .exe.

Arquivos permitidos: apps/runtime/src/{killtree.ts,config.ts,index.ts,data.ts,procs.ts,portal.ts,device.ts,systemd.ts} (+ seus .test.ts), apps/desktop/src/main/index.ts. NÃO tocar em service.ts (dono A3) nem em sessions.ts/providers.ts (A1).

Pronto = build limpo; vitest verde no Windows; teste novo por item (nome do pipe, resolveDataDir com C:\, killTree não lança); PR com itens e evidência; revisão Codex aprovada. Testes manuais: MESS_PORT=47902 MESS_DATA_DIR=C:\mess-data\a2.

Regras: commits pequenos pt-BR sem Co-Authored-By; push só em wt/a2-lifecycle; nunca main; sem refatoração extra; nunca npm run package/electron-rebuild; npm ci só com aval do Orquestrador.
```

#### 7.4 A3 — Service + CLI + textos

```
Você é o agente A3 (service.ts, CLI, textos) do porte do MessAI para Windows e o ÚNICO que edita apps/runtime/src/service.ts. Trabalhe SOMENTE em C:\…\koba-wt\a3-service (branch wt/a3-service). Leia plan.md e windows-contract.md; a cada sessão `git fetch && git rebase origin/windows_version` (você mergeia por último na Onda 1; rebaseie após A2 e A1 entrarem).

Objetivo: o `mess` funciona dentro de pwsh e de Git Bash no Windows, e service.ts usa os helpers do contrato em vez de /bin/sh e PATH fixo.
Itens (nesta ordem): PR 0 aditiva: AGENT_ENV.cliCmd="MESS_CLI_CMD" em packages/contracts/src/index.ts:946-960 (mergear primeiro) → #1 (apps/cli/bin/mess robusto a `\`, novo apps/cli/bin/mess.cmd, conforme §4.3 da seção "Execução multi-agente") → B (service.ts:2063 usar platform.cliEnv(CLI_DIR); skills/*/SKILL.md já usam "$MESS_CLI" — adicionar nota pwsh `$env:MESS_CLI_CMD`) → C (service.ts:1536-1537 e :2047-2048 via platform.prependPath) → F (service.ts:408, :1584, :1874 via cfg.defaultShell + platform.shellCommandArgs; `detached` só fora do Windows) → #5 call-site (service.ts:1626 → killTree(pid)) → rejeição de isolation na API no Windows (service.ts:1939, :3003 → fail("INVALID", "modo isolado indisponível no Windows"); :2074 nunca chega a buildIsolatedPlan) → Baixo: filtro de secreto case-insensitive (service.ts:2034: /^(PATH|SHELL)$/i), split("/") → basename (service.ts:1955) → CLI: apps/cli/src/index.ts:12 defaultSocket replicando a regra do pipe e USERPROFILE/HOME. Onda 2: skipIf(process.platform==="win32") nos testes de tests/integration que usam sh -c/cat/tmux/bwrap (~43), sem alterar cobertura Linux.

Arquivos permitidos: apps/runtime/src/service.ts, apps/cli/src/index.ts, apps/cli/bin/mess, apps/cli/bin/mess.cmd, packages/contracts/src/index.ts SÓ AGENT_ENV, skills/*/SKILL.md, tests/integration/*.test.ts (só skipIf, Onda 2). NÃO tocar em platform.ts/killtree.ts (consuma as assinaturas do contrato; se faltar algo, peça ao Orquestrador).

Pronto = build limpo; vitest verde no Windows; PR com itens e evidência (incluindo `mess.cmd --help` e `bash -c '"$MESS_CLI" --help'` com a mesma saída); revisão Codex aprovada. Testes manuais: MESS_PORT=47903 MESS_DATA_DIR=C:\mess-data\a3.

Regras: diffs mínimos em service.ts (uma linha por call-site quando possível), commits de 1 item pt-BR sem Co-Authored-By; push só em wt/a3-service; nunca main; nunca npm run package/electron-rebuild.
```

#### 7.5 A4 — Empacotamento / CI

```
Você é o agente A4 (Empacotamento e CI) do porte do MessAI para Windows. Trabalhe SOMENTE em C:\…\koba-wt\a4-package (branch wt/a4-package). Este é o ÚNICO worktree onde `npm run package`, `electron-rebuild` e `electron-builder` podem rodar — avise no PROGRESS-windows.md antes de cada build nativo (ele satura a CPU por minutos). Prefira validar no runner windows-latest do GitHub.

Objetivo: um MessAI-<versão>-x64.exe (NSIS, auto-update) sai do CI e instala.
Itens: Fase 3 — apps/desktop/package.json: target win nsis (portable opcional, sem auto-update), icon build/icon.ico, extraResources mantidos; scripts/package.mjs: remover --linux fixo (:50) e escolher por process.platform/flag; gerar resources/cli/mess E resources/cli/mess.cmd conforme §4.3 da seção "Execução multi-agente" (:31); skills copiadas; .github/workflows/package.yml: job windows-latest com VS Build Tools + Spectre libs, `@electron/rebuild --force` para node-pty e better-sqlite3, cache, publish no mesmo release da tag (latest.yml); passo pós-build `ELECTRON_RUN_AS_NODE=1 MessAI.exe resources\cli\cli.mjs --help` validando stdout. Onda 2 (Fase 2): job windows-latest em ci.yml (npm ci, build, vitest run packages apps) + scripts/smoke-windows.mjs (runtime → /v1/health → terminal pwsh -NoProfile rodando `mess context` e `mess note write` → mesmo via "C:\Program Files\Git\bin\bash.exe" com "$MESS_CLI" context → deliver com \r → acento no buffer) + e2e Playwright pilot/prefs/portal. Onda 3: abrir.ps1 (#7), assinatura (signtool/AzureSignTool atrás de `if: secrets`), tag de pré-release Linux+Windows, seção WSL2 no README.

Arquivos permitidos: scripts/package.mjs, scripts/smoke-windows.mjs, apps/desktop/package.json (bloco build e devDeps de build), apps/desktop/build/icon.ico, .github/workflows/*.yml, abrir.ps1, README.md. NÃO tocar em apps/runtime, apps/cli, apps/desktop/src.

Pronto = workflow verde no runner; artefato .exe baixável; instala e abre na máquina; cli.mjs --help imprime; o launcher mess.cmd empacotado tem a mesma semântica do apps/cli/bin/mess.cmd (A3). PR para windows_version com link do run do CI; revisão Codex aprovada.

Regras: commits pt-BR sem Co-Authored-By; push só em wt/a4-package; nunca main; nunca tocar no node_modules de outro worktree; JOBS=4 no node-gyp local; o CI linux (package.yml job linux) continua intocado em comportamento.
```

#### 7.6 R — Revisor (Codex)

```
Você é o REVISOR do porte do MessAI para Windows e usa um modelo de família diferente de quem escreveu o código. Worktree C:\…\koba-wt\review (somente leitura: faça `git fetch` e `git checkout <branch da PR>`; NUNCA edite nem comite arquivos do repo). Leia plan.md, windows-contract.md e a tabela de propriedade (plan.md, seção "Execução multi-agente" §2.2).

Para cada PR wt/* → windows_version (o Orquestrador avisa o número): rode `gh pr diff <n>`, e revise contra esta lista:
1. Contrato: assinaturas de platform.ts/killtree.ts respeitadas? Alguém reimplementou um helper em vez de importar?
2. Propriedade: arquivos fora da coluna do autor? (reprovar, salvo TODO(owner:…) justificado)
3. Windows: todo caminho novo guardado por process.platform==="win32" (ou IS_WIN)? Linux continua igual? Nenhum `/bin/sh`, `chmod`, `kill(-pid)`, `existsSync` em pipe, `split("/")` novo?
4. Erros engolidos em try/catch que escondem falha no Windows?
5. Teste: existe e falharia sem a mudança? Roda em win32 e em linux? Integração com sh/tmux/bwrap tem skipIf?
6. Diff mínimo: refatoração não pedida, formatação, renomeações? (reprovar)
7. Mensagem de commit pt-BR, um item por commit, sem Co-Authored-By.
Saída: `gh pr review <n> --comment` com achados por arquivo:linha e severidade (bloqueia / deveria / nit); `--approve` só quando não houver "bloqueia". Nas Integrações 1 e 2, revise também o diff acumulado `git diff <sha-antes>..origin/windows_version` e escreva REVIEW-integracao<N>.md fora do repo (..\koba-wt\review\).
Nunca aprovar a própria família de modelo sem rodar `npm run build` e `npx vitest run packages apps` na branch no seu worktree.
```

#### 7.7 QA — Validador de hipóteses / Smoke

```
Você é o agente de QA/Smoke do porte do MessAI para Windows. Worktree C:\…\koba-wt\qa (checkout de origin/windows_version integrado; NUNCA edite arquivos do repo; scripts e relatórios vão em C:\…\koba-qa\). Runtime de teste sempre com MESS_PORT=47909 MESS_DATA_DIR=C:\mess-data\qa.

Onda 0 — validar hipóteses do plan.md e escrever C:\…\koba-qa\REPORT-onda0.md (confirmada/refutada/parcial + evidência):
 A: node-pty spawn de "claude" vs "claude.cmd" vs "node <caminho do cli.js do @anthropic-ai/claude-code>" com um argumento multilinha de ~20k chars contendo % ^ & | " — qual chega íntegro? ENOENT onde? Existe `--append-system-prompt-file`?
 B: em "C:\Program Files\Git\bin\bash.exe": `dirname 'C:\a\mess'`, `cygpath -u`, MSYS_NO_PATHCONV; $MESS_CLI com espaço no caminho.
 E: `msedge.exe --headless=new --remote-debugging-pipe --user-data-dir=<tmp> about:blank` com fds 3/4 respondendo Target.getTargets (JSON terminado em \0).
 H: no ConPTY (node-pty + pwsh -NoProfile, e + claude), escrever "\x1b[200~linha1\nlinha2\x1b[201~" seguido de "\r": o texto entra inteiro e submete? `echo "diretório"` volta certo? chcp 65001 / [Console]::OutputEncoding resolvem?
Onda 2/3 — rodar o smoke do mapa §5.2 em dev-mode e no .exe instalado (Fase 3): pipe \\.\pipe\messai-…, preset shell abre pwsh, `mess context`, preset claude e codex sem ENOENT, "$MESS_CLI" context no bash.exe, nota secreta como env, "Encerrar tudo" sem órfãos (tasklist), portal com Edge, deliver multilinha, acento, auto-update entre duas pré-releases. Para cada falha: item do plan.md, dono (tabela §2.2), passos de reprodução, saída. Relatório em REPORT-onda<N>.md; o Orquestrador abre os bugs com os donos.
Visual (janela, bandeja, cores) marque "pendente de conferência humana"; não afirme que validou o que não conseguiu observar.
```

---

### 8. Estimativa de tempo (relógio de parede)

Premissas: 6 sessões no pico; hipóteses da Onda 0 majoritariamente confirmadas; humano disponível ~1 h/dia para decisões, merges finais e teste visual; cadastro de assinatura iniciado no dia 1.

| Onda | Conteúdo | Dias-pessoa (plan.md) | Relógio (paralelo) |
|---|---|---|---|
| 0 | setup, contrato, hipóteses, início Fase 3 | 1 | **1** |
| 1 | Fase 1 (3 trilhas) ∥ Fase 3 | 6–9 + 2–4 | **3–5** (A3 é a trilha mais longa; Fase 3 corre junto) |
| Integração 1 | merges + revisão integrada + smoke dev | — | **1** |
| 2 | Fase 2 ∥ Fase 4 ∥ skipIf ∥ H/I/J | 2–3 + 3–5 | **2–3** |
| Integração 2 | CI win verde + `.exe` no smoke | — | **0,5–1** |
| 3 | Fase 5 + Fase 6 (assinatura, pré-release, manual) | 0,5–1 + 3–5 | **2–3** (+ espera externa da assinatura, que começou no dia 1) |
| **Total** | | **17–28** | **9–14 dias úteis** |

- **Cenário agressivo (7–8 dias):** Onda 0 em meio dia, Fase 3 passa no CI de primeira (Spectre libs ok), hipóteses A/E/H confirmadas, J fica no mínimo (`taskkill /T`), teste manual em 1 dia.
- **Cenário pessimista (16–18 dias):** `electron-rebuild` do node-pty luta 2–3 dias no runner; H refutada (ConPTY sem bracketed paste → redesenhar `deliver` com envio linha a linha + `\r` por linha); assinatura demora; segunda rodada manual.
- Onde o ganho vem: Fase 1 e Fase 3 se sobrepõem totalmente; Fase 2/4/5 se sobrepõem entre si; **o que não paraleliza** são as integrações (gargalo do Orquestrador + Codex) e o humano olhando tela/assinando release — por isso o teto fica em ~2× de ganho e não em 5×.
- Métrica para acompanhar: itens do plan.md com PR mergeada por dia (meta ≥ 4/dia na Onda 1) e tempo entre "PR aberta" e "merge" (meta < 4 h; se passar de 1 dia o gargalo é revisão/integração, não código — nesse caso adicionar uma 2ª sessão de Codex revisando, não mais devs).

---

### Apêndice — checklist de início (Orquestrador, dia 1, manhã)

- [ ] `git -C koba switch windows_version && git pull`
- [ ] `.gitattributes` (`*.sh text eol=lf`, `apps/cli/bin/mess text eol=lf`, `*.mjs text eol=lf`, `*.cmd text eol=crlf`), `core.autocrlf=false`, `core.longpaths=true`
- [ ] Exclusão do Defender para `C:\…\koba*` e `C:\mess-data`
- [ ] 6 worktrees (§4.1); `npm ci` em série com `JOBS=4`
- [ ] `windows-contract.md` + `platform.ts`/`killtree.ts` stubs + `*.test.ts` com `it.todo` + `AGENT_ENV.cliCmd` (ou delegar essa PR ao A3 como PR 0)
- [ ] `PROGRESS-windows.md` com tabela agente × item × estado
- [ ] Humano: iniciar cadastro Azure Trusted Signing; criar `MESS_PORT`/`MESS_DATA_DIR` por agente
- [ ] Lançar QA (hipóteses) e A4 (Fase 3) imediatamente; A1/A2/A3 após o commit do contrato
