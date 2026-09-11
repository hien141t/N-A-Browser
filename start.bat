@echo off
title N/A Browser Launcher
cd /d "%~dp0"

set "ELECTRON_EXE=%~dp0node_modules\electron\dist\electron.exe"

if exist "%ELECTRON_EXE%" (
    start "" "%ELECTRON_EXE%" .
    exit
)

where node >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    start "" node node_modules\electron\cli.js .
    exit
)

if exist "C:\Program Files\nodejs\node.exe" (
    start "" "C:\Program Files\nodejs\node.exe" node_modules\electron\cli.js .
    exit
)

if exist "C:\Users\hien1\AppData\Local\node-portable\node-v20.18.0-win-x64\node.exe" (
    start "" "C:\Users\hien1\AppData\Local\node-portable\node-v20.18.0-win-x64\node.exe" node_modules\electron\cli.js .
    exit
)

echo [Error] Khong tim thay Electron hoac Node.js de chay N/A Browser!
pause
