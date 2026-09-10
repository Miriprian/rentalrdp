import { env } from "../env";

// DB ganda: Postgres beneran (produksi) atau PGlite file (instan, tanpa install).
// Keduanya pakai dialek Postgres sehingga schema.ts sama persis — migrasi tinggal ganti DATABASE_URL.

type DbType = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  execute: (q: any) => Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export let db: any;
export let mode: "postgres" | "pglite" = "pglite";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export let rawPool: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export let pglite: any = null;

export async function initDb() {
  if (db) return db;
  const url = env.DATABASE_URL;

  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) {
    mode = "postgres";
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    rawPool = new Pool({
      connectionString: url,
      max: 10,
      ssl: url.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined,
    });
    db = drizzle(rawPool);
    console.log("[DB] mode=postgres (production)");
  } else {
    mode = "pglite";
    // file:./data/xxx  -> ./data/xxx
    const dir = url.startsWith("file:") ? url.slice(5) : "./data/rentalrdp-pg";
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const fs = await import("node:fs");
    const path = await import("node:path");
    const abs = path.isAbsolute(dir) ? dir : path.join(process.cwd(), dir);
    fs.mkdirSync(abs, { recursive: true });
    pglite = new PGlite(abs);
    await pglite.waitReady;
    db = drizzle(pglite);
    console.log(`[DB] mode=pglite instan (file: ${abs}) — kompatibel Postgres, siap migrasi ke Postgres kapan saja`);
  }
  await ensureSchema();
  return db;
}

