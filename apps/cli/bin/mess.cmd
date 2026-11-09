@echo off
rem Launcher do `mess` para PowerShell/cmd no Windows (o `mess` ao lado e sh, para Git Bash/Linux).
node "%~dp0..\dist\index.js" %*
