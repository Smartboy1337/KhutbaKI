@echo off
title Khutbah AI - Moschee Al Badr Edition
cd /d "%~dp0"

echo ========================================================
echo   Khutbah AI - Moschee Al Badr Edition wird gestartet...
echo ========================================================

if not exist "node_modules" (
  echo [1/3] Installiere Abhaengigkeiten...
  call npm install --ignore-scripts=false
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo [2/3] Lade Electron Desktop-Engine herunter...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri 'https://github.com/electron/electron/releases/download/v39.0.0/electron-v39.0.0-win32-x64.zip' -OutFile '%TEMP%\electron.zip'; Expand-Archive -Path '%TEMP%\electron.zip' -DestinationPath '.\node_modules\electron\dist' -Force; Set-Content -Path '.\node_modules\electron\path.txt' -Value 'electron.exe' -NoNewline"
) else (
  if not exist "node_modules\electron\path.txt" (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Set-Content -Path '.\node_modules\electron\path.txt' -Value 'electron.exe' -NoNewline"
  )
)

echo [3/3] Starte Khutbah AI (Moschee Al Badr)...
call npm run dev
pause
