# Progresso do porte Windows (atualizado em 2026-11-07)

> Canal entre as trilhas e as sessões (plan.md §9.3). Ler junto com `plan.md` no início de cada sessão.

## Onde está o trabalho
| Branch | Worktree | Estado |
|---|---|---|
| `windows_version` | `C:\Users\ctscs\Documents\MessAI` | Fase 0 + `.gitattributes` (K) + node-pty 1.1.0 (L0) |
| `win/core` (Trilha 1) | `C:\Users\ctscs\Documents\MessAI-wt\core` | **30 commits, no GitHub, ainda sem PR** |
| `win/package` (Trilha 2) | `C:\Users\ctscs\Documents\MessAI-wt\package` | criado, nada feito |

Máquina: ver `plan.md` §11 e a memória. Antes de `npm`: `NODE_OPTIONS=--use-system-ca` (agente Cloudflare). Node 22 via fnm.

## Como testar o app (dev)
```powershell
cd C:\Users\ctscs\Documents\MessAI-wt\core
$env:MESS_DATA_DIR = "C:\mess-data\core"; $env:MESS_PORT = "47901"
npm run desktop
```
Scripts de teste fora do repo em `C:\mess-qa\` (smoke.mjs, ask.mjs, portal.mjs, hooks.mjs, hang2.ps1, k2.mjs).

## Trilha 1 — feito (testado de verdade no Windows)
| Item | O quê | Prova |
|---|---|---|
| #2 | `whichOnPath` com PATHEXT/`Path`/`\` | testes unitários |
| A | `resolveSpawnCommand` (exe direto, shim npm → `node script`), prompt longo → `--append-system-prompt-file` | Claude e Codex abrem pelo runtime |
| M | `binaryName` (claude.exe/.cmd) em agentKind/papel/skills/autonomia | bypass aplicado ao Claude |
| #3, Q | shell padrão pwsh > powershell.exe > ComSpec; sem `SHELL=pwsh` ao agente | Claude usa Git Bash (`/usr/bin/bash`) |
| #6 | named pipe `\\.\pipe\messai-<hash>`; CLI replica a regra | `/v1/health` 200 pelo pipe |
| #1, B, G, C | `mess.cmd`, `MESS_CLI_CMD`, hint/skills com PowerShell; chave `Path` preservada | `mess context` em PowerShell e Git Bash |
| W | aceitar aviso do bypass do Claude (`skipDangerousModePermissionPrompt`) | Claude abre direto no prompt |
| U | `palette.ts` → `paletteRank.ts` (colisão de caixa com `Palette.tsx`) | UI abre |
| — | CORS para origens locais (renderer em dev) | app conecta ao runtime |
| — | canvas segue o tema; terminal escuro também no tema claro (decisão do dono) | conferido pelo dono |
| restore | agentes voltam ao reabrir (sem tmux); ↻ retoma com `--resume`; tmux off em win32 | Claude lembrou a palavra; dono confirmou Claude e Codex |
| #4/J | runtime travava ao sair com 2+ PTYs (bug do node-pty) → espera `drained()` + TerminateProcess | 4/4 saem em 1 s; dono confirmou |
| D | desktop aceita ponteiro de pasta com `isAbsolute` | build (não testado na UI) |
| E | portais com Chrome/Edge do Windows, `windowsHide`, `killTree` | example.com: snapshot + screenshot; 10 processos mortos ao sair |
| F, N, H | hooks/rotinas no shell padrão (`shellCommandArgs`), sem janela, UTF-8 no PowerShell | rotina "diretório" correto; hook setup ok |
| #5 | `killTree` (taskkill /T) em portal, hooks, emulador | idem |
| O | `skipIf(win32)` em procs/systemd; testes portáveis | suíte Windows: 174 ok, 2 pulados |

Hipóteses de §11 confirmadas/refutadas nesta sessão: A ✔, B ✘, E ✔, H ✔ (Claude aceita paste+Enter), N ✘ (não abre janela), P ✔, Q ✘ (sem problema), V ✘ (sem diálogo), L0 ✘ (node-pty 1.0.0 não compila → 1.1.0).

## Trilha 1 — falta
- [ ] Rejeitar `isolation` no Windows com erro claro (`service.ts` criação de nó / settings).
- [ ] P: `O_NOFOLLOW` → `lstat` no Windows; `isWithinCanonicalRoot` sem caixa em win32.
- [ ] Monitor de processos (`procs.ts`) degradado no Windows (hoje lê `/proc`).
- [ ] Baixo: SIGUSR2 guardado, filtro de nota secreta case-insensitive (`path`), preset `shell` antigo `/bin/bash` normalizado no boot, `expandHome` com `~\`, `includes("/")` cosmético.
- [ ] Investigar: terminal/nota encolhe ao arrastar (tela com escala 150%, DPI 144).
- [ ] `mess routine --help` não mostra a descrição/ajuda do subcomando (dono testou: a rotina funciona; só a ajuda não aparece) — provavelmente geral, não só Windows.
- [ ] Mojibake ao canalizar a saída do `mess` no PowerShell 5.1 (`mess --help | Select-Object`).
- [ ] Marcar caixinhas do `plan.md` e abrir PR `win/core → windows_version`.

## Observações para o Linux (bugs gerais achados no porte)
- Runtime não tinha CORS: renderer em dev (`localhost:5173`) não conecta — verificar como funciona no Linux.
- ↻ reiniciar Claude dava "Session ID already in use" (corrigido para todos).
- Canvas com `colorMode="dark"` fixo (corrigido).

## Trilha 2 (empacotamento/CI) — não iniciada
Fase 3 (NSIS, `package.yml` windows-latest), Fase 2 (CI Windows, smoke), Fase 5/6. Com node-pty 1.1.0 (N-API, prebuild) o `electron-rebuild` do node-pty deve sumir.
