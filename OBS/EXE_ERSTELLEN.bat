@echo off
setlocal
cd /d "%~dp0" || goto :error
 title Khutbah AI - Windows EXE erstellen
 echo.
 echo ===========================================
 echo   KHUTBAH AI - WINDOWS EXE ERSTELLEN
 echo ===========================================
 echo.
 if not exist "package.json" (
   echo FEHLER: Bitte diese BAT-Datei in den Projektordner neben package.json legen.
   goto :error
 )
 where npm.cmd >nul 2>&1
 if errorlevel 1 (
   echo FEHLER: Node.js / npm wurde nicht gefunden.
   goto :error
 )
 if not exist "node_modules\.bin\electron-builder.cmd" (
   echo FEHLER: Die Projektabhaengigkeiten fehlen. Fuehre zuerst npm install aus.
   goto :error
 )
 echo [1/2] Quellcode pruefen...
 call npm.cmd run typecheck
 if errorlevel 1 goto :error
 echo.
 echo [2/2] Portable Windows-EXE erstellen...
 call npm.cmd run package:win
 if errorlevel 1 goto :error
 if not exist "dist-exe\*.exe" (
   echo FEHLER: Keine EXE im Ausgabeordner gefunden.
   goto :error
 )
 echo.
 echo ERFOLGREICH! Fertige EXE-Dateien:
 dir /b "dist-exe\*.exe"
 echo.
 explorer.exe "%CD%\dist-exe"
 pause
 exit /b 0
:error
 echo.
 echo Build abgebrochen. Bitte die Fehlermeldung oben pruefen.
 pause
 exit /b 1
