@echo off
REM Launch LTX Desktop (ComfyUI starts automatically)
REM Right-click > Send to > Desktop to create a shortcut

cd /d "%~dp0.."
start "LTX Desktop" cmd /k pnpm dev
