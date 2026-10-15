@echo off
setlocal
cd /d "%~dp0"

set "PG_CTL=%~dp0.local\postgresql\runtime\pgsql\bin\pg_ctl.exe"
set "PG_DATA=%~dp0.local\postgresql\data"
set "PG_LOG=%~dp0.local\postgresql\server.log"

if not exist "%PG_CTL%" (
    echo PostgreSQL executable was not found.
    goto :failed
)
if not exist "%PG_DATA%\PG_VERSION" (
    echo Existing PostgreSQL data directory was not found.
    goto :failed
)

"%PG_CTL%" -D "%PG_DATA%" status >nul 2>&1
if not errorlevel 1 (
    echo PostgreSQL is already running.
    goto :success
)

"%PG_CTL%" -D "%PG_DATA%" -l "%PG_LOG%" -w start
if errorlevel 1 goto :failed

:success
echo Database ready. You can now use the application.
if /i not "%~1"=="--no-pause" pause
exit /b 0

:failed
echo Database startup failed. Check .local\postgresql\server.log for details.
if /i not "%~1"=="--no-pause" pause
exit /b 1
