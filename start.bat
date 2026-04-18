@echo off
chcp 65001 >nul
title Auto Run main.mjs

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

timeout /t %interval% /nobreak >nul
goto loop