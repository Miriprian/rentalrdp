# 🐧 TUTORIAL_LINUX — Install Production (Pemula)

> **Cara paling gampang & paling enak untuk pemula = DOCKER.**
> Sekali perintah, semua (server + database) jalan sendiri, restart otomatis kalau mati, dan bisa dipindah ke server lain tanpa ribet.
>
> Ini tutorial untuk **VPS Ubuntu** (DigitalOcean / Vultr / Hostinger / dll). Tanpa coding.

---

## Bagian 0 — Yang Perlu Disiapkan

| Kebutuhan | Keterangan |
|---|---|
| **VPS Linux** (Ubuntu 22.04/24.04) | Mulai dari Rp 100rb/bln cukup untuk uji coba. Server produksi sebaiknya 2GB RAM ke atas. |
| **Akses SSH** | Kamu akan terima IP + user + password dari penyedia VPS |
| **Domain (opsional)** | Kalau mau pake nama domain, siapkan & arahkan ke IP VPS. Bisa juga tanpa domain (pakai IP) |

**PENTING SEBELUM MULAI:** Buka `install.bat` di Windows **jangan** — itu untuk Windows. Di sini kita pakai file **`install.sh`** yang sudah saya buat untuk Linux.

---

## Bagian 1 — Ambil Kode ke VPS (tanpa WinSCP, via GitHub)

> Kode kamu sudah ada di GitHub (repo private): **`https://github.com/Miriprian/rentalrdp`**.
> Cukup **clone** sekali, selanjutnya update cuma `git pull`.

**1. Login ke VPS** (SSH, mis. dari terminal Windows/Linux):
```bash
ssh root@IP_SERVER
```

**2. Install Git + GitHub CLI (sekali saja):**
```bash
sudo apt update && sudo apt install -y git gh
```

**3. Login GitHub di VPS (sekali saja — pakai kode di browser, sama seperti di Windows):**
```bash
gh auth login
```
- Pilih **GitHub.com** → **HTTPS** → **Login with a web browser**.
- Salin kode yang muncul → buka `https://github.com/login/device` di browser → masukkan kode → Authorize.

**4. Clone kode ke VPS:**
```bash
sudo mkdir -p /opt
cd /opt
gh repo clone Miriprian/rentalrdp
cd rentalrdp
```

Selesai — kode ada di **`/opt/rentalrdp`**. (Selanjutnya update = `git pull`, tidak perlu copy file.)

> **Kalau tidak mau ribet auth** (tidak disarankan, tapi boleh): download ZIP dari
> https://github.com/Miriprian/rentalrdp → Code → Download ZIP → upload & ekstrak.
> Tapi nanti update harus manual lagi. Pakai cara clone di atas lebih enak.

---

## Bagian 2 — Install Sekali Perintah

```bash
# masuk ke folder project (hasil clone)
cd /opt/rentalrdp

# buat boleh dijalankan & JALANKAN (butuh root/sudo)
chmod +x install.sh
sudo ./install.sh
```

**Apa yang terjadi otomatis:**
1. Install **Docker** (kalau belum ada).
2. Buat file **`.env`** dengan kunci rahasia (JWT & APP_KEY) + password database secara **acak & otomatis**.
3. Bangun image aplikasi & nyalakan server **PostgreSQL**.
4. Jalankan migrasi + seed (buat admin & rencana tarif).
5. Tampilkan alamat website + info login.

**Tunggu sampai keluar:**
```
INSTALL SELESAI!
  Website  : http://IP_SERVER:3000
  Login    : obake / obake
```

---

## Bagian 3 — Masuk & Amankan

1. Buka browser → `http://IP_SERVER:3000`.
2. Login: user **`obake`**, password **`obake`**.
3. **SEGERA ganti password admin** (Dashboard → Akun Saya → Ganti Password). Pakai password kuat & simpan.
4. Simpan file **`.env`** (ada `JWT_SECRET`, `APP_KEY`, `POSTGRES_PASSWORD`) — ini **kunci** login & enkripsi. Jangan pernah hilang / bocor.

---

## Bagian 4 — Jangan Lupa Buka Firewall

VPS biasanya ada firewall. Buka port:
```bash
# UFW (biasanya sudah aktif di Ubuntu)
sudo ufw allow 3000/tcp
sudo ufw allow 22/tcp
sudo ufw enable
```

Server kamu sekarang bisa diakses dari internet pada `IP:3000`.

---

## Bagian 5 — Pasang PC RDP (yang mau disewakan)

1. Login dashboard admin → **Kelola PC → ➕ Tambah PC Baru**.
2. Klik **⬇ Download `windows-rentalrdp-agent-v1.exe` (file terbaru ada di bagian Assets rilis terakhir)** → salin token.
3. Copy file `.exe` ke PC RDP (USB / share), double-click, tempel token.
4. Di wizard Server URL isi **`http://IP_SERVER:3000`**.
5. Agent connect → PC muncul di katalog → **Pasarkan** → bisa disewa.

> Di PC RDP, agent otomatis auto-start setelah reboot/matilistrik (sudah saya kerjakan di sesi sebelumnya). Supaya jalan **saat boot** walau belum login, jalankan `.exe` sekali **klik kanan → Run as administrator**.

---

