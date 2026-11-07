import type { User } from "../types";

export type UserRow = User & { password_hash: string | null; salt: string | null; created_at: string };

export async function findByLogin(db: D1Database, login: string): Promise<UserRow | null> {
  return (await db.prepare("SELECT * FROM users WHERE login = ?").bind(login).first<UserRow>()) ?? null;
}

export async function listUsers(db: D1Database): Promise<UserRow[]> {
  const { results } = await db.prepare("SELECT * FROM users ORDER BY is_admin DESC, login").all<UserRow>();
  return results;
}

export async function listActiveUsers(db: D1Database): Promise<User[]> {
  const { results } = await db
    .prepare("SELECT id, login, is_admin, active FROM users WHERE active = 1 ORDER BY login")
    .all<User>();
  return results;
}

/** Admin z ENV: zapewnia wiersz w users, żeby wpisy czasu miały user_id. */
export async function ensureAdminUser(db: D1Database, login: string): Promise<User> {
  await db
    .prepare(
      `INSERT INTO users (login, is_admin, active) VALUES (?, 1, 1)
       ON CONFLICT(login) DO UPDATE SET is_admin = 1, active = 1`,
    )
    .bind(login)
    .run();
  const row = await db.prepare("SELECT id, login, is_admin, active FROM users WHERE login = ?").bind(login).first<User>();
  if (!row) throw new Error("admin upsert failed");
  return row;
}

export async function createUser(db: D1Database, login: string, hash: string, salt: string): Promise<number> {
  const res = await db
    .prepare("INSERT INTO users (login, password_hash, salt) VALUES (?, ?, ?)")
    .bind(login, hash, salt)
    .run();
  return res.meta.last_row_id;
}

export async function setPassword(db: D1Database, id: number, hash: string, salt: string): Promise<void> {
  await db.prepare("UPDATE users SET password_hash = ?, salt = ? WHERE id = ? AND is_admin = 0").bind(hash, salt, id).run();
}

export async function toggleActive(db: D1Database, id: number): Promise<void> {
  await db.prepare("UPDATE users SET active = CASE active WHEN 1 THEN 0 ELSE 1 END WHERE id = ? AND is_admin = 0").bind(id).run();
  await db.prepare("DELETE FROM sessions WHERE user_id = ? AND (SELECT active FROM users WHERE id = ?) = 0").bind(id, id).run();
}
