#!/bin/bash
# ===========================================================
#  rentalrdp.com — INSTALL UNTUK LXC / CONTAINER RINGAN
#  TANPA Docker, TANPA PostgreSQL. Cukup Bun + database file (PGlite).
#  Sangat ringan (RAM ~150-250MB) — cocok Proxmox LXC Ubuntu,
#  termux, atau VPS kecil.
#
#  Cara: sudo ./install-lxc.sh
# ===========================================================
set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
ok()   { echo -e "${GREEN}[✓]${NC} $1"; }
info() { echo -e "${CYAN}[i]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }

cd "$(dirname "$0")"

echo ""
echo "=============================================="
echo "  rentalrdp.com — INSTALL LXC (tanpa Docker)"
echo "=============================================="
echo ""

# ─── 1. INSTALL BUN ───────────────────────────────
if command -v bun >/dev/null 2>&1; then
  ok "Bun OK: $(bun --version)"
else
  info "Menginstall Bun..."
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
  # pastikan tersedia di sesi non-interaktif berikutnya (systemd dsb)
  if [ "$(id -u)" = "0" ] && [ ! -f /root/.bun/bin/bun ]; then
    if [ -n "$SUDO_USER" ] && [ -f "/home/$SUDO_USER/.bun/bin/bun" ]; then
      cp -r "/home/$SUDO_USER/.bun" /root/.bun 2>/dev/null || true
    fi
  fi
  command -v bun >/dev/null 2>&1 || err "Bun gagal diinstall. Coba: bash <(curl -fsSL https://bun.sh/install)"
  ok "Bun terinstall: $(bun --version)"
fi

BUN_PATH="$(command -v bun)"

# ─── 2. DEPENDENSI ─────────────────────────────────
info "bun install (dependencies)..."
bun install

# ─── 3. BUAT .env (jika belum ada) ─────────────────
if [ -f .env ]; then
  warn "File .env sudah ada — tidak ditimpa."
else
  info "Membuat .env dengan secrets otomatis..."
  JWT_SECRET=$(openssl rand -hex 32)
  APP_KEY=$(openssl rand -hex 32)
  SERVER_IP=$(curl -s --max-time 5 ifconfig.me 2>/dev/null || echo "IP_SERVER")

  cat > .env <<EOF
# === rentalrdp.com — PRODUKSI (LXC / tanpa Docker) ===
PORT=3000
APP_URL=http://${SERVER_IP}:3000
APP_NAME=Rental PC by Miriprian

# Mode file database (PGlite) — tanpa PostgreSQL. Ringan & aman.
DATABASE_URL=file:./data/rentalrdp-pg

# Secrets (JANGAN DIUBAH setelah generate!)
JWT_SECRET=${JWT_SECRET}
APP_KEY=${APP_KEY}

# Admin login
SEED_ADMIN_USER=obake
SEED_ADMIN_PASS=obake
SEED_ADMIN_EMAIL=obake@rentalrdp.com

# Katalog
SEED_DEMO_PCS=false

# Keamanan
CORS_ORIGIN=http://${SERVER_IP}:3000
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=120
LOGIN_RATE_MAX=15
COOKIE_SECURE=false
TRUST_PROXY=true
EOF
  warn ">>> Simpan APP_KEY & JWT_SECRET (di file .env) — kunci penting! <<<"
  ok "File .env dibuat."
fi

# ─── 4. MIGRATE + SEED ─────────────────────────────
info "Migrasi database..."
bun run src/db/migrate.ts
ok "Migrasi selesai."

info "Seed (admin + plans)..."
bun run src/db/seed.ts
ok "Seed selesai."

# ─── 5. SYSTEMD SERVICE (auto-start saat boot) ─────
SERVICE_DIR="$(pwd)"
info "Memasang systemd service rentalrdp..."
cat > /etc/systemd/system/rentalrdp.service <<EOF
[Unit]
Description=rentalrdp.com
After=network.target

[Service]
WorkingDirectory=${SERVICE_DIR}
ExecStart=${BUN_PATH} run src/index.ts
Restart=always
RestartSec=3
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable —now rentalrdp 2>/dev/null || systemctl enable --now rentalrdp
sleep 2

# ─── 6. CEK ────────────────────────────────────────
if curl -sf http://localhost:3000/api/health >/dev/null 2>&1; then
  ok "Aplikasi berjalan & terdaftar auto-start saat boot."
else
  warn "Belum merespon. Cek: systemctl status rentalrdp"
fi

# ─── 7. SELESAI ────────────────────────────────────
echo ""
echo "=============================================="
echo -e " ${GREEN}INSTALL SELESAI!${NC}"
echo "=============================================="
echo ""
echo "  Website  : http://${SERVER_IP:-IP_SERVER}:3000"
echo "  Login    : obake / obake  (ganti password segera!)"
echo ""
echo "  Perintah umum:"
echo "    systemctl status rentalrdp   ← cek status"
echo "    journalctl -u rentalrdp -f   ← lihat log real-time"
echo "    systemctl restart rentalrdp  ← restart"
echo "    sudo ./update.sh             ← update dari GitHub"
echo "    sudo ./manage.sh             ← menu manage"
echo ""
echo "=============================================="