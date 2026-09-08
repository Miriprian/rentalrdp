import { Elysia, t } from "elysia";
import { one, all, q } from "../db/query";
import { currentUser, isAdmin, isSuper } from "../lib/guard";
import { audit, clientIp } from "../lib/utils";
import { sha256 } from "../lib/crypto";

export const adminRoutes = new Elysia()
  .get("/api/admin/stats", async ({ request, set }) => {
    const me = await currentUser(request);
    if (!me || !isAdmin(me.role)) {
      set.status = 403;
      return { ok: false };
    }
    const [[u], [p], [o], [r], [rev]] = await Promise.all([
      all(`SELECT COUNT(*)::int as c FROM users`),
      all(`SELECT COUNT(*)::int as c FROM pcs`),
      all(`SELECT COUNT(*)::int as c FROM orders WHERE status IN ('waiting_verification','pending')`),
      all(`SELECT COUNT(*)::int as c FROM rentals WHERE status='active'`),
      all(`SELECT COALESCE(SUM(total_idr),0)::int as s FROM orders WHERE status IN ('active','completed','paid')`),
    ] as unknown as { c: number }[][][] as never as [{ c: number }[]][]);
    // status breakdown
    const pcsBy = await all(`SELECT status, COUNT(*)::int as c FROM pcs GROUP BY status`);
    return {
      ok: true,
      data: {
        users: (u as unknown as { c: number }).c ?? 0,
        pcs: (p as unknown as { c: number }).c ?? 0,
        pendingOrders: (o as unknown as { c: number }).c ?? 0,
        activeRentals: (r as unknown as { c: number }).c ?? 0,
        revenue: (rev as unknown as { s: number }).s ?? 0,
        pcsBy,
      },
    };
  })
  .get("/api/admin/users", async ({ request, set }) => {
    const me = await currentUser(request);
    if (!me || !isAdmin(me.role)) {
      set.status = 403;
      return { ok: false, data: [] };
    }
    const rows = await all(`SELECT id, username, email, full_name, wa_number, role, balance, is_active, last_login_at, created_at FROM users ORDER BY created_at DESC LIMIT 200`);
    return { ok: true, data: rows };
  })
  .patch(
    "/api/admin/users/:id",
    async ({ params, body, request, set }) => {
      const me = await currentUser(request);
      if (!me || !isAdmin(me.role)) {
        set.status = 403;
        return { ok: false, message: "Admin only" };
      }
      const b = body as { role?: string; isActive?: boolean; fullName?: string };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const target = await one<any>(`SELECT * FROM users WHERE id=$1`, [params.id]);
      if (!target) {
        set.status = 404;
        return { ok: false, message: "User tidak ditemukan" };
      }
      if (target.username === "obake" && !isSuper(me.role)) {
        set.status = 403;
        return { ok: false, message: "Hanya superadmin yang bisa ubah akun obake" };
      }
      if (b.role && !["user", "admin", "superadmin"].includes(b.role)) {
        set.status = 400;
        return { ok: false, message: "Role tidak valid" };
      }
      if (b.role === "superadmin" && !isSuper(me.role)) {
        set.status = 403;
        return { ok: false, message: "Hanya superadmin yang bisa angkat superadmin" };
      }
      await q(
        `UPDATE users SET role=COALESCE($1,role), is_active=COALESCE($2,is_active), full_name=COALESCE($3,full_name), updated_at=NOW() WHERE id=$4`,
        [b.role ?? null, b.isActive ?? null, b.fullName ?? null, params.id]
      );
      await audit("admin.user_update", { actorId: me.id, actorName: me.username, entity: "users", entityId: params.id, meta: b, ip: clientIp(request) });
      return { ok: true, message: "User diupdate" };
    },
    { body: t.Object({ role: t.Optional(t.String()), isActive: t.Optional(t.Boolean()), fullName: t.Optional(t.String()) }) }
  )
  .post(
    "/api/admin/users/:id/reset-password",
    async ({ params, body, request, set }) => {
      const me = await currentUser(request);
      if (!me || !isAdmin(me.role)) {
        set.status = 403;
        return { ok: false, message: "Admin only" };
      }
      const np = String((body as Record<string, string>).newPassword || "");
      if (np.length < 6) {
        set.status = 400;
        return { ok: false, message: "Password minimal 6 karakter" };
      }
      const hash = await Bun.password.hash(np, { algorithm: "bcrypt", cost: 10 });
      await q(`UPDATE users SET password_hash=$1, failed_login=0, locked_until=NULL WHERE id=$2`, [hash, params.id]);
      await audit("admin.reset_password", { actorId: me.id, actorName: me.username, entity: "users", entityId: params.id, ip: clientIp(request) });
      return { ok: true, message: "Password user di-reset" };
    },
    { body: t.Object({ newPassword: t.String() }) }
  )
  .get("/api/admin/audit", async ({ request, set }) => {
    const me = await currentUser(request);
    if (!me || !isAdmin(me.role)) {
      set.status = 403;
      return { ok: false, data: [] };
    }
    const rows = await all(`SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 200`);
    return { ok: true, data: rows };
  })
  .get("/api/admin/settings", async ({ request, set }) => {
    const me = await currentUser(request);
    if (!me || !isAdmin(me.role)) {
      set.status = 403;
      return { ok: false, data: {} };
    }
    const rows = await all<{ key: string; value: string }>(`SELECT key, value FROM settings`);
    const obj: Record<string, string> = {};
    for (const r of rows) obj[r.key] = r.value;
    return { ok: true, data: obj };
  })
  .post(
    "/api/admin/settings",
    async ({ body, request, set }) => {
      const me = await currentUser(request);
      if (!me || !isAdmin(me.role)) {
        set.status = 403;
        return { ok: false, message: "Admin only" };
      }
      const b = body as Record<string, string>;
      for (const [k, v] of Object.entries(b).slice(0, 30)) {
        if (!/^[a-z0-9_]{2,40}$/.test(k)) continue;
        await q(`INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()`, [k, String(v).slice(0, 2000)]);
      }
      await audit("admin.settings", { actorId: me.id, actorName: me.username, meta: Object.keys(b), ip: clientIp(request) });
      return { ok: true, message: "Settings disimpan" };
    },
    { body: t.Object({}, { additionalProperties: true }) }
  )
  .get("/api/admin/vouchers", async ({ request, set }) => {
    const me = await currentUser(request);
    if (!me || !isAdmin(me.role)) {
      set.status = 403;
      return { ok: false, data: [] };
    }
    return { ok: true, data: await all(`SELECT * FROM vouchers ORDER BY created_at DESC`) };
  })
  .post(
    "/api/admin/vouchers",
    async ({ body, request, set }) => {
      const me = await currentUser(request);
      if (!me || !isAdmin(me.role)) {
        set.status = 403;
        return { ok: false, message: "Admin only" };
      }
      const b = body as { code: string; discountPercent: number; maxDiscountIdr?: number; quota?: number };
      const code = String(b.code || "").toUpperCase().trim();
      if (!/^[A-Z0-9]{4,16}$/.test(code)) {
        set.status = 400;
        return { ok: false, message: "Kode 4-16 char A-Z 0-9" };
      }
      await q(`INSERT INTO vouchers (id, code, discount_percent, max_discount_idr, quota) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (code) DO UPDATE SET discount_percent=$3, max_discount_idr=$4, quota=$5`, [crypto.randomUUID(), code, Number(b.discountPercent || 0), Number(b.maxDiscountIdr || 0), Number(b.quota || 100)]);
      await audit("admin.voucher", { actorId: me.id, actorName: me.username, meta: { code }, ip: clientIp(request) });
      return { ok: true, message: `Voucher ${code} disimpan` };
    },
    { body: t.Object({ code: t.String(), discountPercent: t.Number(), maxDiscountIdr: t.Optional(t.Number()), quota: t.Optional(t.Number()) }) }
  );
