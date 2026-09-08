@echo off
REM rentalrdp.com — JALANKAN server
cd /d %~dp0
call bun run src/index.ts
pause
