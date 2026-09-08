import { db, mode, rawPool, pglite } from "./index";

// Helper query mentah yang jalan di postgres & pglite (keduanya $1-style)
export async function q(text: string, params: unknown[] = []) {
  if (mode === "postgres") return rawPool.query(text, params);
  return pglite.query(text, params);
}

export async function one<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T | null> {
  const r = await q(text, params);
  const rows = mode === "postgres" ? r.rows : (r.rows ?? r);
  return (rows?.[0] as T) ?? null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function all<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
  const r = await q(text, params);
  const rows = mode === "postgres" ? r.rows : (r.rows ?? r);
  return (rows ?? []) as T[];
}

export { db, mode };
