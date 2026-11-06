# Plano — Porte do MessAI para Windows (`windows_version`)

> Branch de trabalho: **`windows_version`** (criada da `main` em `841f02d` / v0.0.14).
> Objetivo: um instalador Windows (`.exe`) do MessAI reaproveitando ao máximo o código atual, sem reescrever o app.

## Decisão de arquitetura (ADR resumida)
**Escolha: build nativo do Electron para Windows** (electron-builder `nsis` + `portable`).

Por quê, versus as alternativas:
- **Electron-Windows (escolhida):** reaproveita 100% do stack (React Flow, xterm, CodeMirror, **portais = `BrowserView`/`webContents`**, node-pty via ConPTY, better-sqlite3). Mudanças cirúrgicas. Custo baixo.
- **Tauri (Rust + WebView2):** binário menor / menos RAM-base, mas **reescreve a camada de webview/portais** e perde APIs do `webContents`; ganho marginal, custo alto. Fica como *otimização futura*, não agora.
- **GUI nativa Rust (egui/GPUI):** reescrita total; ainda precisaria de webview pros portais. Descartada.
- **WSL2:** zero porte e completo (tmux/isolamento funcionam), ótimo para *usar já*, mas não é o `.exe` nativo que queremos distribuir. Mantém como caminho alternativo documentado.

