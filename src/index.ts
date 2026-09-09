import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { staticPlugin } from "@elysiajs/static";
import { env, assertEnv } from "./env";
import { initDb } from "./db/index";
import { authRoutes } from "./routes/auth";
import { pcRoutes } from "./routes/pcs";
import { orderRoutes } from "./routes/orders";
import { rentalRoutes } from "./routes/rentals";
import { adminRoutes } from "./routes/admin";
import { agentRoutes } from "./routes/agent";
import { rateLimit } from "./lib/rate-limit";
import { q } from "./db/query";

assertEnv();
await initDb();

// Auto-online/offline: PC yang sudah dipasarkan tapi lama tanpa heartbeat
// (mati listrik / agent crash / internet offline) → status offline otomatis,
// sehingga tombol sewa mati & order ditolak. Pulih otomatis saat agent kembali.
const OFFLINE_AFTER_MS = 75_000;
setInterval(() => {
  q(`UPDATE pcs SET status='offline'
     WHERE is_active=true AND status='available'
       AND last_seen_at IS NOT NULL
       AND last_seen_at < NOW() - INTERVAL '${OFFLINE_AFTER_MS} milliseconds'`)
    .catch((e: unknown) => console.error("[auto-offline] gagal:", e));
}, 20_000);

// APP_KEY otomatis dibuat jika kosong
if (!env.APP_KEY) {
  const { randomBytes } = await import("node:crypto");
  const hex = randomBytes(32).toString("hex");
  try {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const envPath = path.join(process.cwd(), ".env");
    let content = "";
    try { content = fs.readFileSync(envPath, "utf8"); } catch { content = ""; }
    if (!content) {
      const ex = fs.readFileSync(path.join(process.cwd(), ".env.example"), "utf8");
      content = ex.replace(/^APP_KEY=.*$/m, `APP_KEY=${hex}`).replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${randomBytes(32).toString("hex")}`);
      fs.writeFileSync(envPath, content);
      console.log("[SETUP] .env dibuat otomatis (APP_KEY+JWT_SECRET random).");
    } else if (/^APP_KEY=\s*$/m.test(content)) {
      fs.writeFileSync(envPath, content.replace(/^APP_KEY=.*$/m, `APP_KEY=${hex}`));
      console.log("[SETUP] APP_KEY dibuat & disimpan ke .env");
      process.env.APP_KEY = hex;
    }
  } catch (e) {
    console.warn("[SETUP] gagal tulis .env:", e);
  }
}

const staticFiles = await staticPlugin({ assets: "public", prefix: "/", cache: false });

const app = new Elysia()
  // Security headers (helmet-style)
  .onRequest(({ request, set }) => {
    // Rate limit global ringan
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
    const path = new URL(request.url).pathname;
    if (path.startsWith("/api/")) {
      const rl = rateLimit("api:" + ip, env.RATE_LIMIT_MAX, env.RATE_LIMIT_WINDOW_MS);
      set.headers["X-RateLimit-Remaining"] = String(rl.remaining);
      if (!rl.ok) {
        set.status = 429;
        throw new Error("Terlalu banyak request. Tunggu sebentar.");
      }
    }
  })
  .onAfterHandle(({ set }) => {
    set.headers["X-Content-Type-Options"] = "nosniff";
    set.headers["X-Frame-Options"] = "DENY";
    set.headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
    set.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()";
    set.headers["X-Powered-By"] = "Rental PC by Miriprian";
    if (process.env.NODE_ENV === "production" || env.COOKIE_SECURE) {
      set.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
    }
  })
  .use(
    cors({
      origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN.split(",").map((s) => s.trim()),
      credentials: true,
    })
  )
  .use(staticFiles)
  .get("/api/health", () => ({
    ok: true,
    app: env.APP_NAME,
    time: new Date().toISOString(),
    bareMetal: true,
    virtual: false,
  }))
  .use(authRoutes)
  .use(pcRoutes)
  .use(orderRoutes)
  .use(rentalRoutes)
  .use(adminRoutes)
  .use(agentRoutes)
  // halaman utama + area terpisah: /app (user) dan /admin (admin)
  .get("/", () => Bun.file("public/index.html"))
  .get("/app", () => Bun.file("public/app.html"))
  .get("/dashboard", () => Bun.file("public/app.html"))
  .get("/admin", () => Bun.file("public/admin.html"))
  .get("/*", async ({ path }) => {
    if (path.startsWith("/api")) return { ok: false, message: "Not found" };
    if (path === "/app.js") return Bun.file("public/js/landing.js"); // legacy, jangan dipakai lagi
    if (path.startsWith("/admin")) return Bun.file("public/admin.html");
    if (path.startsWith("/app") || path.startsWith("/dashboard")) return Bun.file("public/app.html");
    return Bun.file("public/index.html");
  })
  .onError(({ error, set }) => {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("Terlalu banyak")) {
      set.status = 429;
      return { ok: false, message: msg };
    }
    console.error("[ERR]", msg);
    set.status = (set.status as number) || 500;
    return { ok: false, message: "Terjadi kesalahan server" };
  })
  .listen(env.PORT);

console.log(`\n  ✅ ${env.APP_NAME} jalan di ${app.server?.url ?? `http://localhost:${env.PORT}`}`);
console.log(`  🖥️  Bare Metal (fisik beneran, bukan virtual)`);
console.log(`  👑 Superadmin default: obake / obake  (SEGERA GANTI di dashboard > Ganti Password)\n`);
