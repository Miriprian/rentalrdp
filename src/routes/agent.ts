import { Elysia, t } from "elysia";
import { one, all, q } from "../db/query";
import { sha256 } from "../lib/crypto";

// Agent di PC bare metal (fisik) polling ke sini.
// Auth: header x-agent-token (plain) dicocokkan dengan hash di DB.

async function authPc(req: Request) {
  const token = req.headers.get("x-agent-token") || "";
  if (!token) return null;
  const h = sha256(token);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pc = await one<any>(`SELECT * FROM pcs WHERE agent_token_hash=$1`, [h]);
  return pc;
}

export const agentRoutes = new Elysia()
  .post("/api/agent/heartbeat", async ({ request, set, body }) => {
    const pc = await authPc(request);
    if (!pc) {
      set.status = 401;
      return { ok: false, message: "Token agent salah" };
    }
    const b = (body || {}) as Record<string, unknown>;
    // Koneksi pertama agent → PC "online" tapi BELUM dipasarkan (is_active tetap false)
    // sampai admin klik "Pasarkan" (supaya katalog publik hanya untuk PC siap sewa).
    const firstConnect = !pc.last_seen_at;
    const sets: string[] = ["last_seen_at=NOW()", "updated_at=NOW()"];
    if (firstConnect && pc.status === "offline") sets.push("status='available'");
    // Auto-update spek REAL dari agent (hanya isi yang bukan kosong)
    const params: unknown[] = [];
    const stringMap: Record<string, unknown> = {
      cpu: b.cpu, gpu: b.gpu, os: b.os, storage_type: b.storageType,
      ip_public: b.ipPublic, location: b.location, name: b.name,
    };
    for (const [col, val] of Object.entries(stringMap)) {
      if (typeof val === "string" && val.trim() && val.trim().length >= 2) {
        params.push(val.trim().slice(0, 200));
        sets.push(`${col}=$${params.length + 1}`);
      }
    }
    if (typeof b.ramGb === "number" && b.ramGb > 0) {
      params.push(Math.round(Number(b.ramGb)));
      sets.push(`ram_gb=$${params.length + 1}`);
    }
    if (typeof b.storageGb === "number" && b.storageGb > 0) {
      params.push(Math.round(Number(b.storageGb)));
      sets.push(`storage_gb=$${params.length + 1}`);
    }
    await q(`UPDATE pcs SET ${sets.join(", ")} WHERE id=$1`, [pc.id, ...params]);
    return {
      ok: true,
      serverTime: new Date().toISOString(),
      bareMetal: true,
      virtual: false,
      registeredAs: pc.code,
    };
  }, { body: t.Optional(t.Object({}, { additionalProperties: true })) })
  .get("/api/agent/tasks", async ({ request, set }) => {
    const pc = await authPc(request);
    if (!pc) {
      set.status = 401;
      return { ok: false, message: "Token agent salah" };
    }
    const rows = await all(`SELECT * FROM agent_tasks WHERE pc_id=$1 AND status='pending' ORDER BY created_at ASC LIMIT 10`, [pc.id]);
    if (rows.length > 0) {
      const ids = rows.map((r: { id: string }) => r.id);
      // tandai claimed agar tidak double-eksekusi
      for (const id of ids) {
        await q(`UPDATE agent_tasks SET status='claimed', claimed_at=NOW() WHERE id=$1`, [id]);
      }
    }
    return { ok: true, tasks: rows };
  })
  .post(
    "/api/agent/tasks/:id/complete",
    async ({ params, request, set, body }) => {
      const pc = await authPc(request);
      if (!pc) {
        set.status = 401;
        return { ok: false, message: "Token agent salah" };
      }
      const b = body as { ok?: boolean; result?: string };
      await q(`UPDATE agent_tasks SET status=$1, result=$2, done_at=NOW() WHERE id=$3 AND pc_id=$4`, [
        b.ok === false ? "failed" : "done",
        String(b.result || "").slice(0, 2000),
        params.id,
        pc.id,
      ]);
      return { ok: true };
    },
    { body: t.Object({ ok: t.Optional(t.Boolean()), result: t.Optional(t.String()) }) }
  );
