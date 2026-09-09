# Rental PC by Miriprian — Platform Sewa PC Bare Metal

Platform e-commerce sewa **komputer fisik (bare metal)** secara online. Setiap unit adalah perangkat sungguhan — bukan VPS, bukan virtualisasi Proxmox — sehingga penyewa mendapat kemampuan penuh CPU, GPU, RAM, dan SSD selama masa sewa.

Dibangun dengan **Bun + Elysia + Drizzle + PostgreSQL**, dilengkapi katalog PC real-time, sistem order & verifikasi pembayaran, dashboard penyewa, panel admin, serta agent yang berjalan di setiap PC fisik.

---

## Fitur Utama

| Fitur | Keterangan |
|---|---|
| **Katalog real-time** | Spek PC (CPU, GPU, RAM, disk, OS) diambil langsung dari mesin oleh agent, bukan diketik manual |
| **Tes kecepatan internet** | Agent otomatis mengukur kecepatan (speedtest.net) tiap boot & tiap 6 jam; hasil download/upload/ping tampil di katalog & panel admin |
| **Sewa berdurasi** | Per jam, harian, mingguan, atau bulanan |
| **Pembayaran** | QRIS / transfer bank; order menunggu verifikasi admin |
| **Akun RDP otomatis** | Username + password acak terenkripsi (AES-GCM), dibuat & dihapus otomatis mengikuti masa sewa |
| **Dashboard penyewa** | Lihat status order, kredensial RDP, perpanjang sewa |
| **Panel admin** | Verifikasi order, kelola PC, rental, user, voucher, pengaturan situs, audit log |
| **Agent bare metal** | Satu file `.exe` tanpa dependensi; auto-update dari GitHub; auto-start saat boot |
| **Dua mode database** | PGlite instan (tanpa install) atau PostgreSQL produksi |

---

## Menjalankan Secara Lokal

1. **`install.bat`** — satu kali, menginstal dependensi secara otomatis.
2. **`start.bat`** — menjalankan server.
3. Buka **http://localhost:3000**.
4. Login superadmin **`obake` / `obake`**, lalu segera **Ganti Password** di Dashboard → **Akun Saya**.

Untuk Linux/VPS, gunakan `install.sh` (dengan Docker/PostgreSQL — lihat bagian berikut).

---

## Mode Database

| `DATABASE_URL` | Mode | Penggunaan |
|---|---|---|
| `file:./data/rentalrdp-pg` (default) | **Instan (PGlite)** — file lokal, kompatibel PostgreSQL, tanpa instalasi | Pengembangan lokal, demo |
| `postgres://user:pass@host:5432/db` | **PostgreSQL penuh** | Produksi / VPS |

Pindah antar mode aman kapan saja: ubah `DATABASE_URL`, lalu jalankan `bun run src/db/migrate.ts` dan `bun run src/db/seed.ts`. Skema kedua mode identik.

### Produksi dengan Docker (direkomendasikan)

```bash
# Upload folder proyek ke VPS, lalu di VPS:
chmod +x install.sh
sudo ./install.sh
```

Skrip tersebut menginstal Docker, membuat `.env` dengan secret acak, membangun image, lalu menjalankan migrasi dan seed. Panduan langkah demi langkah (termasuk domain + HTTPS Caddy) tersedia di **`TUTORIAL_LINUX.md`**.

Operasional harian: `sudo ./manage.sh` (menu status/log/restart/backup), `docker compose logs -f`, `docker compose restart`.

### Menjaga Kode Tetap Terbaru

- Manual: push dari komputer Anda, lalu di VPS jalankan `sudo ./update.sh`. Panduan Git: **`GIT_LINUX.md`**.
- Otomatis penuh (build `.exe` agent + deploy VPS via GitHub Actions): **`LEVEL2_GITHUB_ACTIONS.md`**.

---

## Alur Sewa

1. Penyewa mendaftar, memilih PC fisik dan paket durasi, lalu membayar via QRIS/transfer.
2. Admin **menyetujui** order di dashboard. Sistem otomatis:
   - membuat **akun RDP unik** dengan password acak terenkripsi (AES-GCM);
   - mengunci status PC menjadi `rented`;
   - mengirim task `create_user` ke agent di PC fisik.
3. Penyewa terhubung via **Remote Desktop** (mstsc / Microsoft RD Client) menggunakan kredensial di dashboard.
4. Sewa berakhir / dihentikan → PC kembali `available`, task `delete_user` dikirim ke agent.

---

## Agent Bare Metal

Agent adalah program kecil yang dipasang di setiap PC fisik yang disewakan. Ia mendeteksi spesifikasi mesin, menghubungkannya ke server, dan mengeksekusi perintah (membuat/menghapus akun RDP). **Tidak memerlukan instalasi Bun, Node, atau dependensi apa pun.**

File rilis mengikuti pola penamaan `<os>-rentalrdp-agent-v<versi>.exe`, misalnya `windows-rentalrdp-agent-v1.exe`.

