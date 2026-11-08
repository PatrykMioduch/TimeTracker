import type { Project, User } from "../types";

export async function listProjectsForUser(db: D1Database, user: User): Promise<Project[]> {
  if (user.is_admin) {
    const { results } = await db.prepare("SELECT * FROM projects WHERE active = 1 ORDER BY name").all<Project>();
    return results;
  }
  const { results } = await db
    .prepare(
      `SELECT p.* FROM projects p
         JOIN project_members m ON m.project_id = p.id
        WHERE m.user_id = ? AND p.active = 1
        ORDER BY p.name`,
    )
    .bind(user.id)
    .all<Project>();
  return results;
}

export async function listAllProjects(db: D1Database): Promise<Project[]> {
  const { results } = await db.prepare("SELECT * FROM projects ORDER BY active DESC, name").all<Project>();
  return results;
}

export async function getProject(db: D1Database, id: number): Promise<Project | null> {
  return (await db.prepare("SELECT * FROM projects WHERE id = ?").bind(id).first<Project>()) ?? null;
}

export async function canAccessProject(db: D1Database, user: User, projectId: number): Promise<boolean> {
  if (user.is_admin) return true;
  const row = await db
    .prepare("SELECT 1 AS ok FROM project_members WHERE project_id = ? AND user_id = ?")
    .bind(projectId, user.id)
    .first();
  return !!row;
}

export async function createProject(db: D1Database, name: string, description: string): Promise<number> {
  const res = await db.prepare("INSERT INTO projects (name, description) VALUES (?, ?)").bind(name, description).run();
  return res.meta.last_row_id;
}

export async function updateProject(db: D1Database, id: number, name: string, description: string): Promise<void> {
  await db.prepare("UPDATE projects SET name = ?, description = ? WHERE id = ?").bind(name, description, id).run();
}

export async function toggleProject(db: D1Database, id: number): Promise<void> {
  await db.prepare("UPDATE projects SET active = CASE active WHEN 1 THEN 0 ELSE 1 END WHERE id = ?").bind(id).run();
}

export async function listMemberIds(db: D1Database, projectId: number): Promise<number[]> {
  const { results } = await db
    .prepare("SELECT user_id FROM project_members WHERE project_id = ?")
    .bind(projectId)
    .all<{ user_id: number }>();
  return results.map((r) => r.user_id);
}

export async function setMembers(db: D1Database, projectId: number, userIds: number[]): Promise<void> {
  const stmts = [db.prepare("DELETE FROM project_members WHERE project_id = ?").bind(projectId)];
  for (const uid of userIds) {
    stmts.push(db.prepare("INSERT INTO project_members (project_id, user_id) VALUES (?, ?)").bind(projectId, uid));
  }
  await db.batch(stmts);
}

/** Suma czasu (zakończone wpisy) per projekt w zakresie dat; userId zawęża do jednej osoby. */
export async function projectTotals(db: D1Database, from: string, to: string, userId?: number): Promise<Map<number, number>> {
  const { results } = await db
    .prepare(
      `SELECT project_id, SUM(duration_sec) AS total FROM time_entries
        WHERE entry_date BETWEEN ? AND ? AND (ended_at IS NOT NULL OR started_at IS NULL)
          ${userId ? "AND user_id = ?" : ""}
        GROUP BY project_id`,
    )
    .bind(...(userId ? [from, to, userId] : [from, to]))
    .all<{ project_id: number; total: number }>();
  return new Map(results.map((r) => [r.project_id, r.total]));
}

export async function saveProject(db: D1Database, id: number, p: { name: string; description: string; color: string; active: number }): Promise<void> {
  await db
    .prepare("UPDATE projects SET name = ?, description = ?, color = ?, active = ? WHERE id = ?")
    .bind(p.name, p.description, p.color, p.active, id)
    .run();
}

export async function setProjectColor(db: D1Database, id: number, color: string): Promise<void> {
  await db.prepare("UPDATE projects SET color = ? WHERE id = ?").bind(color, id).run();
}

export async function addMember(db: D1Database, projectId: number, userId: number): Promise<void> {
  await db.prepare("INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?, ?)").bind(projectId, userId).run();
}

/** Usuwa projekt razem z jego wpisami czasu i przypisaniami. */
export async function deleteProject(db: D1Database, id: number): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM time_entries WHERE project_id = ?").bind(id),
    db.prepare("DELETE FROM project_members WHERE project_id = ?").bind(id),
    db.prepare("DELETE FROM projects WHERE id = ?").bind(id),
  ]);
}

export async function projectEntryStats(db: D1Database, id: number): Promise<{ n: number; total: number }> {
  return (
    (await db
      .prepare("SELECT COUNT(*) AS n, COALESCE(SUM(duration_sec), 0) AS total FROM time_entries WHERE project_id = ?")
      .bind(id)
      .first<{ n: number; total: number }>()) ?? { n: 0, total: 0 }
  );
}

/** Przypisane osoby (bez admina) dla każdego projektu. */
export async function membersByProject(db: D1Database): Promise<Map<number, string[]>> {
  const { results } = await db
    .prepare(
      `SELECT m.project_id, u.login FROM project_members m JOIN users u ON u.id = m.user_id
        WHERE u.active = 1 ORDER BY u.login`,
    )
    .all<{ project_id: number; login: string }>();
  const map = new Map<number, string[]>();
  for (const r of results) map.set(r.project_id, [...(map.get(r.project_id) ?? []), r.login]);
  return map;
}
