import type { Config } from "drizzle-kit";

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // drizzle-kit hanya dipakai saat DATABASE_URL postgres beneran.
    // Mode instan (PGlite file:) tidak butuh drizzle-kit, migrasi otomatis via ensureSchema().
    url: process.env.DATABASE_URL?.startsWith("postgres")
      ? process.env.DATABASE_URL
      : "postgres://localhost:5432/rentalrdp",
  },
} satisfies Config;