### Pemasangan (Windows)

1. Dari **Dashboard Admin → Kelola PC**, buat PC baru (kode & token dibuat otomatis; token hanya tampil sekali).
2. Unduh `windows-rentalrdp-agent-v1.exe` (tombol unduh berpindah sendiri ke versi terbaru) dan salin ke PC fisik.
3. **Klik dua kali** file tersebut, lalu ikuti menu:
   - **D** — isi Server URL (alamat situs) dan Agent Token;
   - **A** — jalankan agent (konsol menampilkan seluruh aktivitas);
   - **E** — aktifkan auto-start agar agent berjalan otomatis saat PC boot.
4. Dalam beberapa detik, PC muncul di katalog publik lengkap dengan spesifikasi aslinya.

Menu lengkap: `A` jalankan · `B` hentikan · `C` perbarui dari GitHub · `D` atur token · `E` auto-start · `F` status · `G` reset · `H` hapus (uninstall) · `X` keluar.

Opsi baris perintah: `--install` / `-i` (auto-start) · `--uninstall` / `-u` (hapus) · `--update` (periksa pembaruan) · `--silent` (jalankan di latar belakang) · `--version`.

> **Auto-update**: agent memeriksa versi yang tertanam di dalam file terhadap versi terkini di GitHub Releases, lalu mengganti dirinya sendiri secara otomatis. Naikkan `agent/AGENT_VERSION` untuk melepas versi baru.

### Menjalankan dari Source (Alternatif)

```bash
bun run agent/agent.ts --api https://example.com --token TOKEN_DARI_DASHBOARD
```

---

## Akun & Peran

- **superadmin** — akses penuh, termasuk mengelola admin dan pengaturan. Default `obake / obake` (**wajib diganti setelah login pertama**).
- **admin** — verifikasi order, kelola PC/rental (tidak dapat mengubah akun superadmin).
- **user** — penyewa yang dapat memesan dan melihat kredensial RDP miliknya.

---

## Keamanan

- Password di-hash dengan **bcrypt**; terkunci setelah 8 kali gagal login.
- Sesion **JWT HS256** dalam cookie `HttpOnly + SameSite=Lax` (+ `Secure` kala HTTPS), dengan fallback `Authorization: Bearer`.
- Validasi input menyeluruh (Elysia TypeBox), kontrol akses berbasis peran per-rute, rate-limit pada login dan API.
- Header keamanan: `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, HSTS saat HTTPS.
- Password RDP terenkripsi **AES-GCM** (`APP_KEY`); token agent disimpan sebagai **SHA-256 hash**.
- **Audit log** untuk seluruh aksi penting (login, order, approve, terminate, pengaturan).
- CORS dibatasi melalui `CORS_ORIGIN`.

---

## Perintah

| Perintah | Fungsi |
|---|---|
| `bun install` | Menginstal dependensi |
| `bun run src/db/migrate.ts` | Membuat tabel (idempoten) |
| `bun run src/db/seed.ts` | Mengisi superadmin, paket, dan pengaturan awal (PC demo hanya jika `SEED_DEMO_PCS=true`) |
| `bun run dev` | Menjalankan server dengan auto-reload |
| `bun run agent -- --api URL --token T` | Menjalankan agent (alias `bun run agent/agent.ts`) |
| `bun run backup` | Mencadangkan folder `data` + `.env` ke `backups/` |
| `bun run gen:secret` | Generate JWT_SECRET / APP_KEY acak |

---

## Struktur Proyek

```
src/
  index.ts          → Aplikasi Elysia: helmet, CORS, rate-limit, static
  env.ts            → Validasi & default konfigurasi
  db/index.ts       → Koneksi ganda pg/pglite + pembuatan skema
  db/schema.ts      → Skema Drizzle (users, pcs, plans, orders, rentals, tasks, audit, settings)
  db/seed.ts        → Data awal: superadmin, paket, pengaturan
  lib/auth.ts       → JWT (jose), sesi cookie
  lib/crypto.ts     → SHA-256, random, AES-GCM untuk RDP
  lib/guard.ts      → Otorisasi (currentUser, isAdmin)
  lib/rate-limit.ts / lib/utils.ts
  routes/           → auth, pcs, orders, rentals, admin, agent
public/             → Website + dashboard (SPA tanpa build)
agent/              → Agent bare metal Windows/Linux
```

---

## Dokumentasi

| Dokumen | Isi |
|---|---|
| `INSTALL.md` | Panduan instalasi, migrasi server, dan pemecahan masalah |
| `TUTORIAL_LINUX.md` | Setup produksi di VPS Linux langkah demi langkah (termasuk HTTPS) |
| `GIT_LINUX.md` | Panduan Git/GitHub untuk pembaruan kode |
| `LEVEL2_GITHUB_ACTIONS.md` | Otomatisasi build agent + deploy VPS via GitHub Actions |
| `docker-compose.yml` / `Dockerfile` | Konfigurasi container untuk produksi |