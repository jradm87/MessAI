# Plano — Porte do MessAI para Windows (`windows_version`)

> Branch: **`windows_version`** (da `main` em `841f02d` / v0.0.14). Rev. 2 — reavaliado contra o código.
> Objetivo: instalador Windows (`.exe`) reaproveitando o código atual, sem reescrever o app.

## Decisão (ADR) — mantida
**Build nativo do Electron para Windows** (electron-builder `nsis` + `portable`).
- Reaproveita 100% do stack (React Flow, xterm, CodeMirror, portais via `BrowserView`/`webContents`, node-pty/ConPTY, better-sqlite3).
- **Tauri**: rescreveria a camada de portais/webview por ganho marginal (binário/RAM-base) → otimização futura, não agora.
- **GUI nativa Rust**: reescrita total → descartada.
- **WSL2**: completo e imediato pra *usar*, mas não é o `.exe` nativo → documentado como alternativa.

## Reavaliação (rev. 2) — o que a rev. 1 subestimou
| # | Achado no código | Impacto | Onde |
|---|---|---|---|
| 1 | CLI `mess` é script `#!/bin/sh` (dev e pacote) | **Bloqueante**: agentes não falam com o runtime | `apps/cli/bin/mess`, `scripts/package.mjs` |
| 2 | `whichOnPath` ignora `PATHEXT` (`.exe/.cmd`) | **Bloqueante**: presets (claude/codex) “indisponíveis”, adb/scrcpy não achados | `apps/runtime/src/providers.ts` |
| 3 | `resolveDefaultShell` → `$SHELL`/`/bin/bash` | Terminal padrão quebra | `apps/runtime/src/config.ts` |
| 4 | Desktop sobe runtime com `detached: true` | Abre janela de console | `apps/desktop/src/main/index.ts` |
| 5 | `ps`/`/proc` no monitor de processos; `kill(-pid)` (grupo) | Monitor #80 e encerramentos falham | `procs.ts`, `sessions.ts`, `device.ts`, `portal.ts` |
| 6 | Socket unix `agent.sock` + `chmod`/`unlink` | CLI↔runtime não conecta | `config.ts`, `runtime/index.ts`, `cli` |
| 7 | `abrir.sh` (bash) | Dev no Windows sem script | raiz |

**Conclusão:** a ordem certa é **portabilidade do runtime+CLI → CI → smoke**. Um `.exe` que compila mas não deixa agente chamar `mess` não serve.

## Degradações aceitas no Windows (feature-flags)
- **tmux** ausente → sem sessões duráveis / `--persist` (`tmuxAvailable()` já desliga).
- **bubblewrap** ausente → sem modo isolado (`probeIsolation()` já reporta). Claude já é autônomo sem isolar.
- **Monitor de processos (#80)**: v1 mostra só o processo raiz/memória via `tasklist`/`wmic` ou some no Windows.
- Shell padrão: `pwsh` → `powershell.exe` → `%COMSPEC%`.

---

## Fases (ordem revisada)

### Fase 1 — Núcleo multiplataforma (runtime + CLI) ⟵ começar aqui
- [ ] **`whichOnPath` com `PATHEXT`** no Windows (testar `cmd`, `cmd.exe`, `.cmd`, `.bat`); sem `X_OK` (não existe no Windows). Teste unitário.
- [ ] **Shell padrão** Windows: `MESS_SHELL` > `pwsh` > `powershell.exe` > `%COMSPEC%`.
- [ ] **Named pipe**: `socketPath` = `\\.\pipe\messai-<hash(dataDir)>` no Windows; pular `chmod`/`unlink`; CLI `defaultSocket()` igual. Teste unitário do cálculo do caminho.
- [ ] **Launcher do CLI**: gerar `mess.cmd` (`@node "%~dp0..\dist\index.js" %*` em dev; `ELECTRON_RUN_AS_NODE=1 "%MESS_ELECTRON%" "%~dp0cli.mjs" %*` no pacote) **e** manter o `mess` sh (Claude Code no Windows executa via Git Bash). `MESS_CLI` aponta pro `.cmd` no Windows.
- [ ] **Kill de árvore**: helper `killTree(pid)` → `taskkill /PID <pid> /T /F` no Windows; `kill(-pid)` no Linux. Usar em sessions/device/portal.
- [ ] **Monitor #80**: no Windows, degradar (só raiz) sem quebrar.
- [ ] **Desktop**: `spawn(..., { detached: process.platform !== "win32", windowsHide: true })`.

### Fase 2 — CI Windows (build + smoke headless)
- [ ] Job `windows-latest` em `ci.yml`: `npm ci`, `npm run build`, `vitest run packages apps` (unit).
- [ ] **Smoke headless** (script node): sobe o runtime, `GET /v1/health`, `mess context` pelo **named pipe**, cria terminal (ConPTY) que roda `echo ok`, verifica saída. Valida o núcleo sem máquina Windows local.
- [ ] Integração pesada (usa `sh -c`/`cat`/tmux) fica Linux-only (`skipIf(win32)` onde necessário).

### Fase 3 — Empacotamento Windows
- [ ] `apps/desktop/package.json`: target `win` → `nsis` + `portable`; ícone `.ico`.
- [ ] `package.yml`: job `windows-latest` com `@electron/rebuild` (node-pty, better-sqlite3) e publish no mesmo release da tag (`latest.yml` Windows).
- [ ] `package.mjs`: gerar `mess.cmd` + `cli.mjs` no `resources/cli`; skills incluídas.

### Fase 4 — Portais, dispositivos e paths
- [ ] Portais (`BrowserView`/CDP por pipe): validar no Windows.
- [ ] adb/emulator/scrcpy: resolver `.exe` (via Fase 1) + `ANDROID_SDK_ROOT`/`MESS_*`; documentar instalação.
- [ ] Revisar `safeRelPath`/`resolveIn` (separador `\`, letras de drive, case-insensitive).

### Fase 5 — Dev no Windows
- [ ] `abrir.ps1` equivalente ao `abrir.sh` (build + subir app), ou documentar `npm run dev`.

### Fase 6 — Release
- [ ] Tag de pré-release com Linux + Windows no mesmo release.
- [ ] Teste manual num Windows limpo: instalar, criar espaço, terminal, nota, portal, recrutar agente, nota secreta, auto-update.

## Riscos & mitigação
- **Sem máquina Windows pra testar** → smoke headless no CI (Fase 2) cobre o núcleo; teste manual só no fim.
- **Addons nativos** → rebuild no runner Windows; nunca `npm run package` na máquina de dev (lição da ABI).
- **Agentes no Windows** usam Git Bash (Claude Code) → manter launcher sh + `.cmd`; skills usam `"$MESS_CLI"` (funciona no Git Bash).
- **SmartScreen** sem code signing → aviso no 1º uso; assinatura fica pra depois.

## Fora de escopo (por ora)
Tauri / GUI nativa · Windows Sandbox/Job Objects como modo isolado · code signing.

## Alternativa imediata
**WSL2 + WSLg** rodando o AppImage Linux (com CLIs de agente dentro do WSL) — experiência completa hoje.
