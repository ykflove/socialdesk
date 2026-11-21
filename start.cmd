@echo off
rem Starts Socialdesk. Uses installed Node.js, or the portable copy if Node is not on PATH.
cd /d "%~dp0"
where node >nul 2>nul
if %errorlevel%==0 (
  node --env-file-if-exists=.env server.js
) else (
  "%LOCALAPPDATA%\node-portable\node-v26.13.1-win-x64\node.exe" --env-file-if-exists=.env server.js
)
pause
