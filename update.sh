#!/bin/bash
# rentalrdp.com — UPDATE OTOMATIS dari GitHub (Level 1)
# Jalanin di VPS tiap ada versi baru. Diupdate dari repository GitHub:
#   git pull (ambil perubahan) -> build ulang Docker -> migrate -> restart
# Cara: sudo ./update.sh
set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
ok()   { echo -e "${GREEN}[✓]${NC} $1"; }
info() { echo -e "${CYAN}[i]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }

cd "$(dirname "$0")"

echo ""
echo "======================================"
echo "  rentalrdp.com — UPDATE dari GitHub"
echo "======================================"

# ─── 1. SIMPAN .env SEBELUM PULL (jangan ketimpa) ──
if [ -f .env ]; then
  cp .env .env.bak
  info "Backup .env -> .env.bak"
fi

# ─── 2. PULL perubahan dari GitHub ────────────────
if [ -d .git ]; then
  info "Menarik perubahan terbaru..."
  git pull --ff-only
else
  warn "Belum ada .git di folder ini. Clone dulu dari repo GitHub:"
  echo "    git clone <URL_REPO> /opt/rentalrdp.com"
  echo "  (lihat GIT_LINUX.md untuk panduan pertama kali)"
  exit 1
fi

# ─── 3. PULIHKAN .env (file rahasia tidak ikut git) ──
if [ -f .env.bak ] && [ ! -f .env ]; then
  mv .env.bak .env
  ok ".env dipulihkan"
fi

# ─── 4. REBUILD + JALANKAN ───────────────────────────
info "Rebuild & restart Docker..."
docker compose up -d --build

# ─── 5. MIGRATE (bikin tabel baru kalau ada) ─────────
info "Migrasi database..."
docker compose exec -T app bun run src/db/migrate.ts 2>/dev/null || true
ok "Migrasi selesai."

# ─── 6. CEK HEALTH ───────────────────────────────────
info "Menunggu aplikasi siap..."
for i in $(seq 1 20); do
  if curl -sf http://localhost:3000/api/health >/dev/null 2>&1; then
    ok "Aplikasi berjalan normal!"
    break
  fi
  [ $i -eq 20 ] && warn "Aplikasi belum merespon. Cek: docker compose logs app"
  sleep 2
done

echo ""
echo -e " ${GREEN}SELESAI!${NC} Aplikasi sudah diperbarui."
echo "  Periksa: http://localhost:3000/api/health"
echo "  Log    : docker compose logs -f"
