# 🔀 GIT_LINUX — Panduan Git + GitHub

> Tujuan: **bikin di Windows / Linux, update di server Linux, tanpa copy file manual.**
> Prinsipnya: **GitHub jadi "tempat simpan"**, server tinggal tarik versi terbaru.
>
> Level ini = **Level 1 (manual)**: edit → push → di VPS jalankan `./update.sh`.
> Simple, tanpa CI. Build `.exe` tetap di Windows kalau ubah agent.

---

## Ringkasan alur

```
Windows (kamu edit kode)              GitHub (private repo)          Linux VPS (produksi)
  1. edit kode                            simpan semua versi
  2. git add + commit          push         (tempat perantara)   pull     3. ./update.sh
  4. git push  ─────────────────────────▶                        ──────▶  (otomatis build+restart)
```

Hanya **kode sumber** yang masuk GitHub. File rahasia (`.env`), database, dan `.exe` **tidak ikut** (sudah ada di `.gitignore`).

---

## Bagian 0 — Install Git (2 mesin)

### Di Windows (mesin buat koding):
1. Download installer: https://git-scm.com/download/win
2. Install, ikuti default (Next → Next → Install).
3. Buka **Git Bash** (menu Start → "Git Bash"). Ini terminal khusus git di Windows.

### Di VPS Linux (Ubuntu):
```bash
sudo apt update && sudo apt install -y git
```

Setelah install, set identitas mu (opsional tapi disarankan, muncul di riwayat):
```bash
git config --global user.name  "NamaKamu"
git config --global user.email "emailkamu@contoh.com"
```

---

## Bagian 1 — Buat Repo Private di GitHub

1. Login https://github.com (buat akun dulu kalau belum).
2. Klik tanda **+** (kanan atas) → **New repository**.
3. Isi:
   - **Repository name**: `rentalrdp` (bebas)
   - **Private** (pilih ini — bukan Public)
   - **JANGAN centang** "Add a README" / ".gitignore" / "license" (biarkan kosong)
4. Klik **Create repository**.
5. Simpan **repo URL** yang tampil, contoh:
   ```
   https://github.com/NAMA_AKUN/rentalrdp.git
   ```

---

## Bagian 2 — Upload Pertama Kali (dari Windows)

Buka **Git Bash** di folder project:

```bash
cd "D:/opencode/rentalrdp.com"

# 1. JADIKAN folder ini repo git (sekali saja)
git init

# 2. Ambil semua file yang akan di-commit
git add .

# 3. Cek apa saja yang ikut (PASTIKAN .env TIDAK muncul di daftar!)
git status
#   → kalau ada ".env" atau "node_modules" di daftar, STOP. Ada yang salah di .gitignore.
#     (seharusnya tidak, karena .gitignore sudah dibuat)

# 4. Simpan versi pertama (commit)
git commit -m "Versi pertama rentalrdp"

# 5. Hubungkan ke repo GitHub kamu
git branch -M main
git remote add origin https://github.com/NAMA_AKUN/rentalrdp.git

# 6. Upload (akan minta login GitHub / username+password, atau token)
git push -u origin main
```

> **Login** pertama bisa minta **Personal Access Token** (bukan password biasa):
> GitHub → Settings → Developer settings → Personal access tokens → generate → centang `repo` → salin → tempel saat diminta password.

Sekarang kode ada di GitHub (private). Bisa dicek di browser.

---

## Bagian 3 — Install di VPS dari GitHub (pertama kali)

Di VPS, jalankan `install.sh` seperti biasa:

```bash
cd /opt
# upload dulu folder rentalrdp.com yang lama (atau pakai git clone langsung):
git clone https://github.com/NAMA_AKUN/rentalrdp.git
cd rentalrdp
chmod +x install.sh update.sh manage.sh
sudo ./install.sh      # install Docker + bikin .env + build + migrate + seed
```

> Karena `.env` tidak ikut git, `install.sh` otomatis **membuat `.env` baru** dengan secret acak di VPS. Itu normal & aman.

---

## Bagian 4 — Setiap Ada Update (rutin, 2 langkah)

**Langkah 1 — di Windows (koding):**
```bash
cd "D:/opencode/rentalrdp.com"
git add .
git commit -m "perbaikan apa"
git push
```

**Langkah 2 — di VPS (dapat update):**
```bash
cd /opt/rentalrdp.com
sudo ./update.sh      # otomatis: pull + build + migrate + restart
```

Selesai. Server sudah pakai versi baru.

> `update.sh` **tidak menimpa `.env`** — file rahasia di VPS aman walaupun kamu keliru `push` perubahan lokal.

---

## Bagian 5 — Kalau Cuma Ubah Kode (BUKAN .exe)

75% kasus: kamu edit route/UI/dashboard, bukan file agent. Maka cukup **Bagian 4** di atas — VPS update, selesai. Tidak perlu sentuh `.exe` sama sekali.

Hanya kalau kamu ubah `agent/agent-standalone.ts` (logika agent), kamu perlu build `.exe` lagi **di Windows**:
```bash
# di Windows, di folder project:
bun run agent:exe
# → hasil: agent/windows-rentalrdp-agent-v1.exe
# lalu upload file .exe itu ke PC RDP (USB/share).
```
(`.exe` tidak ikut git — jadi tiap ubah agent, rebuild & upload sendiri. Ini memang cara yang benar, karena Linux tak bisa compile `.exe` Windows.)

---

## Catatan Penting

- **`.env` TIDAK PERNAH ke GitHub.** Itu file rahasia (JWT secret, APP_KEY, password DB). Setiap mesin (Windows vs VPS) punya `.env` sendiri. `.gitignore` sudah memastikan ini.
- Bila tidak sengaja commit `.env`: hapus dari git dengan `git rm --cached .env`, lalu `git push`, dan **ganti semua secret** di `.env` (generate ulang `JWT_SECRET` & `APP_KEY`).
- Repo **Private** = hanya kamu yang lihat. Gratis & tanpa batas di GitHub.

---

## Troubleshooting Git

| Gejala | Solusi |
|---|---|
| `git` tidak dikenal (Windows) | Install Git dari git-scm.com, tutup-buka Git Bash |
| `remote origin already exists` | `git remote set-url origin https://github.com/NAMA_AKUN/rentalrdp.git` |
| Auth failed (password ditolak) | Pakai **Personal Access Token** sebagai password (lihat Bagian 2) |
| Perlu tarik perubahan orang lain/hilang | `git pull` |
| Kepanjangan commit terlanjur | `git reset --soft HEAD~1` lalu commit ulang |
| `.env` ke-push tidak sengaja | Lihat Catatan Penting di atas |

Mau lanjut ke **Level 2 (GitHub Actions otomatis)** nanti? Bilang saja — kami siapkan file workflow-nya supaya build `.exe` & deploy juga otomatis.
