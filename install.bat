@echo off
echo.
echo ╔══════════════════════════════════════╗
echo ║     ScaleSync v1.2 — Setup           ║
echo ╚══════════════════════════════════════╝
echo.

where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
  echo [ERROR] Node.js not found. Install from https://nodejs.org
  pause
  exit /b 1
)

for /f "tokens=*" %%i in ('node --version') do set NODE_VER=%%i
echo [OK] Node.js %NODE_VER%

echo.
echo Installing dependencies...
call npm install
if %ERRORLEVEL% neq 0 (
  echo [ERROR] npm install failed
  pause
  exit /b 1
)

echo.
echo [OK] Setup complete!
echo.
echo Run these commands:
echo   npm run dev        ^<-- launch in development mode
echo   npm run build:win  ^<-- build Windows installer (.exe)
echo.
pause
