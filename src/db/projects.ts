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
