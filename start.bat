@echo off
cd /d "%~dp0"
if not exist "runtime\node\node.exe" (
  echo Bedrock Beacon's bundled Node runtime is missing.
  echo Re-extract the complete portable application package.
  pause
  exit /b 1
)
start "" http://localhost:3210
"runtime\node\node.exe" server.js
