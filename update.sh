#!/bin/bash
# rentalrdp.com — UPDATE OTOMATIS dari GitHub (Level 1)
# Dual-mode: mendeteksi otomatis apakah app diinstall pakai Docker atau langsung (LXC/Bun).
# Cara: sudo ./update.sh
set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
ok()   { echo -e "${GREEN}[✓]${NC} $1"; }
info() { echo -e "${CYAN}[i]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }

cd "$(dirname "$0")"

# Bun mungkin tidak ada di PATH saat dipanggil via `sudo bash update.sh`
# (mis. install di /root/.bun/bin dengan bash non-login). Deteksi otomatis:
BUN_BIN="$(command -v bun 2>/dev/null || true)"
if [ -z "$BUN_BIN" ]; then
  for p in /root/.bun/bin /home/*/.bun/bin /opt/bun/bin /usr/local/bin; do
    if [ -x "$p/bun" ]; then BUN_BIN="$p/bun"; break; fi
  done
fi
if [ -n "$BUN_BIN" ]; then
  export PATH="$(dirname "$BUN_BIN"):$PATH"
else
  warn "bun tidak terdeteksi di PATH. Install: curl -fsSL https://bun.sh/install | bash"
fi

echo ""
echo "======================================"
echo "  Rental PC by Miriprian — UPDATE dari GitHub"
echo "======================================"

# ─── DETEKSI MODE INSTALL ──────────────────────────
IS_DOCKER=0
if [ -f .env ] && grep -q "DATABASE_URL=postgres://.*@db:" .env 2>/dev/null; then
  IS_DOCKER=1
elif command -v docker >/dev/null 2>&1 && docker compose ps >/dev/null 2>&1; then
  IS_DOCKER=1
fi
[ "$IS_DOCKER" = "1" ] && info "Mode: Docker" || info "Mode: langsung (Bun/systemd — tanpa Docker)"

# ─── 1. SIMPAN .env SEBELUM PULL ───────────────────
if [ -f .env ]; then
  cp .env .env.bak
  info "Backup .env -> .env.bak"
fi

# ─── 2. PULL PERUBAHAN dari GitHub ─────────────────
if [ -d .git ]; then
  info "Menarik perubahan terbaru..."
  # Server deploy wajib mencerminkan main persis (perubahan lokal dibuang,
  # .env & data/ tidak tersentuh karena untracked & ter-ignore).
  git fetch origin
  git reset --hard origin/main
else
  warn "Belum ada .git di folder ini. Clone dulu dari GitHub:"
  echo "    gh repo clone Miriprian/rentalrdp /opt/rentalrdp"
  echo "  (lihat TUTORIAL_LINUX.md untuk panduan pertama kali)"
  exit 1
fi

# ─── 3. PULIHKAN .env ──────────────────────────────
if [ -f .env.bak ] && [ ! -f .env ]; then
  mv .env.bak .env
  ok ".env dipulihkan"
fi

# ─── 4. UPDATE SESUAI MODE ─────────────────────────
if [ "$IS_DOCKER" = "1" ]; then
  info "Rebuild & restart Docker..."
  docker compose up -d --build
  info "Migrasi database..."
  docker compose exec -T app bun run src/db/migrate.ts 2>/dev/null || true
  ok "Migrasi selesai."
else
  info "bun install (dependencies baru, kalau ada)..."
  bun install || true
  info "Migrasi database..."
  bun run src/db/migrate.ts || true
  ok "Migrasi selesai."
  info "Restart service systemd..."
  if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files 2>/dev/null | grep -q "^rentalrdp.service"; then
    systemctl restart rentalrdp
  else
    warn "Service rentalrdp tidak ditemukan. Jalankan ulang: nohup bun run src/index.ts &"
  fi
fi

# ─── 5. CEK HEALTH ─────────────────────────────────
info "Menunggu aplikasi siap..."
for i in $(seq 1 20); do
  if curl -sf http://localhost:3000/api/health >/dev/null 2>&1; then
    ok "Aplikasi berjalan normal!"
    break
  fi
  [ $i -eq 20 ] && warn "Aplikasi belum merespon. Cek log: journalctl -u rentalrdp -f  (atau docker compose logs app)"
  sleep 2
done

echo ""
echo -e " ${GREEN}SELESAI!${NC} Aplikasi sudah diperbarui."
echo "  Periksa: http://localhost:3000/api/health"