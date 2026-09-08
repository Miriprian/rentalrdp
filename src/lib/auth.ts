import { SignJWT, jwtVerify } from "jose";
import { env } from "../env";

const secret = () => new TextEncoder().encode(env.JWT_SECRET || "dev-fallback-min-32-char-1234567890abcdef");

export type SessionUser = {
  id: string;
  username: string;
  role: string; // superadmin|admin|user
};

export async function signSession(u: SessionUser): Promise<string> {
  return await new SignJWT({ ...u })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret());
}

export async function verifySession(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    const { id, username, role } = payload as Record<string, string>;
    if (!id || !username || !role) return null;
    return { id, username, role };
  } catch {
    return null;
  }
}

export function getTokenFrom(req: Request): string | null {
  const cookie = req.headers.get("cookie") ?? "";
  const m = cookie.match(/(?:^|;\s*)rdp_session=([^;]+)/);
  if (m) {
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return m[1];
    }
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth.startsWith("Bearer ")) return auth.slice(7).trim();
  return null;
}

export function sessionCookie(token: string, maxAge = 7 * 24 * 3600): string {
  const parts = [
    `rdp_session=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (env.COOKIE_SECURE) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookie(): string {
  const parts = ["rdp_session=", "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (env.COOKIE_SECURE) parts.push("Secure");
  return parts.join("; ");
}
