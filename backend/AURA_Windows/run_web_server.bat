@echo off
REM ================================================================
REM run_web_server.bat -- launches the FastAPI web backend that
REM serves the React frontend (arya-robot-control): vision stream,
REM chat, robot commands. See WEB_INTEGRATION.md.
REM
REM This is separate from run_aura.bat (the original desktop kiosk
REM app, vivek_main.py) -- run ONE of the two per launch, not both,
REM since they'd otherwise fight over the same camera.
REM
REM Double-click this file, or run it from a terminal:
REM     run_web_server.bat
REM ================================================================

cd /d "%~dp0"

echo == AURA web backend launcher ==

if exist ".venv\Scripts\activate.bat" (
    echo [run_web_server] activating virtual environment .venv ...
    call ".venv\Scripts\activate.bat"
) else (
    echo [run_web_server] NOTE: no .venv found next to this script -- using
    echo [run_web_server] whatever Python is on your PATH. See SETUP_NOTES.md
    echo [run_web_server] if you'd rather use a virtual environment.
)

echo [run_web_server] starting the web backend on http://localhost:8000 ...
echo [run_web_server] (camera/models load in the background -- watch for
echo [run_web_server] "Camera online" below, or poll GET /api/health)
python web_server.py %*

if errorlevel 1 (
    echo.
    echo [run_web_server] exited with an error -- scroll up to see what happened.
    pause
)
