import { initDb, mode, rawPool, pglite } from "./index";
import { env } from "../env";
import { sha256, randomToken } from "../lib/crypto";

async function q(text: string, params: unknown[] = []) {
  if (mode === "postgres") return rawPool.query(text, params);
  return pglite.query(text, params);
}

async function one(text: string, params: unknown[] = []) {
  const r = await q(text, params);
  const rows = mode === "postgres" ? r.rows : r.rows ?? r;
  return rows?.[0] ?? null;
}

async function all(text: string, params: unknown[] = []) {
  const r = await q(text, params);
  return (mode === "postgres" ? r.rows : r.rows ?? r) as unknown[];
}

export async function runSeed() {
  await initDb();

  // 1. settings default
  const defaults: Record<string, string> = {
    site_name: "rentalrdp.com",
    tagline: "Rental PC Bare Metal — Komputer Fisik Beneran, Bukan Virtual",
    wa_admin: "6281234567890",
    qris_text: "QRIS rentalrdp.com — konfirmasi via WhatsApp setelah bayar",
    payment_bca: "BCA 1234567890 a.n. rentalrdp.com",
    notice: "Semua unit adalah BARE METAL (fisik). Bukan VPS / bukan Proxmox virtual. Akses full RDP + IP publik.",
    price_note: "Harga sudah termasuk listrik, internet, dan maintenance.",
  };
  for (const [k, v] of Object.entries(defaults)) {
    await q(
      `INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO NOTHING`,
      [k, v]
    );
  }

  // 2. plans
  const plans = [
    { code: "HOURLY", name: "Per Jam", hours: 1, sort: 1 },
    { code: "DAILY", name: "Harian", hours: 24, sort: 2 },
    { code: "WEEKLY", name: "Mingguan", hours: 168, sort: 3 },
    { code: "MONTHLY", name: "Bulanan", hours: 720, sort: 4 },
  ];
  for (const p of plans) {
    await q(
      `INSERT INTO plans (id, code, name, duration_hours, sort_order) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (code) DO NOTHING`,
      [crypto.randomUUID(), p.code, p.name, p.hours, p.sort]
    );
  }

  // 3. superadmin obake / obake
  const adminUser = env.SEED_ADMIN_USER || "obake";
  const adminPass = env.SEED_ADMIN_PASS || "obake";
  const adminEmail = env.SEED_ADMIN_EMAIL || "obake@rentalrdp.com";
  const existing = await one(`SELECT * FROM users WHERE username=$1`, [adminUser]);
  if (!existing) {
    const hash = await Bun.password.hash(adminPass, { algorithm: "bcrypt", cost: 10 });
    await q(
      `INSERT INTO users (id, username, email, password_hash, full_name, role, is_active) VALUES ($1,$2,$3,$4,$5,'superadmin',true)`,
      [crypto.randomUUID(), adminUser, adminEmail, hash, "Super Admin"]
    );
    console.log(`[SEED] superadmin dibuat: ${adminUser} / ${"*".repeat(Math.min(adminPass.length, 8))} (ganti password setelah login!)`);
  } else {
    // pastikan role superadmin & aktif (agar tidak terkunci)
    await q(`UPDATE users SET role='superadmin', is_active=true WHERE username=$1`, [adminUser]);
    console.log(`[SEED] superadmin sudah ada: ${adminUser} (role dipastikan superadmin)`);
  }

  // 4. voucher contoh
  await q(
    `INSERT INTO vouchers (id, code, discount_percent, max_discount_idr, quota) VALUES ($1,'WELCOME10',10,50000,500) ON CONFLICT (code) DO NOTHING`,
    [crypto.randomUUID()]
  );

  // 5. Demo PCs bare metal — HANYA jika SEED_DEMO_PCS=true (default kosong, katalog real dari agent)
  const wantDemo = (process.env.SEED_DEMO_PCS ?? "false").toLowerCase() === "true";
  if (wantDemo) {
    const pcCount = (await all(`SELECT id FROM pcs LIMIT 1`)).length;
    if (pcCount === 0) {
      const demo = [
        { code: "RDP-01", name: "Bare Metal Ryzen 7 — Gaming", cpu: "Ryzen 7 7800X3D", gpu: "RTX 4070 12GB", ram: 32, storage: 1000, os: "Windows 11 Pro", ip: "103.160.62.11", h: 15000, d: 100000, w: 500000, m: 1600000, loc: "Jakarta", desc: "Fisik beneran. Cocok untuk game, render, bot, live streaming." },
        { code: "RDP-02", name: "Bare Metal i7 — Kantor", cpu: "Intel i7-13700", gpu: "UHD 770", ram: 16, storage: 512, os: "Windows 11 Pro", ip: "103.160.62.12", h: 10000, d: 75000, w: 350000, m: 1200000, loc: "Jakarta", desc: "Fisik beneran. Office, browsing multi-tab, admin olshop." },
        { code: "RDP-03", name: "Bare Metal RTX — Render", cpu: "Ryzen 9 7950X", gpu: "RTX 4090 24GB", ram: 64, storage: 2000, os: "Windows 11 Pro", ip: "103.160.62.13", h: 35000, d: 250000, w: 1200000, m: 3900000, loc: "Surabaya", desc: "Fisik beneran. Render 3D, AI, mining riset, video 4K." },
        { code: "RDP-04", name: "Bare Metal Hemat — Pelajar", cpu: "Intel i5-12400", gpu: "GTX 1660S", ram: 16, storage: 512, os: "Windows 10 Pro", ip: "103.160.62.14", h: 7000, d: 50000, w: 250000, m: 850000, loc: "Bandung", desc: "Fisik beneran. Tugas, coding, emulator." },
        { code: "RDP-05", name: "Bare Metal Xeon — Server", cpu: "Xeon E-2388G", gpu: "-", ram: 32, storage: 2000, os: "Windows Server 2022", ip: "103.160.62.15", h: 12000, d: 90000, w: 450000, m: 1500000, loc: "Jakarta", desc: "Fisik beneran. Uptime 24 jam, cocok bot & aplikasi." },
        { code: "RDP-06", name: "Bare Metal Mac?", cpu: "N/A", gpu: "N/A", ram: 8, storage: 256, os: "Windows 11 Pro", ip: "103.160.62.16", h: 5000, d: 40000, w: 200000, m: 700000, loc: "Jakarta", desc: "Unit maintenance contoh — status maintenance." },
      ];
      for (const [i, p] of demo.entries()) {
        const token = randomToken(24);
        await q(
          `INSERT INTO pcs (id, code, name, location, city, cpu, gpu, ram_gb, storage_gb, storage_type, os, ip_public, rdp_port, agent_token_hash, status, price_hourly, price_daily, price_weekly, price_monthly, description, is_bare_metal, is_active)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'NVMe SSD',$10,$11,3389,$12,$13,$14,$15,$16,$17,$18,true,true)
           ON CONFLICT (code) DO NOTHING`,
          [
            crypto.randomUUID(), p.code, p.name, p.loc, p.loc, p.cpu, p.gpu, p.ram,
            p.storage, p.os, p.ip, sha256(token),
            i === 5 ? "maintenance" : "available",
            p.h, p.d, p.w, p.m, p.desc,
          ]
        );
      }
      console.log("[SEED] demo PCs dibuat (SEED_DEMO_PCS=true).");
    }
  } else {
    console.log("[SEED] katalog kosong — PC real muncul otomatis saat agent connect.");
  }

  console.log("[SEED] selesai. Login superadmin:", adminUser);
}

if (import.meta.main) {
  const { closeDb } = await import("./index");
  await runSeed();
  await closeDb();
  process.exit(0);
}