## 🟩 Khusus Proxmox — Install di LXC (container ringan, bukan VM)

**Ya, LXC didukung penuh.** Malah ada cara yang **lebih ringan lagi**: jalankan **langsung dengan Bun** (tanpa Docker, tanpa PostgreSQL) — cukup `RAM ±150–250MB`, cocok untuk LXC yang kamu kasih RAM kecil. Tidak perlu container privileged / nesting.

> Perbandingan: Docker + Postgres ≈ 700MB–1GB RAM. **Langsung Bun + PGlite ≈ 150–250MB RAM.**

### Cara install di LXC

1. **Buat LXC di Proxmox:** template **Ubuntu 22.04/24.04**, RAM 512MB+, disk 8GB+ (opsional, tidak perlu privileged).
2. Masuk ke console LXC (atau `pct enter ID`).
3. Clone kode (lihat Bagian 1: install git+gh → `gh auth login` → `gh repo clone Miriprian/rentalrdp /opt`), lalu:
4. Jalankan installer khusus LXC (ringan, tanpa Docker):
   ```bash
   cd /opt/rentalrdp
   chmod +x install-lxc.sh
   sudo ./install-lxc.sh
   ```
   Ini otomatis: install Bun → `.env` (secret acak) → migrate → seed → **daftarkan sebagai systemd service** (auto-start saat container boot → mati-hidup Proxmox juga ikut jalan lagi).

5. Selesai: **`http://IP_LXC:3000`** — login `obake/obake`, ganti password segera.

> **Catatan LXC:** karena berjalan tanpa Docker, backup/manage/update pakai `sudo ./manage.sh` dan `sudo ./update.sh` (sudah otomatis mendeteksi mode tanpa Docker).

---

## Bagian 6 — Perintah Sehari-hari

```bash
cd /opt/rentalrdp
sudo ./manage.sh        # menu: status, log, restart, stop/start, backup
docker compose logs -f  # lihat log live
docker compose restart  # restart aplikasi
docker compose ps       # lihat status container
```

Server restart **otomatis** kalau reboot (`restart: unless-stopped` sudah diset di compose).

### Backup database (penting!)
```bash
sudo ./manage.sh   → pilih 6) Backup Database
```
Atau langsung:
```bash
mkdir -p backups && docker compose exec -T db pg_dump -U rentalrdp rentalrdp > backups/backup-$(date +%F).sql
```
Simpan file `.sql` + file `.env` di tempat aman (flashdisk/Google Drive).

---

## Bagian 7 — (Opsional) Pakai Nama Domain + HTTPS

Penting untuk produksi sungguhan biar ada gembok 🔒. Pakai **Caddy** (paling gampang, auto HTTPS):

1. Di VPS: install Caddy.
   ```bash
   sudo apt update && sudo apt install -y caddy
   ```
2. Buat file `/etc/caddy/Caddyfile`:
   ```
   rentalrdp.com {
       reverse_proxy localhost:3000
   }
   ```
   (ganti `rentalrdp.com` dgn domain kamu; arahkan DNS A record ke IP VPS dulu)

3. Aktifkan:
   ```bash
   sudo systemctl restart caddy
   ```
4. Edit `.env`: ubah `APP_URL` & `CORS_ORIGIN` jadi `https://rentalrdp.com`, `COOKIE_SECURE=true`, `TRUST_PROXY=true`, lalu restart:
   ```bash
   docker compose restart app
   ```

Selesai — sekarang bisa diakses di `https://rentalrdp.com` dengan gembok hijau.

---

## Bagian 8 — Cara Pindah Data dari Windows ke Linux

Katalog kamu sudah kosong (belum ada PC), jadi mungkin belum perlu. Tapi kalau suatu saat mau bawa data:

1. Di **Windows**: stop server, copy folder `data/` + file `.env`.
2. Upload ke VPS **sebelum** menjalankan `install.sh` (supaya `.env` tidak ditimpa).
3. Kalau Docker pakai Postgres, perlu **import manual** ke Postgres — hubungi kalau butuh, saya pandu.

---

## Troubleshooting

| Gejala | Solusi |
|---|---|
| `Permission denied` / butuh sudo | Jalankan semua perintah pakai `sudo` |
| Port 3000 sudah dipakai | Edit `.env`: `PORT=3001`, lalu `docker compose restart` |
| Aplikasi tidak kebuka | `docker compose ps` → kalau app "exited": `docker compose logs app` |
| Lupa password admin | `docker compose exec -T app bun run src/db/seed.ts` (password balik ke `SEED_ADMIN_PASS` di .env) |
| Agent tidak bisa connect dari PC RDP | Cek: firewall port 3000 terbuka, `API URL` benar, token sesuai, PC dalam 1 jaringan yang bisa akses internet |
| Mau reset total | `docker compose down -v` (hapus SEMUA data DB), lalu `docker compose up -d` + seed lagi |

---

## Kenapa Docker (alasan minat pemula)

- **1 perintah** install, tidak perlu paham Node/Bun/Postgres.
- **Auto-restart** saat mati/reboot VPS.
- **Mudah pindah** ke server lain (tinggal `docker compose up -d`).
- Database terpisah & aman (volume `pgdata`), backup tinggal `pg_dump`.

Mau bantuan / ada error? Bilang saja, saya bantu dari sini.
