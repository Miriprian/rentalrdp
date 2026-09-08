#!/bin/bash
# rentalrdp.com — MENU MANAGE (produksi Docker)
# Cara: sudo ./manage.sh
cd "$(dirname "$0")"

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'

echo ""
echo "======================================"
echo "  rentalrdp.com — Manage Menu"
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

case $choice in
  1)
    echo ""; docker compose ps
    echo "--- Health ---"
    curl -s http://localhost:3000/api/health || echo "Aplikasi tidak merespon"
    ;;
  2)
    docker compose logs -f
    ;;
  3)
    echo ""; echo -e "${CYAN}Restarting app...${NC}"
    docker compose restart app
    echo -e "${GREEN}Selesai!${NC}"
    ;;
  4)
    echo ""; docker compose down
    echo -e "${GREEN}Server dihentikan.${NC}"
    ;;
  5)
    echo ""; docker compose up -d
    echo -e "${GREEN}Server dijalankan.${NC}"
    ;;
  6)
    BACKUP_DIR="backups/$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$BACKUP_DIR"
    docker compose exec -T db pg_dump -U rentalrdp rentalrdp > "$BACKUP_DIR/database.sql"
    echo -e "${GREEN}Backup selesai: $BACKUP_DIR/database.sql${NC}"
    ;;
  *)
    echo -e "${RED}Keluar.${NC}"; exit 0
    ;;
esac
