import { Elysia, t } from "elysia";
import { one, all, q } from "../db/query";
import { signSession, sessionCookie, clearSessionCookie, verifySession, getTokenFrom } from "../lib/auth";
import { rateLimit } from "../lib/rate-limit";
import { audit, clientIp } from "../lib/utils";
import { env } from "../env";

const usernameRe = /^[a-zA-Z0-9_.-]{3,24}$/;
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const authRoutes = new Elysia({ prefix: "/api/auth" })
  .post(
    "/register",
    async ({ body, request, set }) => {
      const ip = clientIp(request);
      const rl = rateLimit("reg:" + ip, 10, 60_000);
      if (!rl.ok) {
        set.status = 429;
        return { ok: false, message: "Terlalu sering. Coba lagi sebentar." };
      }
      const { username, email, password, fullName, waNumber } = body as Record<string, string>;
      if (!usernameRe.test(username || "")) {
        set.status = 400;
        return { ok: false, message: "Username 3-24 karakter (huruf/angka/._-)" };
      }
      if (!emailRe.test(email || "")) {
        set.status = 400;
        return { ok: false, message: "Email tidak valid" };
      }
      if (!password || password.length < 6) {
        set.status = 400;
        return { ok: false, message: "Password minimal 6 karakter" };
      }
      const u = String(username).toLowerCase().trim();
      const e = String(email).toLowerCase().trim();
      const exists = await one(`SELECT id FROM users WHERE username=$1 OR email=$2`, [u, e]);
      if (exists) {
        set.status = 409;
        return { ok: false, message: "Username/email sudah dipakai" };
      }
      const hash = await Bun.password.hash(password, { algorithm: "bcrypt", cost: 10 });
      const id = crypto.randomUUID();
      await q(
        `INSERT INTO users (id, username, email, password_hash, full_name, wa_number, role) VALUES ($1,$2,$3,$4,$5,$6,'user')`,
        [id, u, e, hash, String(fullName || "").slice(0, 80), String(waNumber || "").slice(0, 20)]
      );
      await audit("user.register", { actorId: id, actorName: u, entity: "users", entityId: id, ip });
      const token = await signSession({ id, username: u, role: "user" });
      set.headers["set-cookie"] = sessionCookie(token);
      return { ok: true, message: "Registrasi berhasil", token };
    },
    {
      body: t.Object({
        username: t.String(),
        email: t.String(),
        password: t.String(),
        fullName: t.Optional(t.String()),
        waNumber: t.Optional(t.String()),
      }),
    }
  )
  .post(
    "/login",
    async ({ body, request, set }) => {
      const ip = clientIp(request);
      const rl = rateLimit("login:" + ip, env.LOGIN_RATE_MAX, 60_000);
      if (!rl.ok) {
        set.status = 429;
        return { ok: false, message: "Terlalu banyak percobaan login. Tunggu 1 menit." };
      }
      const { username, password } = body as { username: string; password: string };
      const u = String(username || "").toLowerCase().trim();
      if (!u || !password) {
        set.status = 400;
        return { ok: false, message: "Username & password wajib" };
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const user = await one<any>(`SELECT * FROM users WHERE username=$1 OR email=$1`, [u]);
      if (!user) {
        set.status = 401;
        return { ok: false, message: "Username/password salah" };
      }
      if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
        set.status = 423;
        return { ok: false, message: "Akun terkunci sementara. Coba lagi nanti." };
      }
      if (!user.is_active) {
        set.status = 403;
        return { ok: false, message: "Akun dinonaktifkan. Hubungi admin." };
      }
      const ok = await Bun.password.verify(password, user.password_hash);
      if (!ok) {
        const failed = Number(user.failed_login || 0) + 1;
        const lock = failed >= 8 ? `, locked_until = NOW() + INTERVAL '10 minutes'` : "";
        await q(`UPDATE users SET failed_login=$1 ${lock} WHERE id=$2`, [failed, user.id]);
        await audit("user.login_failed", { actorName: u, entity: "users", entityId: user.id, ip });
        set.status = 401;
        return { ok: false, message: "Username/password salah" };
      }
      await q(`UPDATE users SET failed_login=0, locked_until=NULL, last_login_at=NOW() WHERE id=$1`, [user.id]);
      const token = await signSession({ id: user.id, username: user.username, role: user.role });
      set.headers["set-cookie"] = sessionCookie(token);
      await audit("user.login", { actorId: user.id, actorName: user.username, ip });
      return {
        ok: true,
        message: "Login berhasil",
        token,
        user: { id: user.id, username: user.username, email: user.email, role: user.role, fullName: user.full_name },
      };
    },
    { body: t.Object({ username: t.String(), password: t.String() }) }
  )
  .post("/logout", ({ set }) => {
    set.headers["set-cookie"] = clearSessionCookie();
    return { ok: true, message: "Logout berhasil" };
  })
  .get("/me", async ({ request }) => {
    const token = getTokenFrom(request);
    if (!token) return { ok: false, user: null };
    const sess = await verifySession(token);
    if (!sess) return { ok: false, user: null };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = await one<any>(`SELECT id, username, email, full_name, wa_number, role, balance, created_at FROM users WHERE id=$1`, [sess.id]);
    if (!user || user === null) return { ok: false, user: null };
    return { ok: true, user };
  })
  .post(
    "/change-password",
    async ({ body, request, set }) => {
      const token = getTokenFrom(request);
      const sess = token ? await verifySession(token) : null;
      if (!sess) {
        set.status = 401;
        return { ok: false, message: "Belum login" };
      }
      const { oldPassword, newPassword } = body as { oldPassword: string; newPassword: string };
      if (!newPassword || newPassword.length < 6) {
        set.status = 400;
        return { ok: false, message: "Password baru minimal 6 karakter" };
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const user = await one<any>(`SELECT * FROM users WHERE id=$1`, [sess.id]);
      if (!user) {
        set.status = 404;
        return { ok: false, message: "User tidak ditemukan" };
      }
      const ok = await Bun.password.verify(oldPassword || "", user.password_hash);
      if (!ok) {
        set.status = 401;
        return { ok: false, message: "Password lama salah" };
      }
      const hash = await Bun.password.hash(newPassword, { algorithm: "bcrypt", cost: 10 });
      await q(`UPDATE users SET password_hash=$1, updated_at=NOW() WHERE id=$2`, [hash, sess.id]);
      await audit("user.change_password", { actorId: sess.id, actorName: sess.username, ip: clientIp(request) });
      return { ok: true, message: "Password berhasil diubah" };
    },
    { body: t.Object({ oldPassword: t.String(), newPassword: t.String() }) }
  );
