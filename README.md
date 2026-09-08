# rentalrdp.com — Rental PC Bare Metal Online

> 🖥️ **Komputer fisik beneran (bare metal). BUKAN VPS, BUKAN Proxmox virtual.**
> Stack modern: **Bun + Elysia + Drizzle + PostgreSQL** (+ PGlite instan untuk coba-coba).

## 1 folder = langsung jalan

```
rentalrdp.com/
├── install.bat / install.sh   ← double-click / 1 perintah, selesai
├── start.bat                  ← jalankan server
├── .env.example / .env
├── docker-compose.yml         ← produksi Postgres beneran
├── src/  (Elysia API + security + RBAC)
├── public/ (website + dashboard, tanpa build)
├── agent/ (agent bare metal Windows/Linux)
└── data/  (database instan)
```

## Cara tercepat (orang awam, Windows)

1. **Double-click `install.bat`** → tunggu sampai SELESAI.
2. **Double-click `start.bat`**.
3. Buka **http://localhost:3000**.
4. Login superadmin: **`obake` / `obake`** → segera **Ganti Password** di Dashboard → Akun Saya.

Itu saja. Tidak perlu install Postgres / Node / build frontend.

## Mode database (otomatis)

| `DATABASE_URL` di `.env` | Mode | Cocok untuk |
|---|---|---|
| `file:./data/rentalrdp-pg` (default) | **Instan (PGlite)** — file lokal, kompatibel Postgres, tanpa install | Coba-coba, migrasi awam, demo |
| `postgres://user:pass@host:5432/db` | **Produksi (PostgreSQL beneran)** | VPS / server produksi |

Pindah ke Postgres kapan saja: isi `DATABASE_URL`, jalankan `bun run src/db/migrate.ts` + `bun run src/db/seed.ts`, restart. Schema sama persis.

### Produksi dengan Docker (Postgres beneran) — paling mudah untuk pemula

> Panduan lengkap langkah-demi-langkah: **`TUTORIAL_LINUX.md`**

```bash
# upload folder ke VPS, lalu di VPS:
chmod +x install.sh
sudo ./install.sh        # 1 perintah: install Docker + buat .env (secret acak) + build + migrate + seed
```

Sesudahnya server jalan di `http://IP:3000` (login `obake / obake`, ganti password segera). Perintah sehari-hari: `sudo ./manage.sh` (menu status/log/restart/backup), `docker compose logs -f`, `docker compose restart`.

Untuk produksi sungguhan dengan nama domain + HTTPS, lihat **Bagian 7 TUTORIAL_LINUX.md** (Caddy auto-HTTPS, set `COOKIE_SECURE=true`).

> **Setiap ada update kode:** pakai Git/GitHub (buat di Windows/Linux → push → di VPS `sudo ./update.sh`). Panduan pemula lengkap: **`GIT_LINUX.md`**.

## Alur sewa (bare metal)

1. User daftar → pilih PC fisik → pilih paket (jam/harian/mingguan/bulanan) → bayar QRIS/transfer → kirim bukti.
2. Admin **Approve** di dashboard → sistem otomatis:
   - buatkan **user RDP unik + password acak terenkripsi (AES-GCM)**,
   - kunci PC jadi `rented`,
   - kirim task `create_user` ke **agent** di PC fisik.
3. User konek via **Remote Desktop (mstsc / RD Client)** pakai kredensial di Dashboard.
4. Sewa habis / terminate → PC kembali `available`, task `delete_user` ke agent.

## Katalog = PC real (kosong sampai agent connect)

Katalog **tidak di-seed dengan PC demo**. PC hanya muncul **setelah** agent terpasang di PC fisik dan connect:

1. **Dashboard Admin → Kelola PC → ➕ Tambah PC Baru** (cukup 1 klik, kode & token otomatis dibuat). Plaintext token hanya tampil **sekali**; PC bersifat `offline` & tersembunyi sampai agent konek.
2. Muncul kartu setup → **⬇ Download `rentalrdp-agent.exe`** langsung dari browser + token siap salin.
3. Copy .exe ke PC fisik, double-click, tempel token pada wizard.
4. Agent heartbeat → server otomatis mengisi **spek real** (CPU, GPU, RAM, disk, OS) + `last_seen_at`, lalu PC langsung tampil di katalog publik.
5. Kalau mau isi manual (mis. harga/lokasi/deskripsi) tetap bisa diedit dari Dashboard Admin.

Keuntungan: katalog selalu akurat karena data spek diambil langsung dari mesin asli, bukan diketik manual.

