// Validasi env + default yang aman
function need(name: string, fallback = ""): string {
  const v = (process.env[name] ?? fallback).trim();
  return v;
}

export const env = {
  PORT: Number(need("PORT", "3000")) || 3000,
  APP_URL: need("APP_URL", "http://localhost:3000"),
  APP_NAME: need("APP_NAME", "Rental PC by Miriprian"),
  DATABASE_URL: need("DATABASE_URL", "file:./data/rentalrdp-pg"),
  JWT_SECRET: need("JWT_SECRET", ""),
  APP_KEY: need("APP_KEY", ""),
  SEED_ADMIN_USER: need("SEED_ADMIN_USER", "obake"),
  SEED_ADMIN_PASS: need("SEED_ADMIN_PASS", "obake"),
  SEED_ADMIN_EMAIL: need("SEED_ADMIN_EMAIL", "obake@rentalrdp.com"),
  CORS_ORIGIN: need("CORS_ORIGIN", "http://localhost:3000"),
  RATE_LIMIT_WINDOW_MS: Number(need("RATE_LIMIT_WINDOW_MS", "60000")) || 60000,
  RATE_LIMIT_MAX: Number(need("RATE_LIMIT_MAX", "120")) || 120,
  LOGIN_RATE_MAX: Number(need("LOGIN_RATE_MAX", "15")) || 15,
  COOKIE_SECURE: need("COOKIE_SECURE", "false") === "true",
  isPostgres: (process.env.DATABASE_URL ?? "").startsWith("postgres"),
};

export function assertEnv() {
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) {
    console.warn(
      "[SECURITY] JWT_SECRET kurang dari 32 karakter. Jalankan: bun run gen:secret lalu isi .env"
    );
  }
  if (!env.APP_KEY) {
    console.warn("[SECURITY] APP_KEY kosong — akan dibuat otomatis & disimpan ke .env");
  }
}
