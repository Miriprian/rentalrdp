@echo off
REM rentalrdp.com — INSTALL 1 KLIK untuk orang awam (Windows)
REM Cukup double-click file ini. Bun akan dipakai otomatis jika ada, atau portable.
setlocal
cd /d %~dp0
echo ============================================
echo  rentalrdp.com - Install Otomatis
echo  Bare Metal Rental - 1 folder, install, selesai
echo ============================================

where bun >nul 2>nul
if %errorlevel% neq 0 (
  echo [1/5] Bun belum ada - menginstall via winget...
  winget install -e --id Oven-sh.Bun --accept-source-agreements --accept-package-agreements --silent
  set "PATH=%PATH%;%USERPROFILE%\.bun\bin"
) else (
  echo [1/5] Bun OK
)
call bun --version
if %errorlevel% neq 0 (
  echo GAGAL: Bun belum tersedia. Restart terminal lalu jalankan lagi.
  pause
  exit /b 1
)

if not exist .env (
  echo [2/5] Membuat .env dari contoh...
  copy .env.example .env
  echo [2/5] Generating random JWT_SECRET and APP_KEY...
  for /f "delims=" %%i in ('bun -e "console.log(require('crypto').randomBytes(32).toString('hex'))"') do set JWT=%%i
  for /f "delims=" %%i in ('bun -e "console.log(require('crypto').randomBytes(32).toString('hex'))"') do set APPKEY=%%i
  powershell -Command "(Get-Content .env) -replace '^JWT_SECRET=.*', 'JWT_SECRET=%JWT%' -replace '^APP_KEY=.*', 'APP_KEY=%APPKEY%' | Set-Content .env"
  echo [2/5] .env created with secure random keys
) else (
  echo [2/5] .env sudah ada - dilewati
)

echo [3/5] Install dependencies...
call bun install --no-save
if %errorlevel% neq 0 (
  echo Mencoba mode fallback...
  call bun install --no-save --backend=copyfile
)

echo [4/5] Migrasi DB + seed superadmin obake/obake...
call bun run src/db/seed.ts

echo.
echo ============================================
echo  SELESAI! Jalankan: start.bat
echo  Buka: http://localhost:3000
echo  Login superadmin: obake / obake
echo  SEGERA ganti password setelah login!
echo ============================================
pause
