@echo off
rem Double-click this to switch on the blog admin on the live site.
rem It reads the two values from .env.local, sends them to Vercel and
rem redeploys. It never prints either value.

cd /d "%~dp0"
title Golden Qube - hosted admin setup

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed, or is not on the PATH.
  echo   Install it from https://nodejs.org and run this again.
  echo.
  pause
  exit /b 1
)

where vercel >nul 2>nul
if errorlevel 1 (
  echo.
  echo   The Vercel CLI is not installed. Install it with:
  echo.
  echo       npm i -g vercel
  echo.
  echo   then run:  vercel login
  echo.
  pause
  exit /b 1
)

node setup-hosted-admin.js

echo.
pause
