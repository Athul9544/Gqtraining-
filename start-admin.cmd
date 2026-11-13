@echo off
rem Double-click this to run the Golden Qube blog admin on this computer.
rem It starts the local server and opens the admin page in your browser.
rem Close this window (or press Ctrl+C) when you are finished.

cd /d "%~dp0"
title Golden Qube - Blog Admin

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed, or is not on the PATH.
  echo   Install it from https://nodejs.org and run this again.
  echo.
  pause
  exit /b 1
)

echo.
echo   Starting the blog admin...
echo   Your browser will open in a moment. Leave this window running.
echo.

rem give the server a second to bind the port before the browser asks for it
start "" /b cmd /c "timeout /t 2 >nul & start """" http://localhost:4321/admin.html"

node dev-server.js

echo.
echo   The admin has stopped.
pause
