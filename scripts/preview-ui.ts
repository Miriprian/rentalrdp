// Isolated UI preview. Never opens or modifies the project's real database.
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const tempRoot = process.platform === "win32"
  ? join(process.env.LOCALAPPDATA!, "Temp", "opencode")
  : tmpdir();
const database = mkdtempSync(join(tempRoot, "rentalrdp-ui-"));
process.env.DATABASE_URL = "file:" + join(database, "pg");
process.env.PORT = "3100";
process.env.APP_URL = "http://localhost:3100";
process.env.CORS_ORIGIN = "http://localhost:3100";
process.env.JWT_SECRET = crypto.randomUUID() + crypto.randomUUID();
process.env.APP_KEY = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
process.env.COOKIE_SECURE = "false";
// A browser regression visits many screens quickly; production limits stay untouched.
process.env.RATE_LIMIT_MAX = "10000";
process.env.LOGIN_RATE_MAX = "1000";
process.env.SEED_ADMIN_USER = "obake";
process.env.SEED_ADMIN_PASS = "obake";
process.env.SEED_DEMO_PCS = "true";

const { runSeed } = await import("../src/db/seed");
await runSeed();
const { q } = await import("../src/db/query");
await q("UPDATE settings SET value=$1 WHERE key='notice'", ["PREVIEW ONLY — Data contoh untuk pengujian tampilan. Bukan unit yang ditawarkan."]);
await q("UPDATE pcs SET name=$1, cpu=$2, gpu=$3 WHERE code='RDP-01'", ["Studio / Ryzen 7", "AMD Ryzen 7 7800X3D", "NVIDIA GeForce RTX 4070"]);
await q("UPDATE pcs SET name=$1 WHERE code='RDP-02'", ["Everyday / Intel i7"]);
await q("UPDATE pcs SET name=$1 WHERE code='RDP-03'", ["Pro / Ryzen 9"]);
await import("../src/index");
console.log("[UI PREVIEW] http://localhost:3100 — isolated test database:", database);