## Degradações aceitas no Windows (feature-flags, não quebram)
- **tmux** não existe → **sem sessões duráveis / `--persist`** (já há `SessionManager.tmuxAvailable()` que desliga o recurso).
- **bubblewrap** não existe → **modo isolado (#93) indisponível** (já há `probeIsolation()`/`isolationSupport()` reportando). Como o Claude já roda autônomo sem isolar (decisão anterior), não bloqueia o uso.
- **shell padrão** vira **PowerShell** (hoje default é `/bin/sh`).
- **scrcpy/adb**: funcionam no Windows com instalação própria; `findAdb`/`findScrcpy`/`findEmulator` já olham `PATH`/env (`MESS_ADB`, `MESS_SCRCPY`, `ANDROID_SDK_ROOT`).

---

## Fases

### Fase 0 — Preparo
- [ ] Confirmar toolchain de build no Windows (Node 22, Python, Visual Studio Build Tools / `windows-build-tools` para compilar addons nativos).
- [ ] Levantar todos os pontos POSIX no código (`/bin/sh`, unix socket, paths com `/`, `chmod`, `process.kill(-pid)`, sinais) — grep e listar.

### Fase 1 — CI: job de empacotamento Windows
- [ ] `.github/workflows/package.yml`: adicionar job `runs-on: windows-latest` (paralelo ao Linux).
  - `npm ci` + `@electron/rebuild` dos addons (node-pty, better-sqlite3) para a ABI do Electron 45 no Windows.
  - electron-builder targets **`nsis`** (instalador) e **`portable`** (.exe único).
  - publicar os artefatos no mesmo GitHub Release da tag (`latest.yml` do Windows + `.exe`).
- [ ] Garantir que `scripts/package.mjs` copia `resources/skills` e o runtime empacotado também no Windows.
- [ ] Auto-update (electron-updater) no canal Windows (`latest.yml`).

### Fase 2 — IPC: unix socket → named pipe
- [ ] `apps/runtime/src/config.ts`: `socketPath` no Windows vira **named pipe** `\\.\pipe\mess-<machineId|dataDirHash>` (determinístico, como hoje o socket).
- [ ] `apps/runtime/src/index.ts`: `listen({ path })` com o pipe; não tentar `chmod`/`unlink` do socket no Windows.
- [ ] `apps/cli/src/index.ts`: `defaultSocket()` gera o mesmo pipe no Windows; `request({ socketPath })` aceita named pipe nativamente no Node.
- [ ] `AGENT_ENV.socket` carrega o caminho do pipe; validar que os agentes recebem e usam.
- [ ] Teste de fumaça do CLI↔runtime por named pipe.

### Fase 3 — Terminais e processos no Windows
- [ ] **node-pty/ConPTY**: shell padrão `powershell.exe` (ou `cmd.exe`); ajustar `cfg.defaultShell`.
- [ ] **Presets**: os comandos dos agentes (`claude`, `codex`, …) assumem estar no `PATH` do Windows; documentar.
- [ ] **Kill de árvore de processos**: `process.kill(-pid)` (grupo POSIX) não existe no Windows → usar `taskkill /T /F /PID` ou equivalente no `SessionManager`/monitor de processos (#80) e no shutdown do emulador.
- [ ] **tmux desligado**: confirmar que `persistent`/`--persist` degradam sem erro (recruta efêmero).

### Fase 4 — Filesystem / paths / isolamento
- [ ] Revisar usos de `/` fixo, `delimiter`/`sep`, `join` (maioria já usa `path`); `safeRelPath`/`resolveIn` (confinamento) revisar separadores no Windows.
- [ ] **Modo isolado**: `probeIsolation()` retorna indisponível no Windows (sem bwrap); UI já trata. (Futuro: Windows Sandbox/Job Objects — fora de escopo.)
- [ ] Notas em `.md` no disco: paths Windows ok via `path`.

### Fase 5 — Portais e dispositivos
- [ ] **Portais (#26)**: `BrowserView`/CDP por pipe — validar no Windows (deve funcionar nativo do Electron).
- [ ] **Dispositivos (#73)**: `adb`/`emulator` via `ANDROID_SDK_ROOT`/`MESS_ADB`/`MESS_EMULATOR`; **scrcpy** via `MESS_SCRCPY`/PATH. Documentar instalação no Windows.

### Fase 6 — Testes
- [ ] Rodar `npx vitest run packages apps` no Windows (unit, deve passar).
- [ ] Integração: adaptar o que assume `/bin/sh`/unix socket (os testes sobem o runtime real) — pode exigir skips condicionais por plataforma.
- [ ] Smoke manual numa máquina/VM Windows: criar espaço, terminal, nota, portal, recrutar agente, nota secreta.

### Fase 7 — Release
- [ ] Tag de pré-release com artefatos Windows + Linux no mesmo release.
- [ ] Validar instalação num Windows limpo (sem Node) e o auto-update.

---

## Checklist de pontos POSIX conhecidos (preencher na Fase 0)
- [ ] `cfg.defaultShell = "/bin/sh"` → PowerShell no Windows.
- [ ] `socketPath` unix → named pipe (Fase 2).
- [ ] `chmodSync`/`unlinkSync` do socket (só Linux).
- [ ] `process.kill(-pid, …)` (grupo) → `taskkill` no Windows.
- [ ] tmux (`wrapInTmux`, `tmuxAvailable`) — já condicional.
- [ ] bubblewrap (`buildIsolatedPlan`, `probeIsolation`) — já condicional.
- [ ] `whichOnPath` e resolução de binários (`adb`/`emulator`/`scrcpy`) — conferir extensão `.exe`.

## Riscos & mitigação
- **Addons nativos (ABI/compilação):** runner `windows-latest` + `@electron/rebuild` no CI; manter a lição da ABI (não rodar `npm run package` na máquina de dev).
- **IPC/paths:** mudanças isoladas (config + CLI) + teste de fumaça.
- **Testes de integração dependentes de POSIX:** marcar `skipIf(process.platform==='win32')` onde fizer sentido, sem reduzir a cobertura no Linux.
- **Distribuição:** assinar o instalador (code signing) é desejável para evitar SmartScreen — item futuro (requer certificado).

## Fora de escopo (por ora)
- Tauri / GUI nativa.
- Windows Sandbox/Job Objects como "modo isolado".
- Assinatura de código (certificado) — avaliar depois.

## Alternativa imediata (documentar no README)
Para **usar já** no Windows sem esperar o porte: **WSL2 + WSLg** rodando o AppImage Linux, com os CLIs de agente instalados dentro do WSL — experiência completa (tmux/isolamento inclusos).
