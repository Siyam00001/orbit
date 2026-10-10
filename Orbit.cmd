@echo off
rem Double-click to launch Orbit: starts the server and opens the browser once it's up.
cd /d "%~dp0"
if not exist node_modules call npm install
start "" cmd /c "timeout /t 3 >nul & start http://localhost:4321"
npm start
