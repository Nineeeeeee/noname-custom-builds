@echo off
setlocal
cd /d "%~dp0"
if not defined PORT set "PORT=8082"
node dist\cli.cjs %*
