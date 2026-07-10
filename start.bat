@echo off
chcp 65001 >nul
title QZCheckScores

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo Node.js is not installed.
    echo Installing Node.js...
    winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    echo.
    echo Please close this window and run start.bat again.
    pause
    exit /b
)

set "interval="
set /p interval=Enter interval time (seconds): 

echo.
echo ======================================
echo Auto run node main.mjs every %interval% seconds
echo ======================================
echo.

:loop
echo.
echo [Running] node main.mjs
node main.mjs
echo.

set /a remaining=%interval%
:countdown
title Next query in %remaining% seconds
if %remaining% leq 0 goto loop
set /a remaining-=1
timeout /t 1 /nobreak >nul
goto countdown
