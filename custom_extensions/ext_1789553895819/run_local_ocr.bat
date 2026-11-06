@echo off
title i9 Local OCR Server
cd /d "%~dp0"
echo ========================================================
echo   Dang khoi dong Local OCR Server (ddddocr offline)...
echo   Endpoint: http://127.0.0.1:5588/ocr
echo ========================================================
python local_ocr_server.py
pause
