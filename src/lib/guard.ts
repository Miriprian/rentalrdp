import { getTokenFrom, verifySession, type SessionUser } from "./auth";
import { one } from "../db/query";

export async function currentUser(req: Request): Promise<(SessionUser & { fullName?: string; email?: string }) | null> {
  const token = getTokenFrom(req);
  if (!token) return null;
  const sess = await verifySession(token);
  if (!sess) return null;
  // pastikan user masih aktif
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const u = await one<any>(`SELECT id, username, role, is_active FROM users WHERE id=$1`, [sess.id]);
  if (!u || !u.is_active) return null;
  return { ...sess, role: u.role };
}

export function isAdmin(role?: string) {
  return role === "admin" || role === "superadmin";
}
export function isSuper(role?: string) {
  return role === "superadmin";
}
