# Progresso do porte Windows (atualizado em 2026-11-07)

> Canal entre as trilhas e as sessões (plan.md §9.3). Ler junto com `plan.md` no início de cada sessão.

## Onde está o trabalho
| Branch | Worktree | Estado |
|---|---|---|
| `windows_version` | `C:\Users\ctscs\Documents\MessAI` | Fase 0 + Trilha 1 até o `abrir.cmd` (merge de `win/core`, 25 commits) |
| `win/core` (Trilha 1) | `C:\Users\ctscs\Documents\MessAI-wt\core` | já incluída na `windows_version`; o que falta continua aqui e é mesclado de novo |
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

## Trilha 1 — Fase 1 concluída
- [x] Rejeitar `isolation` no Windows com erro claro (501 testado).
- [x] P: `isWithinCanonicalRoot` sem caixa em caminho com drive; escrita via symlink já era recusada pelo `ensureSafeParent` (403 testado).
- [x] Monitor de processos no Windows via WMI em segundo plano (testado).
- [x] Baixo: SIGUSR2, nota secreta `path`, preset `shell` com caminho POSIX, `expandHome` com `~\`, caminhos com `\`.
- [x] Terminal/nota encolhe ao arrastar (tela 150%, DPI 144): dono não reproduziu ao testar de novo; item encerrado sem alteração de código, reabrir se voltar.
- [x] `mess routine --help` agora mostra a ajuda (antes não mostrava).
- [x] Mojibake ao canalizar a saída do `mess` no PowerShell 5.1 (`mess --help | Select-Object`).
- [x] Caixinhas do `plan.md` marcadas e `win/core` mesclada na `windows_version` após CI Linux verde (run 42641913431), a pedido do dono, sem PR.

## Depois da Fase 1 (merge 555147b, CI Linux 43017514461, testado pelo dono)
- [x] Janela preta piscando a cada ação (git do status da árvore, adb, fork do node-pty ao matar terminal): `windowsHide` + `hideForkConsoles()`.
- [x] Menu de contexto da árvore saía da tela e o fundo invisível bloqueava a árvore (geral, não só Windows): portal ao body.
- [x] Modo isolado indisponível mostra o motivo real (WSL2 no Windows).
- [x] Recrutas e notas/portais/fichários do agente em grade perto dele, até 4 por linha (`gridSpotNear`, `nearNodeId`) — muda também no Linux.
- [ ] Busca por conteúdo da árvore (`>texto`) usa `grep`: conferir no Windows.
- [ ] Barra flutuante do nó cobre "Lista"/"Grade" da árvore quando ela está no topo da tela.
- Pendente do dono: dar push na `main` (novidades do canvas no Linux) para trazer à `windows_version` e testar aqui antes de voltar.

## Observações para o Linux (bugs gerais achados no porte)
- Runtime não tinha CORS: renderer em dev (`localhost:5173`) não conecta — verificar como funciona no Linux.
- ↻ reiniciar Claude dava "Session ID already in use" (corrigido para todos).
- Canvas com `colorMode="dark"` fixo (corrigido).

## Depois da Fase 1 — rodada 2 (merge d6f7212, testado pelo dono)
- [x] Clique/seleção do terminal desalinhados com zoom do canvas (xterm ignora o `transform: scale`); OSC 52 copia para o SO.
- [x] Windows: janela sem moldura e sem menu, barra própria com botões estilo macOS (`TitleBar.tsx`).

## Trilha 2 — Fase 3 (merge 81ef627)
- [x] NSIS por usuário (`build.win`/`nsis`), `package.mjs` por plataforma + `mess.cmd`, só better-sqlite3 recompilado no Windows (node-pty usa o prebuild N-API; o fonte não compila).
- [x] Gerado local em `..\MessAI-wt\package`: instala em `%LOCALAPPDATA%\Programs\@messaidesktop` (nome vem do pacote — trocar para `MessAI`), abre, CLI e addons ok, `mess.cmd` = `mess` (bash).
- [x] `MessAI-Setup-0.0.15.exe` + `latest.yml` + blockmap anexados ao release v0.0.15 (pré-lançamento; os arquivos Linux são da `main`).
- [ ] Job `windows` do `package.yml` ainda não rodou no GitHub (rodar por workflow_dispatch).
- Build local: rede daqui falha no download do Electron/winCodeSign → repetir; último passo com `-c.electronDist=<core>\node_modules\electron\dist`.
- Próximo: Fase 2 (ci.yml windows-latest, smoke), Fase 5/6.
