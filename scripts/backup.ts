import { initDb, closeDb } from "../src/db/index";
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// Backup instan: copy folder data/ + dump settings info
await initDb();
const ts = new Date().toISOString().replace(/[:.]/g, "-");
const dir = join(process.cwd(), "backups", ts);
mkdirSync(dir, { recursive: true });
try {
  // PGlite file dir
  const { cpSync, existsSync } = await import("node:fs");
  if (existsSync(join(process.cwd(), "data"))) {
    cpSync(join(process.cwd(), "data"), join(dir, "data"), { recursive: true });
  }
  copyFileSync(join(process.cwd(), ".env"), join(dir, ".env.bak"));
  console.log(`✅ Backup tersimpan di ${dir}`);
} catch (e) {
  console.error("Backup gagal:", e);
}
await closeDb();
process.exit(0);
