#!/bin/bash
# rentalrdp.com — SETUP AUTO-DEPLOY (jalankan SEKALI di VPS)
# Membuat kunci SSH khusus untuk GitHub Actions supaya "git push" 
# langsung otomatis meng-update VPS tanpa perlu SSH manual.
#
# Cara:  sudo bash deploy-setup.sh
set -e

ROOT="$HOME/.ssh"
mkdir -p "$ROOT"
chmod 700 "$ROOT"

KEY="$ROOT/rentalrdp_deploy"
if [ ! -f "$KEY" ]; then
  ssh-keygen -t ed25519 -N "" -C "rentalrdp-deploy" -f "$KEY" >/dev/null
fi

AUTH="$ROOT/authorized_keys"
touch "$AUTH"
chmod 600 "$AUTH"
grep -qxF "$(cat "$KEY.pub")" "$AUTH" 2>/dev/null || cat "$KEY.pub" >> "$AUTH"

echo ""
echo "=============================================="
echo " SETUP AUTO-DEPLOY SELESAI"
echo "=============================================="
echo ""
echo "Sekarang buka Git Bash di Windows (atau terminal), lalu jalankan 3 perintah ini"
echo "di folder project untuk menyimpan rahasia ke GitHub:"
echo ""
echo "  gh secret set VPS_HOST --repo Miriprian/rentalrdp"
echo "  gh secret set VPS_USER --repo Miriprian/rentalrdp"
echo "  gh secret set VPS_SSH_KEY --repo Miriprian/rentalrdp"
echo ""
echo "Nilai yang perlu diisi:"
echo "  VPS_HOST = IP VPS kamu (contoh: 123.45.67.89)"
echo "  VPS_USER = root  (atau user Linux yang punya akses /opt/rentalrdp)"
echo "  VPS_SSH_KEY = PRIVATE KEY di bawah ini (copy SEMUA baris dari -----BEGIN sampai -----END):"
echo ""
echo "-------- BEGIN ----------"
cat "$KEY"
echo "--------- END -----------"
echo ""
echo "Setelah itu, setiap kamu git push, VPS langsung ter-update otomatis."