# 🤖 LEVEL 2 — Auto-pilot: Update + Build .exe Otomatis (untuk NON-programmer)

> Kamu tidak perlu paham GitHub sama sekali. Setelah setup ini sekali, alurnya jadi:
>
> **Kamu cuma: `git add .` → `git commit` → `git push`.**
> Sisanya GitHub kerja sendiri:
> - 📦 kalau kamu mengubah codingan **agent (.exe)** → otomatis di-build & muncul di halaman **Releases** → tinggal download.
> - 🚀 (opsional) kalau kamu `push`, **VPS langsung ter-update otomatis** — tidak perlu SSH atau `./update.sh` manual.

---

## Bagian A — Yang Sudah Jalan (tidak perlu apa-apa)

File `.github/workflows/` sudah saya buatkan & sudah ada di repo kamu. Jadi:

- Setiap kamu `git push` yang mengubah folder `agent/` → GitHub otomatis build `rentalrdp-agent.exe` di mesin Windows virtual → hasilnya tampil di:
  **https://github.com/Miriprian/rentalrdp/releases**
  → klik release terbaru → bagian **Assets** → download `rentalrdp-agent.exe`.

> **Alur memberi .exe ke PC RDP sekarang jadi:** buka Releases → download → USB → pasang. **Tidak perlu buka Windows / compile manual lagi.** 🎉

---

## Bagian B — Aktifkan Auto-deploy ke VPS (opsional tapi seru)

Kalian set 3 rahasia sekali di GitHub (sekali doang, lalu selamanya otomatis).

### Langkah B1 — Jalankan skrip setup di VPS

Di VPS (pertama kali saja):
```bash
cd /opt/rentalrdp.com
sudo bash deploy-setup.sh
```
Skrip itu akan membuat kunci SSH khusus & **menampilkan kunci privat** (`VPS_SSH_KEY`) + IP VPS.

### Langkah B2 — Simpan 3 rahasia ke GitHub

Buka **Git Bash di Windows** (atau terminal Linux) di folder project, lalu jalankan 3 perintah ini. Gh akan minta nilainya di terminal:
```bash
gh secret set VPS_HOST   --repo Miriprian/rentalrdp   # masukkan IP VPS
gh secret set VPS_USER   --repo Miriprian/rentalrdp   # biasanya: root
gh secret set VPS_SSH_KEY --repo Miriprian/rentalrdp  # tempel PRIVATE KEY dari deploy-setup.sh
```

> Kalau tidak mau pakai terminal, jalan alternatif via browser:
> GitHub repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret** → isi nama (VPS_HOST / VPS_USER / VPS_SSH_KEY) + value → Add secret. (lakukan 3 kali)

### Langkah B3 — Tes

`git commit` apa pun + `git push` → buka tab **Actions** di repo GitHub → terlihat workflow "🚀 Deploy otomatis ke VPS" berjalan & hijau. VPS otomatis ter-update. Selesai!

> Kalau **VPS_HOST tidak diisi**, workflow tidak error — hanya melewati langkah deploy (aman).

---

## Bagian C — Alur sehari-hari (sekarang & selamanya)

1. Ubah kode (di Windows atau Linux — sama saja) di folder project.
2. Di terminal/Git Bash:
   ```bash
   git add .
   git commit -m "perubahan: ..."
   git push
   ```
3. Selesai. GitHub menangani sisanya:
   - VPS tersinkron otomatis (tanpa WinSCP / SSH manual).
   - Kalau yang diubah agent → .exe baru muncul di **Releases**.

---

## Bagian D — Kalau ada yang gagal (wajar kalau baru pertama kali)

| Yang tampil di tab Actions | Artinya | Solusi |
|---|---|---|
| 🟢 hijau | Sukses | — |
| 🔴 merah | Ada masalah | Klik workflow merah → klik step yang error → baca pesan di bawahnya. Biasa: secret salah / salah ketik |
| "The authenticated user is unable..." | Token GITHUB_TOKEN kurang izin | Set `Settings → Actions → Workflow permissions → Read and write permissions` → Save, lalu jalankan ulang (`git push` lagi) |
| SSH "Permission denied" | Kunci salah / user salah | Jalankan ulang `deploy-setup.sh` di VPS, cek `VPS_USER`, kopi ulang key ke secret |
| Workflow "deploy" hijau tapi VPS tidak update | VPS_HOST belum diisi | Lihat Bagian B2 |

---

## Ringkasan sekali-sekali

| Kapan | Cukup lakukan |
|---|---|
| Mau update website | `git add .` + `git commit` + `git push` — VPS auto-update |
| Mau ganti .exe agent | `git push` yang menyentuh `agent/` → download .exe baru di **Releases** → pasang di PC RDP |
| Server Linux lupa jalan | `docker compose up -d` di VPS |

Sekarang kamu praktis "tinggal push" — tidak perlu memahami internals GitHub sama sekali. Kalau ada yang terasa aneh, jangan ragu tanya saya. 👍