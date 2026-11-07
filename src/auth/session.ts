import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { AppEnv, User } from "../types";

const COOKIE = "sid";
const TTL_DAYS = 30;

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createSession(c: Context<AppEnv>, userId: number): Promise<void> {
  const id = randomId();
  const expires = new Date(Date.now() + TTL_DAYS * 86400_000);
  await c.env.DB.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(id, userId, expires.toISOString())
    .run();
  setCookie(c, COOKIE, id, {
    httpOnly: true,
    sameSite: "Lax",
    secure: new URL(c.req.url).protocol === "https:",
    path: "/",
    expires,
  });
}

export async function getSessionUser(c: Context<AppEnv>): Promise<User | null> {
  const sid = getCookie(c, COOKIE);
  if (!sid) return null;
  const row = await c.env.DB.prepare(
    `SELECT u.id, u.login, u.is_admin, u.active
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ? AND s.expires_at > ? AND u.active = 1`,
  )
    .bind(sid, new Date().toISOString())
    .first<User>();
  return row ?? null;
}

export async function destroySession(c: Context<AppEnv>): Promise<void> {
  const sid = getCookie(c, COOKIE);
  if (sid) await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(sid).run();
  deleteCookie(c, COOKIE, { path: "/" });
}
