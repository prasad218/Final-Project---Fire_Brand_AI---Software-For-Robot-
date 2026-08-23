@echo off
REM ================================================================
REM run_aura.bat -- recommended way to launch AURA on Windows.
REM
REM Double-click this file, or run it from a terminal:
REM     run_aura.bat
REM
REM It activates the virtual environment (if one exists at .venv),
REM then starts AURA. If you haven't set one up yet, see
REM SETUP_NOTES.md for the one-time setup steps.
REM ================================================================

cd /d "%~dp0"

echo == AURA launcher ==

if exist ".venv\Scripts\activate.bat" (
    echo [run_aura] activating virtual environment .venv ...
    call ".venv\Scripts\activate.bat"
) else (
    echo [run_aura] NOTE: no .venv found next to this script -- using
    echo [run_aura] whatever Python is on your PATH. See SETUP_NOTES.md
    echo [run_aura] if you'd rather use a virtual environment.
)

echo [run_aura] starting AURA...
python vivek_main.py %*

if errorlevel 1 (
    echo.
    echo [run_aura] AURA exited with an error -- scroll up to see what happened.
    pause
)
