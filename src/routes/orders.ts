import { Elysia, t } from "elysia";
import { one, all, q } from "../db/query";
import { currentUser, isAdmin } from "../lib/guard";
import { audit, clientIp, orderCode, rupiah } from "../lib/utils";
import { encryptText, decryptText, randomPassword, sha256, randomToken } from "../lib/crypto";

function priceFor(pc: Record<string, number>, planCode: string): number {
  switch (planCode) {
    case "HOURLY": return Number(pc.price_hourly);
    case "DAILY": return Number(pc.price_daily);
    case "WEEKLY": return Number(pc.price_weekly);
    case "MONTHLY": return Number(pc.price_monthly);
    default: return Number(pc.price_daily);
  }
}

export const orderRoutes = new Elysia()
  // user bikin order
  .post(
    "/api/orders",
    async ({ body, request, set }) => {
      const me = await currentUser(request);
      if (!me) {
        set.status = 401;
        return { ok: false, message: "Login dulu untuk sewa" };
      }
      const b = body as { pcId: string; planCode: string; paymentMethod?: string; voucherCode?: string; note?: string };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pc = await one<any>(`SELECT * FROM pcs WHERE id=$1 AND is_active=true`, [b.pcId]);
      if (!pc) {
        set.status = 404;
        return { ok: false, message: "PC tidak ditemukan" };
      }
      if (pc.status !== "available") {
        set.status = 400;
        return { ok: false, message: `PC sedang ${pc.status}. Pilih unit lain.` };
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const plan = await one<any>(`SELECT * FROM plans WHERE code=$1 AND is_active=true`, [b.planCode]);
      if (!plan) {
        set.status = 400;
        return { ok: false, message: "Paket tidak valid" };
      }
      const price = priceFor(pc, plan.code);
      let discount = 0;
      let voucher = "";
      if (b.voucherCode) {
        voucher = String(b.voucherCode).toUpperCase().trim();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const v = await one<any>(`SELECT * FROM vouchers WHERE code=$1 AND is_active=true`, [voucher]);
        if (v && Number(v.used_count) < Number(v.quota) && (!v.expires_at || new Date(v.expires_at).getTime() > Date.now())) {
          discount = Math.min(Math.floor((price * Number(v.discount_percent)) / 100), Number(v.max_discount_idr || price));
        } else {
          voucher = "";
        }
      }
      const total = Math.max(price - discount, 0);
      const id = crypto.randomUUID();
      const code = orderCode();
      const pm = ["qris", "bca", "bri", "mandiri", "dana", "ovo", "manual"].includes(String(b.paymentMethod)) ? String(b.paymentMethod) : "qris";
      await q(
        `INSERT INTO orders (id, code, user_id, pc_id, plan_id, duration_hours, price_idr, discount_idr, total_idr, voucher_code, payment_method, status, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'waiting_verification',$12)`,
        [id, code, me.id, pc.id, plan.id, plan.duration_hours, price, discount, total, voucher, pm, String(b.note || "").slice(0, 500)]
      );
      if (voucher) {
        await q(`UPDATE vouchers SET used_count = used_count + 1 WHERE code=$1`, [voucher]);
      }
      await audit("order.create", { actorId: me.id, actorName: me.username, entity: "orders", entityId: id, meta: { code, pc: pc.code, plan: plan.code, total }, ip: clientIp(request) });
      return { ok: true, message: `Order ${code} dibuat. Total ${rupiah(total)}. Bayar lalu tunggu verifikasi admin.`, id, code, total };
    },
    { body: t.Object({ pcId: t.String(), planCode: t.String(), paymentMethod: t.Optional(t.String()), voucherCode: t.Optional(t.String()), note: t.Optional(t.String()) }) }
  )
  .get("/api/orders/mine", async ({ request }) => {
    const me = await currentUser(request);
    if (!me) return { ok: false, message: "Belum login", data: [] };
    const rows = await all(
      `SELECT o.*, p.code as pc_code, p.name as pc_name, pl.code as plan_code, pl.name as plan_name
       FROM orders o JOIN pcs p ON p.id=o.pc_id JOIN plans pl ON pl.id=o.plan_id
       WHERE o.user_id=$1 ORDER BY o.created_at DESC LIMIT 100`,
      [me.id]
    );
    return { ok: true, data: rows };
  })
  .post(
    "/api/orders/:id/proof",
    async ({ params, body, request, set }) => {
      const me = await currentUser(request);
      if (!me) {
        set.status = 401;
        return { ok: false, message: "Belum login" };
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const o = await one<any>(`SELECT * FROM orders WHERE id=$1 AND user_id=$2`, [params.id, me.id]);
      if (!o) {
        set.status = 404;
        return { ok: false, message: "Order tidak ditemukan" };
      }
      const proof = String((body as Record<string, string>).paymentProof || "").slice(0, 2000);
      if (!proof) {
        set.status = 400;
        return { ok: false, message: "Isi bukti bayar (no. ref / link / keterangan)" };
      }
      await q(`UPDATE orders SET payment_proof=$1, status='waiting_verification', updated_at=NOW() WHERE id=$2`, [proof, params.id]);
      await audit("order.proof", { actorId: me.id, actorName: me.username, entity: "orders", entityId: params.id, ip: clientIp(request) });
      return { ok: true, message: "Bukti bayar terkirim. Menunggu verifikasi admin." };
    },
    { body: t.Object({ paymentProof: t.String() }) }
  )
  // admin list
  .get("/api/admin/orders", async ({ request, set, query }) => {
    const me = await currentUser(request);
    if (!me || !isAdmin(me.role)) {
      set.status = 403;
      return { ok: false, message: "Admin only", data: [] };
    }
    const status = String((query as Record<string, string>).status || "");
    const where = status ? `WHERE o.status=$1` : "";
    const params = status ? [status] : [];
    const rows = await all(
      `SELECT o.*, p.code as pc_code, p.name as pc_name, u.username, u.wa_number, pl.code as plan_code
       FROM orders o JOIN pcs p ON p.id=o.pc_id JOIN users u ON u.id=o.user_id JOIN plans pl ON pl.id=o.plan_id
       ${where} ORDER BY o.created_at DESC LIMIT 200`,
      params
    );
    return { ok: true, data: rows };
  })
  // admin APPROVE -> buat rental + kredensial RDP + kunci PC + task agent
  .post("/api/admin/orders/:id/approve", async ({ params, request, set }) => {
    const me = await currentUser(request);
    if (!me || !isAdmin(me.role)) {
      set.status = 403;
      return { ok: false, message: "Admin only" };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const o = await one<any>(`SELECT * FROM orders WHERE id=$1`, [params.id]);
    if (!o) {
      set.status = 404;
      return { ok: false, message: "Order tidak ditemukan" };
    }
    if (!["pending", "waiting_verification", "paid"].includes(o.status)) {
      set.status = 400;
      return { ok: false, message: `Order status ${o.status} tidak bisa di-approve` };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pc = await one<any>(`SELECT * FROM pcs WHERE id=$1`, [o.pc_id]);
    if (!pc || pc.status !== "available") {
      set.status = 400;
      return { ok: false, message: "PC tidak available (sudah disewa / maintenance)" };
    }
    const rdpUser = `rdp_${Math.random().toString(36).slice(2, 8)}`;
    const rdpPass = randomPassword(14);
    const rdpPassEnc = await encryptText(rdpPass);
    const rentalId = crypto.randomUUID();
    const start = new Date();
    const end = new Date(start.getTime() + Number(o.duration_hours) * 3600 * 1000);
    await q(
      `INSERT INTO rentals (id, order_id, user_id, pc_id, rdp_host, rdp_port, rdp_user, rdp_pass_enc, start_at, end_at, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active')`,
      [rentalId, o.id, o.user_id, o.pc_id, pc.ip_public || pc.code, pc.rdp_port, rdpUser, rdpPassEnc, start, end]
    );
    await q(`UPDATE orders SET status='active', verified_by=$1, paid_at=COALESCE(paid_at, NOW()), updated_at=NOW() WHERE id=$2`, [me.username, o.id]);
    await q(`UPDATE pcs SET status='rented', updated_at=NOW() WHERE id=$1`, [o.pc_id]);
    // task untuk agent bare metal: buatkan user OS
    await q(
      `INSERT INTO agent_tasks (id, pc_id, rental_id, type, payload_json, status) VALUES ($1,$2,$3,'create_user',$4,'pending')`,
      [crypto.randomUUID(), o.pc_id, rentalId, JSON.stringify({ username: rdpUser, password: rdpPass })]
    );
    await audit("order.approve", { actorId: me.id, actorName: me.username, entity: "orders", entityId: o.id, meta: { rentalId, rdpUser }, ip: clientIp(request) });
    return { ok: true, message: `Order ${o.code} di-approve. Rental aktif sampai ${end.toLocaleString("id-ID")}.`, rentalId, rdpUser, rdpPass };
  })
  .post("/api/admin/orders/:id/reject", async ({ params, request, set }) => {
    const me = await currentUser(request);
    if (!me || !isAdmin(me.role)) {
      set.status = 403;
      return { ok: false, message: "Admin only" };
    }
    await q(`UPDATE orders SET status='rejected', verified_by=$1, updated_at=NOW() WHERE id=$2`, [me.username, params.id]);
    await audit("order.reject", { actorId: me.id, actorName: me.username, entity: "orders", entityId: params.id, ip: clientIp(request) });
    return { ok: true, message: "Order di-reject" };
  });
