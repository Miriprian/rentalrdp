#!/bin/bash
# rentalrdp.com — MENU MANAGE (produksi: Docker ATAU langsung/systemd)
# Cara: sudo ./manage.sh
cd "$(dirname "$0")"

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'

if [ -f .env ] && grep -q "DATABASE_URL=postgres://.*@db:" .env 2>/dev/null; then
  MODE="docker"
elif command -v docker >/dev/null 2>&1 && docker compose ps >/dev/null 2>&1; then
  MODE="docker"
else
  MODE="direct"
fi

echo ""
echo "======================================"
echo "  rentalrdp.com — Manage Menu  ($MODE)"
echo "======================================"
echo "  1) Status & Health Check"
echo "  2) Lihat Log (real-time)"
echo "  3) Restart Aplikasi"
echo "  4) Stop Server"
echo "  5) Start Server"
echo "  6) Backup Database"
echo "  7) Keluar"
echo "======================================"
read -rp "  Pilih [1-7]: " choice

restart_app() {
  if [ "$MODE" = "docker" ]; then docker compose restart app; else systemctl restart rentalrdp; fi
}
stop_app() {
  if [ "$MODE" = "docker" ]; then docker compose down; else systemctl stop rentalrdp; fi
}
start_app() {
  if [ "$MODE" = "docker" ]; then docker compose up -d; else systemctl start rentalrdp; fi
}

case $choice in
  1)
    echo ""
    if [ "$MODE" = "docker" ]; then docker compose ps; else systemctl status rentalrdp --no-pager | head -10; fi
    echo "--- Health ---"
    curl -s http://localhost:3000/api/health || echo "Aplikasi tidak merespon"
    ;;
  2)
    if [ "$MODE" = "docker" ]; then docker compose logs -f; else journalctl -u rentalrdp -f; fi
    ;;
  3)
    echo ""; echo -e "${CYAN}Restarting...${NC}"; restart_app; echo -e "${GREEN}Selesai!${NC}"
    ;;
  4)
    echo ""; stop_app; echo -e "${GREEN}Server dihentikan.${NC}"
    ;;
  5)
    echo ""; start_app; echo -e "${GREEN}Server dijalankan.${NC}"
    ;;
  6)
    BACKUP_DIR="backups/$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$BACKUP_DIR"
    if [ "$MODE" = "docker" ]; then
      docker compose exec -T db pg_dump -U rentalrdp rentalrdp > "$BACKUP_DIR/database.sql"
      echo -e "${GREEN}Backup selesai: $BACKUP_DIR/database.sql${NC}"
    else
      # PGlite = copy folder database langsung
      cp -r data "$BACKUP_DIR/data" 2>/dev/null && echo -e "${GREEN}Backup selesai: $BACKUP_DIR/data${NC}" || echo -e "${RED}Folder data belum ada${NC}"
    fi
    ;;
  *)
    echo -e "${RED}Keluar.${NC}"; exit 0
    ;;
esac