const DDL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL DEFAULT '',
  wa_number TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'user',
  balance INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  failed_login INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMP,
  last_login_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS pcs (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT 'Jakarta',
  city TEXT NOT NULL DEFAULT 'Jakarta',
  cpu TEXT NOT NULL DEFAULT '',
  gpu TEXT NOT NULL DEFAULT '',
  motherboard TEXT NOT NULL DEFAULT '',
  hw_json TEXT NOT NULL DEFAULT '{}',
  ram_gb INTEGER NOT NULL DEFAULT 16,
  storage_gb INTEGER NOT NULL DEFAULT 512,
  storage_type TEXT NOT NULL DEFAULT 'NVMe SSD',
  os TEXT NOT NULL DEFAULT 'Windows 11 Pro',
  ip_public TEXT NOT NULL DEFAULT '',
  rdp_port INTEGER NOT NULL DEFAULT 3389,
  ssh_port INTEGER NOT NULL DEFAULT 22,
  agent_token_hash TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'available',
  price_hourly INTEGER NOT NULL DEFAULT 10000,
  price_daily INTEGER NOT NULL DEFAULT 75000,
  price_weekly INTEGER NOT NULL DEFAULT 350000,
  price_monthly INTEGER NOT NULL DEFAULT 1200000,
  description TEXT NOT NULL DEFAULT '',
  is_bare_metal BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_seen_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  duration_hours INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS vouchers (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  discount_percent INTEGER NOT NULL DEFAULT 0,
  max_discount_idr INTEGER NOT NULL DEFAULT 0,
  quota INTEGER NOT NULL DEFAULT 100,
  used_count INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMP,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  pc_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  duration_hours INTEGER NOT NULL,
  price_idr INTEGER NOT NULL,
  discount_idr INTEGER NOT NULL DEFAULT 0,
  total_idr INTEGER NOT NULL,
  voucher_code TEXT NOT NULL DEFAULT '',
  payment_method TEXT NOT NULL DEFAULT 'qris',
  payment_proof TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  note TEXT NOT NULL DEFAULT '',
  verified_by TEXT NOT NULL DEFAULT '',
  paid_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS rentals (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  pc_id TEXT NOT NULL,
  rdp_host TEXT NOT NULL,
  rdp_port INTEGER NOT NULL DEFAULT 3389,
  rdp_user TEXT NOT NULL,
  rdp_pass_enc TEXT NOT NULL,
  start_at TIMESTAMP NOT NULL DEFAULT NOW(),
  end_at TIMESTAMP NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  extended_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS agent_tasks (
  id TEXT PRIMARY KEY,
  pc_id TEXT NOT NULL,
  rental_id TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  result TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  claimed_at TIMESTAMP,
  done_at TIMESTAMP
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL DEFAULT '',
  actor_name TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  entity TEXT NOT NULL DEFAULT '',
  entity_id TEXT NOT NULL DEFAULT '',
  meta_json TEXT NOT NULL DEFAULT '{}',
  ip TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS agent_events (
  id TEXT PRIMARY KEY,
  pc_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'info',
  message TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agent_events_pc ON agent_events(pc_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_rentals_user ON rentals(user_id);
CREATE INDEX IF NOT EXISTS idx_rentals_pc ON rentals(pc_id);
CREATE INDEX IF NOT EXISTS idx_tasks_pc_status ON agent_tasks(pc_id, status);
CREATE INDEX IF NOT EXISTS idx_pcs_status ON pcs(status);
ALTER TABLE pcs ADD COLUMN IF NOT EXISTS ip_local TEXT NOT NULL DEFAULT '';
ALTER TABLE rent_accounts ADD COLUMN IF NOT EXISTS task_id TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS rent_accounts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL DEFAULT '',
  pc_id TEXT NOT NULL DEFAULT '',
  pc_code TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL,
  password_enc TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
-- Migrasi kolom detail hardware untuk DB yang sudah terlanjur dibuat
ALTER TABLE pcs ADD COLUMN IF NOT EXISTS motherboard TEXT NOT NULL DEFAULT '';
ALTER TABLE pcs ADD COLUMN IF NOT EXISTS hw_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE pcs ADD COLUMN IF NOT EXISTS net_download_mbps REAL NOT NULL DEFAULT 0;
ALTER TABLE pcs ADD COLUMN IF NOT EXISTS net_upload_mbps REAL NOT NULL DEFAULT 0;
ALTER TABLE pcs ADD COLUMN IF NOT EXISTS net_ping_ms REAL NOT NULL DEFAULT 0;
ALTER TABLE pcs ADD COLUMN IF NOT EXISTS net_tested_at TIMESTAMPTZ;
ALTER TABLE pcs ADD COLUMN IF NOT EXISTS agent_files_hash TEXT NOT NULL DEFAULT '';

-- Migrasi timezone: TIMESTAMP (naif) -> TIMESTAMPTZ (ber-offset UTC)
-- Nilai lama ditafsirkan sebagai UTC agar tampilan nanti di-localize ke jam pengguna.
ALTER TABLE users ALTER COLUMN locked_until TYPE TIMESTAMPTZ USING locked_until AT TIME ZONE 'UTC';
ALTER TABLE users ALTER COLUMN last_login_at TYPE TIMESTAMPTZ USING last_login_at AT TIME ZONE 'UTC';
ALTER TABLE users ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
ALTER TABLE users ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';
ALTER TABLE pcs ALTER COLUMN last_seen_at TYPE TIMESTAMPTZ USING last_seen_at AT TIME ZONE 'UTC';
ALTER TABLE pcs ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
ALTER TABLE pcs ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';
ALTER TABLE vouchers ALTER COLUMN expires_at TYPE TIMESTAMPTZ USING expires_at AT TIME ZONE 'UTC';
ALTER TABLE vouchers ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
ALTER TABLE orders ALTER COLUMN paid_at TYPE TIMESTAMPTZ USING paid_at AT TIME ZONE 'UTC';
ALTER TABLE orders ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
ALTER TABLE orders ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';
ALTER TABLE rentals ALTER COLUMN start_at TYPE TIMESTAMPTZ USING start_at AT TIME ZONE 'UTC';
ALTER TABLE rentals ALTER COLUMN end_at TYPE TIMESTAMPTZ USING end_at AT TIME ZONE 'UTC';
ALTER TABLE rentals ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
ALTER TABLE rentals ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';
ALTER TABLE agent_tasks ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
ALTER TABLE agent_tasks ALTER COLUMN claimed_at TYPE TIMESTAMPTZ USING claimed_at AT TIME ZONE 'UTC';
ALTER TABLE agent_tasks ALTER COLUMN done_at TYPE TIMESTAMPTZ USING done_at AT TIME ZONE 'UTC';
ALTER TABLE audit_logs ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
ALTER TABLE settings ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';
`;

export async function ensureSchema() {
  const statements = DDL.split(";").map((s) => s.trim()).filter(Boolean);
  for (const stmt of statements) {
    if (mode === "postgres") {
      await rawPool.query(stmt);
    } else {
      await pglite.exec(stmt + ";");
    }
  }
}

export async function closeDb() {
  try {
    if (mode === "postgres" && rawPool) await rawPool.end();
    if (mode === "pglite" && pglite) await pglite.close();
  } catch {}
}
