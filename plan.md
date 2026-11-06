# Plano — Porte do MessAI para Windows (`windows_version`)

> Branch: **`windows_version`** (da `main` em `841f02d` / v0.0.14). **Rev. 3** — consolida a reavaliação (rev. 2) e a revisão crítica independente feita contra o código.
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
