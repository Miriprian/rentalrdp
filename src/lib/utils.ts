import { db, mode, rawPool, pglite } from "../db/index";

async function q(text: string, params: unknown[] = []) {
  if (mode === "postgres") {
    return rawPool.query(text, params);
  }
  // pglite
  return pglite.query(text, params);
}

export async function audit(
  action: string,
  opts: {
    actorId?: string;
    actorName?: string;
    entity?: string;
    entityId?: string;
    meta?: unknown;
    ip?: string;
  } = {}
) {
  try {
    const id = crypto.randomUUID();
    await q(
      `INSERT INTO audit_logs (id, actor_id, actor_name, action, entity, entity_id, meta_json, ip) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        id,
        opts.actorId ?? "",
        opts.actorName ?? "",
        action,
        opts.entity ?? "",
        opts.entityId ?? "",
        JSON.stringify(opts.meta ?? {}),
        opts.ip ?? "",
      ]
    );
  } catch (e) {
    console.error("[audit] gagal:", e);
  }
}

export function clientIp(req: Request): string {
  const h = (n: string) => req.headers.get(n) ?? "";
  return h("x-forwarded-for").split(",")[0].trim() || h("x-real-ip") || "local";
}

export function orderCode(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `ORD-${date}-${rand}`;
}

export function esc(s: unknown): string {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function rupiah(n: number): string {
  return "Rp" + Number(n || 0).toLocaleString("id-ID");
}
