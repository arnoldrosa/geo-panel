@echo off
title GEO-PANEL - Servidor Local
cd /d "%~dp0"
echo Iniciando GEO-PANEL en http://localhost:3000 ...
start http://localhost:3000
"C:\Program Files\nodejs\node.exe" server.js
pause
