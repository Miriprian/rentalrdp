import { Elysia, t } from "elysia";
import { one, all, q } from "../db/query";
import { currentUser, isAdmin } from "../lib/guard";
import { audit, clientIp } from "../lib/utils";
import { sha256, randomToken } from "../lib/crypto";

function denied(set: { status?: number }) {
  set.status = 403;
  return { ok: false, message: "Akses ditolak (admin only)" };
}

// Kode otomatis (RDP-01, RDP-02, …) kalau admin tidak mengisi — spek tetap dari agent.
async function nextCode(): Promise<string> {
  const rows = await all(`SELECT code FROM pcs`);
  let max = 0;
  for (const r of rows as { code: string }[]) {
    const m = /^RDP-(\d+)$/i.exec(r.code);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  for (let i = max + 1; i < max + 100; i++) {
    const c = `RDP-${String(i).padStart(2, "0")}`;
    const ex = await one(`SELECT id FROM pcs WHERE code=$1`, [c]);
    if (!ex) return c;
  }
  return `RDP-${Date.now().toString().slice(-4)}`;
}

// Publik: list PC tersedia. Admin: full CRUD.
export const pcRoutes = new Elysia()
  .get("/api/public/pcs", async () => {
    const rows = await all(
      `SELECT id, code, name, location, city, cpu, gpu, ram_gb, storage_gb, storage_type, os, rdp_port, status, price_hourly, price_daily, price_weekly, price_monthly, description, is_bare_metal FROM pcs WHERE is_active=true ORDER BY code ASC`
    );
    return { ok: true, data: rows };
  })
  .get("/api/public/plans", async () => {
    const rows = await all(`SELECT * FROM plans WHERE is_active=true ORDER BY sort_order ASC`);
    return { ok: true, data: rows };
  })
  .get("/api/public/settings", async () => {
    const rows = await all(`SELECT key, value FROM settings`);
    const obj: Record<string, string> = {};
    for (const r of rows as { key: string; value: string }[]) obj[r.key] = r.value;
    return { ok: true, data: obj };
  })
  .get("/api/pcs", async ({ request, set }) => {
    const me = await currentUser(request);
    if (!me || !isAdmin(me.role)) return denied(set);
    const rows = await all(`SELECT * FROM pcs ORDER BY code ASC`);
    // jangan bocorkan hash token penuh ke admin biasa? superadmin boleh lihat last4
    return { ok: true, data: rows };
  })
  .get("/api/download/agent", async ({ set, request }) => {
    // Download agent .exe buat dipasang di PC fisik (publik, tidak butuh login)
    const fs = await import("node:fs");
    const path = await import("node:path");
    const file = path.join(process.cwd(), "agent", "rentalrdp-agent.exe");
    if (!fs.existsSync(file)) {
      set.status = 404;
      return { ok: false, message: "File agent belum ada di server. Jalankan: bun run agent:exe" };
    }
    const url = new URL(request.url);
    const check = url.searchParams.get("check") === "1";
    if (check) return { ok: true, file: "rentalrdp-agent.exe", sizeMb: Math.round(fs.statSync(file).size / 1024 / 1024) };
    set.headers["content-type"] = "application/octet-stream";
    set.headers["content-disposition"] = 'attachment; filename="rentalrdp-agent.exe"';
    set.headers["cache-control"] = "no-store";
    return Bun.file(file);
  })
  .post(
    "/api/pcs",
    async ({ body, request, set }) => {
      const me = await currentUser(request);
      if (!me || !isAdmin(me.role)) return denied(set);
      const b = body as Record<string, string | number>;
      let code = String(b.code || "").toUpperCase().trim();
      if (code && !/^[A-Z0-9-]{3,16}$/.test(code)) {
        set.status = 400;
        return { ok: false, message: "Kode PC 3-16 char (A-Z 0-9 -), contoh RDP-07" };
      }
      if (!code) code = await nextCode();
      const exists = await one(`SELECT id FROM pcs WHERE code=$1`, [code]);
      if (exists) {
        set.status = 409;
        return { ok: false, message: "Kode PC sudah dipakai" };
      }
      const id = crypto.randomUUID();
      const agentPlain = randomToken(24);
      await q(
        `INSERT INTO pcs (id, code, name, location, city, cpu, gpu, ram_gb, storage_gb, storage_type, os, ip_public, rdp_port, ssh_port, agent_token_hash, status, price_hourly, price_daily, price_weekly, price_monthly, description, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
        [
          id, code, String(b.name || code).slice(0, 80),
          String(b.location || "Jakarta").slice(0, 60), String(b.city || "Jakarta").slice(0, 60),
          String(b.cpu || "").slice(0, 120), String(b.gpu || "").slice(0, 120),
          Number(b.ramGb || 0), Number(b.storageGb || 0), String(b.storageType || "SSD").slice(0, 40),
          String(b.os || "").slice(0, 60), String(b.ipPublic || "").slice(0, 60),
          Number(b.rdpPort || 3389), Number(b.sshPort || 22),
          sha256(agentPlain), String(b.status || "offline").slice(0, 20),
          Number(b.priceHourly || 10000), Number(b.priceDaily || 75000),
          Number(b.priceWeekly || 350000), Number(b.priceMonthly || 1200000),
          String(b.description || "").slice(0, 2000),
          false, // hidden dari publik sampai agent pertama kali connect (spek real terisi)
        ]
      );
      await audit("pc.create", { actorId: me.id, actorName: me.username, entity: "pcs", entityId: id, meta: { code }, ip: clientIp(request) });
      return { ok: true, message: `PC ${code} dibuat. Pasang agent untuk mengisi spek otomatis.`, agentToken: agentPlain, id, code };
    },
    {
      body: t.Object({
        code: t.Optional(t.String()), name: t.Optional(t.String()),
        location: t.Optional(t.String()), city: t.Optional(t.String()),
        cpu: t.Optional(t.String()), gpu: t.Optional(t.String()),
        ramGb: t.Optional(t.Number()), storageGb: t.Optional(t.Number()),
        storageType: t.Optional(t.String()), os: t.Optional(t.String()),
        ipPublic: t.Optional(t.String()), rdpPort: t.Optional(t.Number()),
        sshPort: t.Optional(t.Number()), status: t.Optional(t.String()),
        priceHourly: t.Optional(t.Number()), priceDaily: t.Optional(t.Number()),
        priceWeekly: t.Optional(t.Number()), priceMonthly: t.Optional(t.Number()),
        description: t.Optional(t.String()),
      }),
    }
  )
  .patch(
    "/api/pcs/:id",
    async ({ params, body, request, set }) => {
      const me = await currentUser(request);
      if (!me || !isAdmin(me.role)) return denied(set);
      const b = body as Record<string, string | number | boolean>;
      const allow = ["name", "location", "city", "cpu", "gpu", "ram_gb", "storage_gb", "storage_type", "os", "ip_public", "rdp_port", "ssh_port", "status", "price_hourly", "price_daily", "price_weekly", "price_monthly", "description", "is_active"] as const;
      const map: Record<string, string> = { name: "name", location: "location", city: "city", cpu: "cpu", gpu: "gpu", ram_gb: "ram_gb", storage_gb: "storage_gb", storage_type: "storage_type", os: "os", ip_public: "ip_public", rdp_port: "rdp_port", ssh_port: "ssh_port", status: "status", price_hourly: "price_hourly", price_daily: "price_daily", price_weekly: "price_weekly", price_monthly: "price_monthly", description: "description", is_active: "is_active" };
      // normalisasi camelCase -> snake
      const norm: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(b)) {
        const snake = k.replace(/[A-Z]/g, (m) => "_" + m.toLowerCase());
        if ((allow as readonly string[]).includes(snake)) norm[map[snake]] = v;
      }
      if (norm.status && !["available", "rented", "maintenance", "offline"].includes(String(norm.status))) {
        set.status = 400;
        return { ok: false, message: "Status tidak valid" };
      }
      const keys = Object.keys(norm);
      if (keys.length === 0) {
        set.status = 400;
        return { ok: false, message: "Tidak ada field yang diubah" };
      }
      const sets = keys.map((k, i) => `${k}=$${i + 2}`).join(", ");
      await q(`UPDATE pcs SET ${sets}, updated_at=NOW() WHERE id=$1`, [params.id, ...keys.map((k) => norm[k])]);
      await audit("pc.update", { actorId: me.id, actorName: me.username, entity: "pcs", entityId: params.id, meta: norm, ip: clientIp(request) });
      return { ok: true, message: "PC diupdate" };
    },
    { body: t.Object({}, { additionalProperties: true }) }
  )
  .delete("/api/pcs/:id", async ({ params, request, set }) => {
    const me = await currentUser(request);
    if (!me || !isAdmin(me.role)) return denied(set);
    const rent = await one(`SELECT id FROM rentals WHERE pc_id=$1 AND status='active' LIMIT 1`, [params.id]);
    if (rent) {
      set.status = 400;
      return { ok: false, message: "PC sedang disewa aktif — terminate dulu" };
    }
    await q(`DELETE FROM pcs WHERE id=$1`, [params.id]);
    await audit("pc.delete", { actorId: me.id, actorName: me.username, entity: "pcs", entityId: params.id, ip: clientIp(request) });
    return { ok: true, message: "PC dihapus" };
  })
  .post("/api/pcs/:id/regen-token", async ({ params, request, set }) => {
    const me = await currentUser(request);
    if (!me || !isAdmin(me.role)) return denied(set);
    const pc = await one(`SELECT code FROM pcs WHERE id=$1`, [params.id]);
    if (!pc) {
      set.status = 404;
      return { ok: false, message: "PC tidak ditemukan" };
    }
    const plain = randomToken(24);
    await q(`UPDATE pcs SET agent_token_hash=$1, updated_at=NOW() WHERE id=$2`, [sha256(plain), params.id]);
    await audit("pc.regen_token", { actorId: me.id, actorName: me.username, entity: "pcs", entityId: params.id, ip: clientIp(request) });
    return { ok: true, code: pc.code, agentToken: plain, message: "Token agent baru dibuat. Pasang di PC bare metal." };
  });
