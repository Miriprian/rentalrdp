# Panduan Instalasi & Migrasi — Rental PC by Miriprian

Panduan praktis yang tidak memerlukan pengetahuan pemrograman. Cukup ikuti langkah demi langkah.

## A. Install baru (laptop/PC/VPS Windows)

1. **Copy folder `rentalrdp.com`** ke komputer baru (atau ekstrak ZIP).
2. **Double-click `install.bat`**.
   - Tunggu sampai tulisan `SELESAI!`.
   - Kalau diminta install Bun, klik Yes/Allow.
3. **Double-click `start.bat`**.
4. Buka browser: **http://localhost:3000**
5. Login: user **`obake`**, password **`obake`**.
6. **WAJIB:** Dashboard → **Akun Saya** → Ganti password baru yang kuat.

Selesai. Website siap dipakai produksi kecil-menengah.

## B. Pindah server + bawa data lama

1. Di komputer lama, **stop server** (tutup `start.bat`).
2. Copy **1 folder `rentalrdp.com`** ke komputer baru — pastikan ikut:
   - folder **`data/`** (database)
   - file **`.env`** (password & kunci)
3. Di komputer baru: double-click **`start.bat`**. (Tidak perlu install ulang kalau sudah pernah `install.bat`.)
4. Kalau error aneh: jalankan **`install.bat`** sekali lagi (aman, data tidak hilang).

## C. Buka ke internet (VPS)

Paling mudah:

1. Sewa VPS (Ubuntu), arahkan domain `rentalrdp.com` ke IP VPS (DNS A record).
2. Upload folder ini ke `/opt/rentalrdp.com`.
3. `chmod +x install.sh && ./install.sh`
4. Jalankan permanen:
   ```bash
   # pakai pm2 / systemd, contoh systemd:
   sudo tee /etc/systemd/system/rentalrdp.service >/dev/null <<'EOF'
   [Unit]
   Description=rentalrdp.com
   After=network.target
   [Service]
   WorkingDirectory=/opt/rentalrdp.com
   ExecStart=/root/.bun/bin/bun run src/index.ts
   Restart=always
   Environment=NODE_ENV=production
   [Install]
   WantedBy=multi-user.target
   EOF
   sudo systemctl enable --now rentalrdp
   ```
5. Pasang HTTPS (wajib produksi!): pakai Caddy/Nginx reverse proxy → `COOKIE_SECURE=true` di `.env`, restart.

## D. Ganti ke PostgreSQL beneran (produksi serius)

Default `file:./data/...` sudah cukup untuk puluhan user. Kalau mau Postgres beneran:

**Opsi Docker (termudah):**
```bash
# edit .env: DATABASE_URL=postgres://rentalrdp:changeme@db:5432/rentalrdp
docker compose up -d --build
docker compose exec app bun run src/db/seed.ts
```

**Opsi manual:** install Postgres 16 → buat DB → isi `DATABASE_URL=postgres://...` → `bun run src/db/migrate.ts` → `bun run src/db/seed.ts` → restart.

## E. Kalau ada masalah

| Gejala | Solusi |
|---|---|
| `bun` tidak dikenal | Tutup terminal, buka lagi. Atau install manual dari bun.sh |
| Port 3000 dipakai | Edit `.env`: `PORT=3001`, jalankan ulang |
| Lupa password admin | Jalankan `bun run src/db/seed.ts` (akun obake diaktifkan ulang, password balik ke isi `SEED_ADMIN_PASS` di .env), login, ganti lagi |
| Database rusak | Stop server → rename folder `data` jadi `data-rusak` → `bun run src/db/migrate.ts` → `bun run src/db/seed.ts` (data mulai baru!) |
| Agent tidak connect | Cek token (regen di dashboard), cek firewall port 3000, cek `API` URL bisa diakses dari PC |

## F. Backup (penting!)

- Otomatis: `bun run backup` → tersimpan di `backups/TANGGAL/`.
- Manual: copy folder **`data/`** + file **`.env`** ke flashdisk/Google Drive tiap minggu.

Butuh bantuan? Chat admin via nomor di website (Settings → wa_admin).
