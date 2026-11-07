import { Hono, type Context } from "hono";
import type { AppEnv } from "../types";
import { page } from "../views/layout";
import { requireUser } from "../auth/middleware";
import { listActiveUsers } from "../db/users";
import { listAllProjects, listProjectsForUser } from "../db/projects";
import { reportEntries, sumByDay, sumByProject, sumByUser, type ReportFilter } from "../db/reports";
import { formatDuration, formatHours, isValidDate, localDate, localTime, monthRange } from "../lib/time";

export const reportRoutes = new Hono<AppEnv>();
reportRoutes.use("*", requireUser);

type Parsed = { filter: ReportFilter; preset: string; label: string };

function parseFilter(c: Context<AppEnv>): Parsed {
  const user = c.get("user");
  const today = localDate(Date.now(), c.env.APP_TZ);
  const q = c.req.query();
  let preset = q.period ?? "this";
  let range: { from: string; to: string };
  let label: string;

  if (preset === "custom" && isValidDate(q.from ?? "") && isValidDate(q.to ?? "") && q.from! <= q.to!) {
    range = { from: q.from!, to: q.to! };
    label = `${q.from} – ${q.to}`;
  } else if (preset === "last") {
    range = monthRange(today, -1);
    label = `Poprzedni miesiąc (${range.from.slice(0, 7)})`;
  } else {
    preset = "this";
    range = monthRange(today, 0);
    label = `Ten miesiąc (${range.from.slice(0, 7)})`;
  }

  const projectId = Number(q.project) || undefined;
  const userId = user.is_admin ? Number(q.user) || undefined : user.id;
  return { filter: { ...range, projectId, userId }, preset, label };
}

reportRoutes.get("/reports", async (c) => {
  const user = c.get("user");
  const db = c.env.DB;
  const tz = c.env.APP_TZ;
  const { filter, preset, label } = parseFilter(c);

  const [entries, byProject, byUser, byDay, projects, users] = await Promise.all([
    reportEntries(db, filter),
    sumByProject(db, filter),
    user.is_admin ? sumByUser(db, filter) : Promise.resolve([]),
    sumByDay(db, filter),
    user.is_admin ? listAllProjects(db) : listProjectsForUser(db, user),
    user.is_admin ? listActiveUsers(db) : Promise.resolve([]),
  ]);
  const total = byProject.reduce((s, r) => s + r.total_sec, 0);
  const qs = new URLSearchParams(c.req.query()).toString();

  const sumTable = (title: string, rows: { key: string; total_sec: number }[]) => (
    <div class="card">
      <h2 style="margin-top:0">{title}</h2>
      {rows.length === 0 ? <p class="muted">Brak danych.</p> : (
        <table>
          <thead><tr><th></th><th class="num">h:mm</th><th class="num">godz.</th></tr></thead>
          <tbody>{rows.map((r) => <tr><td>{r.key}</td><td class="num">{formatDuration(r.total_sec)}</td><td class="num">{formatHours(r.total_sec)}</td></tr>)}</tbody>
        </table>
      )}
    </div>
  );

  return page(c, { title: "Raporty" }, (
    <>
      <div class="card">
        <form method="get" action="/reports">
          <div class="chips">
            <button type="submit" name="period" value="this" class={preset === "this" ? "" : "secondary"}>Ten miesiąc</button>{" "}
            <button type="submit" name="period" value="last" class={preset === "last" ? "" : "secondary"}>Poprzedni miesiąc</button>{" "}
            <button type="submit" name="period" value="custom" class={preset === "custom" ? "" : "secondary"}>Wskazany okres ↓</button>
          </div>
          <div class="row">
            <div class="field"><label>Od</label><input type="date" name="from" value={filter.from} /></div>
            <div class="field"><label>Do</label><input type="date" name="to" value={filter.to} /></div>
            <div class="field">
              <label>Projekt</label>
              <select name="project">
                <option value="">— wszystkie —</option>
                {projects.map((p) => <option value={p.id} selected={p.id === filter.projectId}>{p.name}{p.active ? "" : " (nieaktywny)"}</option>)}
              </select>
            </div>
            {user.is_admin ? (
              <div class="field">
                <label>Użytkownik</label>
                <select name="user">
                  <option value="">— wszyscy —</option>
                  {users.map((u) => <option value={u.id} selected={u.id === filter.userId}>{u.login}</option>)}
                </select>
              </div>
            ) : null}
          </div>
        </form>
        <p class="muted" style="margin:0">
          Zakres: <b>{label}</b> · Razem: <b>{formatDuration(total)}</b> ({formatHours(total)} h) · <a href={`/reports.csv?${qs}`}>Pobierz CSV</a>
        </p>
      </div>

      <div class="grid">
        {sumTable("Wg projektu", byProject)}
        {user.is_admin ? sumTable("Wg użytkownika", byUser) : null}
        {sumTable("Wg dnia", byDay)}
      </div>

      <h2>Wpisy ({entries.length})</h2>
      <table>
        <thead><tr><th>Data</th><th>Projekt</th>{user.is_admin ? <th>Kto</th> : null}<th>Godziny</th><th class="num">Czas</th><th>Notatka</th></tr></thead>
        <tbody>
          {entries.length === 0 ? <tr><td colspan={6} class="muted">Brak wpisów w tym okresie.</td></tr> : null}
          {entries.map((e) => (
            <tr>
              <td>{e.entry_date}</td>
              <td><a href={`/projects/${e.project_id}`}>{e.project_name}</a></td>
              {user.is_admin ? <td>{e.user_login}</td> : null}
              <td class="muted">{e.started_at && e.ended_at ? `${localTime(Date.parse(e.started_at), tz)} – ${localTime(Date.parse(e.ended_at), tz)}` : ""}</td>
              <td class="num">{formatDuration(e.duration_sec)}</td>
              <td>{e.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  ));
});

reportRoutes.get("/reports.csv", async (c) => {
  const tz = c.env.APP_TZ;
  const { filter } = parseFilter(c);
  const entries = await reportEntries(c.env.DB, filter);
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = ["data;projekt;uzytkownik;od;do;czas_hmm;godziny;notatka"];
  for (const e of entries) {
    lines.push([
      e.entry_date, e.project_name ?? "", e.user_login ?? "",
      e.started_at ? localTime(Date.parse(e.started_at), tz) : "",
      e.ended_at ? localTime(Date.parse(e.ended_at), tz) : "",
      formatDuration(e.duration_sec), formatHours(e.duration_sec).replace(".", ","), e.note,
    ].map(esc).join(";"));
  }
  return new Response("﻿" + lines.join("\r\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="raport_${filter.from}_${filter.to}.csv"`,
    },
  });
});
