@echo off
echo Starting local web server on port 8080...
cd /d "%~dp0"
start "Quran360 Local Server" node server.js
timeout /t 2 /nobreak >nul
echo Opening http://localhost:8080/index.html#sabaq in default browser...
start http://localhost:8080/index.html#sabaq
