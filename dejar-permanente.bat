@echo off
title Configurar GEO-PANEL en Inicio Automatico de Windows
echo Configurando GEO-PANEL para que inicie automaticamente al encender la laptop...
copy /Y "C:\Users\siste\.gemini\antigravity\scratch\geo-panel\auto-iniciar-oculto.vbs" "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\GEO-PANEL-AutoStart.vbs" >nul
echo Encendiendo GEO-PANEL en segundo plano...
wscript.exe "C:\Users\siste\.gemini\antigravity\scratch\geo-panel\auto-iniciar-oculto.vbs"
timeout /t 2 >nul
start http://localhost:3000
echo LISTO! GEO-PANEL ya esta activo y se encendera solo cada vez que prendas tu laptop.
