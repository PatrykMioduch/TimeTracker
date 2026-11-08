import type { TimeEntry, User } from "../types";

const SELECT = `SELECT e.*, p.name AS project_name, p.color AS project_color, u.login AS user_login
                  FROM time_entries e
                  JOIN projects p ON p.id = e.project_id
                  JOIN users u ON u.id = e.user_id`;

export async function getRunning(db: D1Database, userId: number): Promise<TimeEntry | null> {
  return (
    (await db
      .prepare(`${SELECT} WHERE e.user_id = ? AND e.started_at IS NOT NULL AND e.ended_at IS NULL`)
      .bind(userId)
      .first<TimeEntry>()) ?? null
  );
}

export async function listForProject(db: D1Database, projectId: number, user: User, limit = 50): Promise<TimeEntry[]> {
  const sql = user.is_admin
    ? `${SELECT} WHERE e.project_id = ? ORDER BY e.entry_date DESC, e.id DESC LIMIT ?`
    : `${SELECT} WHERE e.project_id = ? AND e.user_id = ? ORDER BY e.entry_date DESC, e.id DESC LIMIT ?`;
  const stmt = user.is_admin ? db.prepare(sql).bind(projectId, limit) : db.prepare(sql).bind(projectId, user.id, limit);
  const { results } = await stmt.all<TimeEntry>();
  return results;
}

export async function getEntry(db: D1Database, id: number): Promise<TimeEntry | null> {
  return (await db.prepare(`${SELECT} WHERE e.id = ?`).bind(id).first<TimeEntry>()) ?? null;
}

export async function insertDuration(
  db: D1Database,
  p: { projectId: number; userId: number; entryDate: string; durationSec: number; note: string },
): Promise<void> {
  await db
    .prepare("INSERT INTO time_entries (project_id, user_id, entry_date, duration_sec, note) VALUES (?, ?, ?, ?, ?)")
    .bind(p.projectId, p.userId, p.entryDate, p.durationSec, p.note)
    .run();
}

export async function insertRange(
  db: D1Database,
  p: { projectId: number; userId: number; entryDate: string; startedAt: string; endedAt: string; durationSec: number; note: string },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO time_entries (project_id, user_id, entry_date, started_at, ended_at, duration_sec, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(p.projectId, p.userId, p.entryDate, p.startedAt, p.endedAt, p.durationSec, p.note)
    .run();
}

/** Zwraca false, gdy użytkownik ma już biegnący timer (indeks unikalny). */
export async function startTimer(
  db: D1Database,
  p: { projectId: number; userId: number; entryDate: string; startedAt: string; note: string },
): Promise<boolean> {
  try {
    await db
      .prepare("INSERT INTO time_entries (project_id, user_id, entry_date, started_at, note) VALUES (?, ?, ?, ?, ?)")
      .bind(p.projectId, p.userId, p.entryDate, p.startedAt, p.note)
      .run();
    return true;
  } catch (err) {
    if (String(err).includes("UNIQUE")) return false;
    throw err;
  }
}

export async function stopTimer(db: D1Database, userId: number, endedAt: string): Promise<TimeEntry | null> {
  const running = await getRunning(db, userId);
  if (!running) return null;
  const duration = Math.max(1, Math.round((Date.parse(endedAt) - Date.parse(running.started_at!)) / 1000));
  await db
    .prepare("UPDATE time_entries SET ended_at = ?, duration_sec = ? WHERE id = ? AND ended_at IS NULL")
    .bind(endedAt, duration, running.id)
    .run();
  return { ...running, ended_at: endedAt, duration_sec: duration };
}

export async function deleteEntry(db: D1Database, id: number): Promise<void> {
  await db.prepare("DELETE FROM time_entries WHERE id = ?").bind(id).run();
}

export async function listForUser(db: D1Database, userId: number, limit = 300): Promise<TimeEntry[]> {
  const { results } = await db
    .prepare(`${SELECT} WHERE e.user_id = ? AND (e.ended_at IS NOT NULL OR e.started_at IS NULL)
              ORDER BY e.entry_date DESC, COALESCE(e.started_at, e.created_at) DESC, e.id DESC LIMIT ?`)
    .bind(userId, limit)
    .all<TimeEntry>();
  return results;
}

export async function updateEntry(
  db: D1Database,
  id: number,
  p: { projectId: number; entryDate: string; startedAt: string | null; endedAt: string | null; durationSec: number; note: string },
): Promise<void> {
  await db
    .prepare(
      `UPDATE time_entries SET project_id = ?, entry_date = ?, started_at = ?, ended_at = ?, duration_sec = ?, note = ?
        WHERE id = ? AND (ended_at IS NOT NULL OR started_at IS NULL)`,
    )
    .bind(p.projectId, p.entryDate, p.startedAt, p.endedAt, p.durationSec, p.note, id)
    .run();
}
