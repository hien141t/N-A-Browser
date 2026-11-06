@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
echo ================================================================
echo        N/A DEV - WM BACCARAT AI CLOUD LICENSE ACTIVATOR
echo ================================================================
echo.
if not "%~1"=="" (
  set "WM_LICENSE_KEY=%~1"
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install.ps1"
set "WM_LICENSE_KEY="
if errorlevel 1 (
  echo.
  echo [THAT BAI] Qua trinh kich hoat chua thanh cong. Vui long kiem tra loi tren.
) else (
  echo.
  echo ================================================================
  echo [HOAN TAT] May tinh cua ban da duoc dang ky ban quyen thanh cong!
  echo Bay gio ban co the mo khong gioi han profile Chrome/Hide.
  echo Khong can mo them bat ky file .exe hay .bat nao khi chay tool.
  echo ================================================================
)
echo.
pause
