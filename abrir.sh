#!/usr/bin/env bash
# abrir.sh — abre o MessAI: garante build, destrava o gerenciador de janelas se preciso e sobe a janela.
# Uso: ./abrir.sh [--build] [--disable-gpu]
#   --build        força rebuild antes de abrir (senão, só builda se faltar artefato).
#                  Após recompilar, reinicia o runtime em execução para carregar o dist novo.
#   --disable-gpu  abre com a GPU desligada (use se a janela vier preta)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

FORCE_BUILD=0
GPU_FLAG=""
for arg in "$@"; do
  case "$arg" in
    --build) FORCE_BUILD=1 ;;
    --disable-gpu) GPU_FLAG="--disable-gpu" ;;
    *) echo "argumento desconhecido: $arg" >&2; exit 2 ;;
  esac
done

log() { printf '\033[36m[abrir]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[abrir]\033[0m %s\n' "$*"; }

# 1) DISPLAY
if [ -z "${DISPLAY:-}" ]; then
  export DISPLAY=:0
  warn "DISPLAY não estava definido; usando :0"
fi

# 2) Gerenciador de janelas: se nenhum estiver mapeando janelas, oferece destravar.
#    (sintoma conhecido deste PC: xfwm4 trava e janelas novas não aparecem)
if command -v wmctrl >/dev/null 2>&1; then
  if ! wmctrl -m >/dev/null 2>&1; then
    warn "Nenhum gerenciador de janelas respondendo."
    if command -v xfwm4 >/dev/null 2>&1; then
      warn "Tentando (re)iniciar o xfwm4…"
      (xfwm4 --replace >/dev/null 2>&1 &) || true
      sleep 1
    fi
  fi
fi

# 3) Dependências
# Reinstala também quando package-lock.json/package.json mudaram depois do último install (ex.: após `git pull`
# que trouxe dependência nova, como electron-updater) — antes só instalava se node_modules não existisse.
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ] || [ apps/desktop/package.json -nt node_modules/.package-lock.json ]; then
  log "Instalando dependências (npm install)…"
  npm install
  FORCE_BUILD=1; need_install_rebuild=1
fi

# 4) Build
need_build=$FORCE_BUILD
[ "${need_install_rebuild:-0}" = "1" ] && need_build=1
[ -f apps/runtime/dist/index.js ] || need_build=1
[ -f apps/desktop/out/main/index.js ] || need_build=1
if [ "$need_build" = "1" ]; then
  log "Compilando pacotes e runtime…"
  npm run build
  log "Compilando o desktop…"
  npm run build -w @messai/desktop
else
  log "Build já existe (use --build para recompilar)."
fi

# 5) Runtime: o desktop sobe sozinho. Mas um processo Node já em execução NÃO recarrega
#    o dist recompilado — então, após um rebuild, o runtime vivo está defasado (sem as
#    rotas novas). Nesse caso o reiniciamos para o desktop subir um fresco do build atual.
TOKEN_FILE="${MESS_DATA_DIR:-$HOME/.messai}/runtime.token"
PORT="${MESS_PORT:-47821}"

# pids escutando na porta do runtime que sejam de fato o nosso runtime (confere o cmdline)
runtime_pids() {
  ss -Htlnp "sport = :$PORT" 2>/dev/null | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u \
  | while read -r pid; do
      [ -n "$pid" ] || continue
      if tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | grep -q 'apps/runtime/dist/index.js'; then
        echo "$pid"
      fi
    done
}

if [ "$need_build" = "1" ]; then
  stale="$(runtime_pids || true)"
  if [ -n "$stale" ]; then
    log "Reiniciando o runtime defasado após o rebuild (pid: $(echo "$stale" | tr '\n' ' '))…"
    # shellcheck disable=SC2086
    kill $stale 2>/dev/null || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      [ -n "$(runtime_pids || true)" ] || break
      sleep 0.3
    done
    # shellcheck disable=SC2046
    kill -9 $(runtime_pids || true) 2>/dev/null || true
    log "Runtime encerrado; o desktop subirá um novo do dist atual."
  fi
fi

if [ -f "$TOKEN_FILE" ] && curl -sf -H "Authorization: Bearer $(cat "$TOKEN_FILE")" "http://127.0.0.1:$PORT/v1/health" >/dev/null 2>&1; then
  log "Runtime já está no ar em 127.0.0.1:$PORT."
else
  log "O runtime sobe automaticamente quando a janela abrir."
fi

# 6) Abrir a janela
# electron . (loadFile, direto do disco) em vez de electron-vite preview (sobe servidor HTTP + loadURL):
# bem mais rápido no startup — sem tela preta esperando o servidor de preview.
log "Abrindo o MessAI…"
cd apps/desktop
# shellcheck disable=SC2086
exec npx electron . $GPU_FLAG
