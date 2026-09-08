// In-memory sliding-window rate limiter (cukup untuk single-node produksi kecil-menengah).
// Untuk scale multi-node, ganti dengan Redis.

type Bucket = { count: number; reset: number };
const buckets = new Map<string, Bucket>();

export function rateLimit(key: string, max: number, windowMs: number): { ok: boolean; remaining: number; resetMs: number } {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now > b.reset) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return { ok: true, remaining: max - 1, resetMs: windowMs };
  }
  if (b.count >= max) {
    return { ok: false, remaining: 0, resetMs: b.reset - now };
  }
  b.count += 1;
  return { ok: true, remaining: max - b.count, resetMs: b.reset - now };
}

// bersihkan bucket kadaluarsa tiap menit agar memori stabil
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (now > b.reset) buckets.delete(k);
}, 60_000).unref?.();
