import type { TimeEntry } from "../types";

export type ReportFilter = { from: string; to: string; userId?: number; projectId?: number };
export type Sum = { key: string; total_sec: number };

function where(f: ReportFilter): { sql: string; args: unknown[] } {
  const conds = ["e.entry_date BETWEEN ? AND ?", "e.ended_at IS NOT NULL OR e.started_at IS NULL"];
  const args: unknown[] = [f.from, f.to];
  if (f.userId) {
    conds.push("e.user_id = ?");
    args.push(f.userId);
  }
  if (f.projectId) {
    conds.push("e.project_id = ?");
    args.push(f.projectId);
  }
  return { sql: conds.map((c) => `(${c})`).join(" AND "), args };
}

export async function reportEntries(db: D1Database, f: ReportFilter): Promise<TimeEntry[]> {
  const w = where(f);
  const { results } = await db
    .prepare(
      `SELECT e.*, p.name AS project_name, p.color AS project_color, u.login AS user_login
         FROM time_entries e
         JOIN projects p ON p.id = e.project_id
         JOIN users u ON u.id = e.user_id
        WHERE ${w.sql}
        ORDER BY e.entry_date DESC, e.id DESC`,
    )
    .bind(...w.args)
    .all<TimeEntry>();
  return results;
}

async function sumBy(db: D1Database, f: ReportFilter, keyExpr: string, join: string, order: string): Promise<Sum[]> {
  const w = where(f);
  const { results } = await db
    .prepare(
      `SELECT ${keyExpr} AS key, SUM(e.duration_sec) AS total_sec
         FROM time_entries e ${join}
        WHERE ${w.sql}
        GROUP BY key ORDER BY ${order}`,
    )
    .bind(...w.args)
    .all<Sum>();
  return results;
}

export const sumByProject = (db: D1Database, f: ReportFilter) =>
  sumBy(db, f, "p.name", "JOIN projects p ON p.id = e.project_id", "total_sec DESC");
export const sumByUser = (db: D1Database, f: ReportFilter) =>
  sumBy(db, f, "u.login", "JOIN users u ON u.id = e.user_id", "total_sec DESC");
export const sumByDay = (db: D1Database, f: ReportFilter) => sumBy(db, f, "e.entry_date", "", "key");

export type IdSum = { id: number; key: string; total_sec: number; n: number; color?: string };

async function sumById(db: D1Database, f: ReportFilter, idExpr: string, keyExpr: string, join: string, extra = ""): Promise<IdSum[]> {
  const w = where(f);
  const { results } = await db
    .prepare(
      `SELECT ${idExpr} AS id, ${keyExpr} AS key${extra}, SUM(e.duration_sec) AS total_sec, COUNT(*) AS n
         FROM time_entries e ${join}
        WHERE ${w.sql}
        GROUP BY ${idExpr} ORDER BY total_sec DESC`,
    )
    .bind(...w.args)
    .all<IdSum>();
  return results;
}

export const sumProjectsWithId = (db: D1Database, f: ReportFilter) =>
  sumById(db, f, "e.project_id", "p.name", "JOIN projects p ON p.id = e.project_id", ", p.color AS color");
export const sumUsersWithId = (db: D1Database, f: ReportFilter) =>
  sumById(db, f, "e.user_id", "u.login", "JOIN users u ON u.id = e.user_id");
