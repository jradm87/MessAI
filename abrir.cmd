@echo off
rem abrir.cmd - abre o MessAI no Windows: garante dependencias e build e sobe a janela (equivalente ao abrir.sh).
rem Uso: abrir.cmd [--build] [--disable-gpu]
rem   --build        forca rebuild e reinicia o runtime em execucao para carregar o dist novo.
rem   --disable-gpu  abre com a GPU desligada (use se a janela vier preta).
rem Pasta de dados e porta: MESS_DATA_DIR e MESS_PORT, se definidos; senao, os de teste abaixo.
setlocal
cd /d "%~dp0"

set "FORCE_BUILD=0"
set "GPU_FLAG="
:args
if "%~1"=="" goto args_ok
if /i "%~1"=="--build" set "FORCE_BUILD=1" & shift & goto args
if /i "%~1"=="--disable-gpu" set "GPU_FLAG=--disable-gpu" & shift & goto args
echo [abrir] argumento desconhecido: %~1
exit /b 2
:args_ok

if not defined MESS_DATA_DIR set "MESS_DATA_DIR=C:\mess-data\core"
if not defined MESS_PORT set "MESS_PORT=47901"
rem Certificados do Windows para npm/downloads (rede com agente Cloudflare).
if not defined NODE_OPTIONS set "NODE_OPTIONS=--use-system-ca"
rem Node 22 do fnm, se o terminal ainda nao o tiver no PATH.
if exist "%APPDATA%\fnm\aliases\default\node.exe" set "PATH=%APPDATA%\fnm\aliases\default;%PATH%"
where node >nul 2>&1
if errorlevel 1 (
  echo [abrir] Node nao encontrado. Instale o Node 22 ^(plan.md 10.1^).
  exit /b 1
)

rem 1) Dependencias: faltando, ou package-lock/package.json mais novos que o ultimo install.
powershell -NoProfile -Command "$m='node_modules\.package-lock.json'; if(!(Test-Path $m)){exit 1}; $t=(Get-Item $m).LastWriteTime; if((Get-Item package-lock.json).LastWriteTime -gt $t -or (Get-Item apps\desktop\package.json).LastWriteTime -gt $t){exit 1}; exit 0"
if not errorlevel 1 goto deps_ok
echo [abrir] Instalando dependencias (npm ci)...
call npm ci
if errorlevel 1 exit /b 1
set "FORCE_BUILD=1"
:deps_ok
if exist "node_modules\electron\dist\electron.exe" goto electron_ok
echo [abrir] Baixando o Electron...
node node_modules\electron\install.js
if errorlevel 1 exit /b 1
:electron_ok

rem 2) Build
set "NEED_BUILD=%FORCE_BUILD%"
if not exist "apps\runtime\dist\index.js" set "NEED_BUILD=1"
if not exist "apps\desktop\out\main\index.js" set "NEED_BUILD=1"
if "%NEED_BUILD%"=="1" goto build
echo [abrir] Build ja existe (use --build para recompilar).
goto open

:build
echo [abrir] Compilando pacotes e runtime...
call npm run build
if errorlevel 1 exit /b 1
echo [abrir] Compilando o desktop...
call npm run build -w @messai/desktop
if errorlevel 1 exit /b 1

rem 3) Um runtime ja em execucao nao recarrega o dist: encerra (so se for mesmo o nosso) para o app subir um novo.
powershell -NoProfile -Command "foreach($c in @(Get-NetTCPConnection -LocalPort %MESS_PORT% -State Listen -ErrorAction SilentlyContinue)){$p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$c.OwningProcess); if($p.CommandLine -like '*apps*runtime*dist*index.js*'){Write-Host ('[abrir] Reiniciando o runtime defasado (pid '+$c.OwningProcess+')...'); taskkill /PID $c.OwningProcess /T /F | Out-Null}}"

:open
echo [abrir] Abrindo o MessAI (dados: %MESS_DATA_DIR%, porta %MESS_PORT%)...
cd apps\desktop
call npx electron . %GPU_FLAG%
