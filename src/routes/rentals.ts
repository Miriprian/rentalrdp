import { Elysia } from "elysia";
import { one, all, q } from "../db/query";
import { currentUser, isAdmin } from "../lib/guard";
import { audit, clientIp } from "../lib/utils";
import { decryptText } from "../lib/crypto";

export const rentalRoutes = new Elysia()
  .get("/api/rentals/mine", async ({ request }) => {
    const me = await currentUser(request);
    if (!me) return { ok: false, message: "Belum login", data: [] };
    // auto-expire
    await q(`UPDATE rentals SET status='expired', updated_at=NOW() WHERE user_id=$1 AND status='active' AND end_at < NOW()`, [me.id]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await all<any>(
      `SELECT r.*, p.code as pc_code, p.name as pc_name, o.code as order_code
       FROM rentals r JOIN pcs p ON p.id=r.pc_id JOIN orders o ON o.id=r.order_id
       WHERE r.user_id=$1 ORDER BY r.created_at DESC LIMIT 100`,
      [me.id]
    );
    // decrypt password untuk owner
    for (const r of rows) {
      try {
        r.rdpPass = await decryptText(r.rdp_pass_enc);
      } catch {
        r.rdpPass = "";
      }
      delete r.rdp_pass_enc;
    }
    return { ok: true, data: rows };
  })
  .get("/api/admin/rentals", async ({ request, set }) => {
    const me = await currentUser(request);
    if (!me || !isAdmin(me.role)) {
      set.status = 403;
      return { ok: false, data: [] };
    }
    await q(`UPDATE rentals SET status='expired', updated_at=NOW() WHERE status='active' AND end_at < NOW()`);
    // kembalikan PC yang expired jadi available (jika tidak ada rental aktif lain)
    await q(
      `UPDATE pcs SET status='available', updated_at=NOW() WHERE status='rented' AND id NOT IN (SELECT pc_id FROM rentals WHERE status='active')`
    );
    const rows = await all(
      `SELECT r.*, p.code as pc_code, u.username FROM rentals r JOIN pcs p ON p.id=r.pc_id JOIN users u ON u.id=r.user_id ORDER BY r.created_at DESC LIMIT 200`
    );
    return { ok: true, data: rows };
  })
  .post("/api/admin/rentals/:id/terminate", async ({ params, request, set }) => {
    const me = await currentUser(request);
    if (!me || !isAdmin(me.role)) {
      set.status = 403;
      return { ok: false, message: "Admin only" };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await one<any>(`SELECT * FROM rentals WHERE id=$1`, [params.id]);
    if (!r) {
      set.status = 404;
      return { ok: false, message: "Rental tidak ditemukan" };
    }
    await q(`UPDATE rentals SET status='terminated', updated_at=NOW() WHERE id=$1`, [params.id]);
    await q(`UPDATE orders SET status='completed', updated_at=NOW() WHERE id=$1`, [r.order_id]);
    await q(`UPDATE pcs SET status='available', updated_at=NOW() WHERE id=$1 AND NOT EXISTS (SELECT 1 FROM rentals WHERE pc_id=$1 AND status='active' AND id<>$2)`, [r.pc_id, params.id]);
    await q(
      `INSERT INTO agent_tasks (id, pc_id, rental_id, type, payload_json, status) VALUES ($1,$2,$3,'delete_user',$4,'pending')`,
      [crypto.randomUUID(), r.pc_id, r.id, JSON.stringify({ username: r.rdp_user })]
    );
    await audit("rental.terminate", { actorId: me.id, actorName: me.username, entity: "rentals", entityId: params.id, ip: clientIp(request) });
    return { ok: true, message: "Rental di-terminate. User OS akan dihapus agent." };
  })
  .post("/api/rentals/:id/extend", async ({ params, request, set, body }) => {
    const me = await currentUser(request);
    if (!me) {
      set.status = 401;
      return { ok: false, message: "Belum login" };
    }
    const hours = Number((body as Record<string, unknown>)?.hours || 24);
    if (![1, 24, 168, 720].includes(hours)) {
      set.status = 400;
      return { ok: false, message: "Durasi extend: 1 / 24 / 168 / 720 jam" };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await one<any>(`SELECT * FROM rentals WHERE id=$1 AND user_id=$2`, [params.id, me.id]);
    if (!r) {
      set.status = 404;
      return { ok: false, message: "Rental tidak ditemukan" };
    }
    if (r.status !== "active") {
      set.status = 400;
      return { ok: false, message: "Hanya rental aktif yang bisa diperpanjang" };
    }
    await q(`UPDATE rentals SET end_at = end_at + ($1 || ' hours')::interval, extended_count = extended_count + 1, updated_at=NOW() WHERE id=$2`, [String(hours), params.id]);
    await audit("rental.extend", { actorId: me.id, actorName: me.username, entity: "rentals", entityId: params.id, meta: { hours }, ip: clientIp(request) });
    return { ok: true, message: `Diperpanjang +${hours} jam. Bayar selisih via WA admin.` };
  });