## Agent bare metal (cara termudah — pakai .exe)

Pasang di tiap PC fisik yang disewakan. **Tidak perlu install Bun/Node apa pun.**

### Opsi A: 1 file .exe (Windows) — paling mudah

```
agent/rentalrdp-agent.exe   ← satu file saja
```

1. **Copy `rentalrdp-agent.exe`** ke PC fisik (boleh lewat USB / network share).
2. **Double-click** file tersebut.
3. Wizard bertanya:
   - **Server URL** → mis. `http://IP_SERVER:3000`
   - **Agent Token** → ambil dari Dashboard Admin → Kelola PC → 🔑 Token Agent
   - **Polling interval** → tekan Enter (default 15 detik)
4. Config tersimpan otomatis sebagai `config.json` satu folder dengan .exe.
5. Jalankan `rentalrdp-agent.exe --install` sekali untuk **auto-start saat PC boot**.

Sekali jalan, agent otomatis mendeteksi spek PC (CPU/GPU/RAM/disk/OS) dan mengirimkannya ke server → PC langsung tampil di katalog publik dengan spek asli.

Perintah: `--install` / `-i` (auto-start) • `--uninstall` / `-u` (hapus) • `--silent` (jalan background tanpa wizard).

### Opsi B: Source (butuh Bun di PC fisik)

```bash
bun run agent/agent.ts --api http://SERVER:3000 --token TOKEN_DARI_DASHBOARD
```

Ambil token: Dashboard Admin → Kelola PC → 🔑 Token Agent (atau saat tambah PC).

## Akun & role

- `superadmin` — penuh (kelola admin, settings, semua). Default: **obake / obake** (wajib diganti!).
- `admin` — verifikasi order, kelola PC/rental (tidak bisa utak-atik akun obake / angkat superadmin).
- `user` — sewa & lihat RDP sendiri.

## Keamanan (production style)

- Hash password **bcrypt (Bun.password)**, lockout setelah 8x gagal.
- **JWT HS256** di cookie `HttpOnly + SameSite=Lax` (+ `Secure` saat HTTPS), fallback `Authorization: Bearer`.
- Validasi semua input (Elysia TypeBox), RBAC per-route, rate-limit login & API.
- Header: `nosniff`, `DENY frame`, `Referrer-Policy`, `Permissions-Policy`, HSTS saat HTTPS.
- Password RDP dienkripsi **AES-GCM** (`APP_KEY`), token agent disimpan sebagai **SHA-256 hash**.
- **Audit log** semua aksi penting (login, order, approve, terminate, settings).
- CORS allowlist via `CORS_ORIGIN`.

## Perintah

| Perintah | Fungsi |
|---|---|
| `bun install` | install deps |
| `bun run src/db/migrate.ts` | buat tabel (idempoten) |
| `bun run src/db/seed.ts` | seed superadmin + plans/settings (PC demo hanya jika `SEED_DEMO_PCS=true`) |
| `bun run src/index.ts` / `bun run dev` | jalan (watch di dev) |
| `bun run agent -- --api URL --token T` | agent (alias `bun run agent/agent.ts`) |
| `bun run backup` | backup folder data + .env ke backups/ |

## Migrasi / pindah server (untuk awam)

Lihat **`INSTALL_AWAM.md`**. Intinya: copy 1 folder → `install.bat` → `start.bat` → selesai. Untuk bawa data: copy folder `data/` + file `.env`.

## Struktur kode

```
src/
  index.ts        → Elysia app, helmet, CORS, rate-limit, static
  env.ts          → validasi env
  db/index.ts     → koneksi ganda pg/pglite + ensureSchema
  db/schema.ts    → Drizzle pg-core (users, pcs, plans, orders, rentals, tasks, audit, settings)
  db/seed.ts      → superadmin obake + 6 PC demo + plans + voucher
  lib/auth.ts     → JWT (jose), cookie session
  lib/crypto.ts   → SHA256, random, AES-GCM RDP
  lib/guard.ts    → currentUser, isAdmin
  lib/rate-limit.ts
  lib/utils.ts    → audit, rupiah, orderCode
  routes/         → auth, pcs, orders, rentals, admin, agent
public/           → index.html + app.js (SPA tanpa build)
agent/agent.ts    → agent bare metal
```

Lihat juga: `TUTORIAL_LINUX.md`, `GIT_LINUX.md`, `INSTALL_AWAM.md`, `docker-compose.yml`, `Dockerfile`.
