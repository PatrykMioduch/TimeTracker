import { Hono, type Context } from "hono";
import type { AppEnv } from "../types";
import { page } from "../views/layout";
import { DayGroups, ENTRY_CSS } from "../views/entries";
import { requireUser } from "../auth/middleware";
import { listActiveUsers } from "../db/users";
import { listAllProjects, listProjectsForUser } from "../db/projects";
import { reportEntries, sumByDay, sumProjectsWithId, sumUsersWithId, type ReportFilter } from "../db/reports";
import {
  addDays, formatDuration, formatHours, isValidDate, localDate, localTime, monthRange, MONTHS_NOM, rangeLabel, shortDate, weekRange, yearRange,
} from "../lib/time";
import { projectColor } from "../lib/colors";

export const reportRoutes = new Hono<AppEnv>();
reportRoutes.use("*", requireUser);

type Parsed = { filter: ReportFilter; preset: string; label: string };

const PRESETS: [string, string][] = [
  ["week", "Ten tydzień"],
  ["this", "Ten miesiąc"],
  ["last", "Poprzedni miesiąc"],
  ["year", "Ten rok"],
  ["lastyear", "Poprzedni rok"],
];

const monthName = (from: string) => `${MONTHS_NOM[Number(from.slice(5, 7)) - 1]} ${from.slice(0, 4)}`;

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
    label = `Poprzedni miesiąc (${monthName(range.from)})`;
  } else if (preset === "week") {
    range = weekRange(today, 0);
    label = `Ten tydzień (${rangeLabel(range.from, range.to)})`;
  } else if (preset === "year") {
    range = yearRange(today, 0);
    label = `Ten rok (${range.from.slice(0, 4)})`;
  } else if (preset === "lastyear") {
    range = yearRange(today, -1);
    label = `Poprzedni rok (${range.from.slice(0, 4)})`;
  } else {
    preset = "this";
    range = monthRange(today, 0);
    label = `Ten miesiąc (${monthName(range.from)})`;
  }

  const projectId = Number(q.project) || undefined;
  const userId = user.is_admin ? Number(q.user) || undefined : user.id;
  return { filter: { ...range, projectId, userId }, preset, label };
}

const REPORT_CSS = `
.filters{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end}
.filters .field{margin:0;flex:0 1 200px;min-width:160px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:16px;margin-bottom:16px}
.kpi{background:#fff;border:1px solid var(--line);border-radius:var(--radius);padding:14px 18px;box-shadow:var(--shadow)}
.kpi .v{font-size:24px;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.kpi .l{font-size:12px;color:var(--muted);font-weight:500}
.chart{display:flex;align-items:flex-end;gap:3px;height:160px;padding-top:8px}
.chart .col{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;min-width:0}
.chart .col i{display:block;width:100%;max-width:28px;background:var(--accent);border-radius:4px 4px 0 0;min-height:2px;opacity:.85}
.chart .col i.zero{background:var(--line);opacity:1}
.chart .col span{font-size:10px;color:var(--muted);margin-top:4px;white-space:nowrap}
.chart .col:hover i{opacity:1}
.list-row{display:grid;grid-template-columns:minmax(0,1fr) 120px 56px;gap:12px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line-2)}
.list-row:last-child{border-bottom:none}
.list-row a{color:inherit}
.list-row .dur{text-align:right}
.person{display:flex;align-items:center;gap:10px}
.person.on{font-weight:700;color:var(--accent)}
`;

reportRoutes.get("/reports", async (c) => {
  const user = c.get("user");
  const db = c.env.DB;
  const tz = c.env.APP_TZ;
  const today = localDate(Date.now(), tz);
  const { filter, preset, label } = parseFilter(c);

  const [entries, byProject, byUser, byDay, projects, users] = await Promise.all([
    reportEntries(db, filter),
    sumProjectsWithId(db, filter),
    user.is_admin ? sumUsersWithId(db, { ...filter, userId: undefined }) : Promise.resolve([]),
    sumByDay(db, filter),
    user.is_admin ? listAllProjects(db) : listProjectsForUser(db, user),
    user.is_admin ? listActiveUsers(db) : Promise.resolve([]),
  ]);
  const total = byProject.reduce((s, r) => s + r.total_sec, 0);
  const q = c.req.query();
  const qs = new URLSearchParams(q).toString();
  const link = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams(q);
    for (const [k, v] of Object.entries(over)) v === undefined || v === "" ? p.delete(k) : p.set(k, v);
    p.delete("msg");
    p.delete("err");
    return `/reports?${p.toString()}`;
  };

  // Wykres: dni (do ~2 miesięcy) albo miesiące (dłuższe okresy)
  const dayMap = new Map(byDay.map((d) => [d.key, d.total_sec]));
  const days = Math.round((Date.parse(filter.to) - Date.parse(filter.from)) / 86400000) + 1;
  let cols: { label: string; title: string; sec: number }[] = [];
  if (days <= 62) {
    for (let d = filter.from; d <= filter.to; d = addDays(d, 1)) {
      const sec = dayMap.get(d) ?? 0;
      cols.push({ label: days <= 8 ? shortDate(d).split(",")[0] : String(Number(d.slice(8))), title: `${shortDate(d)}: ${formatDuration(sec)}`, sec });
    }
  } else {
    const byMonth = new Map<string, number>();
    for (const d of byDay) byMonth.set(d.key.slice(0, 7), (byMonth.get(d.key.slice(0, 7)) ?? 0) + d.total_sec);
    for (let m = filter.from.slice(0, 7); m <= filter.to.slice(0, 7); m = monthRange(`${m}-01`, 1).from.slice(0, 7)) {
      const sec = byMonth.get(m) ?? 0;
      cols.push({ label: MONTHS_NOM[Number(m.slice(5)) - 1].slice(0, 3), title: `${monthName(`${m}-01`)}: ${formatDuration(sec)}`, sec });
    }
  }
  const colMax = Math.max(1, ...cols.map((x) => x.sec));
  const activeDays = byDay.filter((d) => d.total_sec > 0).length;
  const projMax = Math.max(1, ...byProject.map((p) => p.total_sec));
  const userMax = Math.max(1, ...byUser.map((p) => p.total_sec));
  const selectedUser = user.is_admin && filter.userId ? users.find((u) => u.id === filter.userId) : undefined;

  const AUTOSUBMIT = `document.querySelectorAll('[data-autosubmit]').forEach(function(el){el.addEventListener('change',function(){el.form.submit()})});`;

  return page(c, {
    title: "Raporty",
    script: AUTOSUBMIT,
    actions: <a class="btn secondary" href={`/reports.csv?${qs}`}>Pobierz CSV</a>,
  }, (
    <>
      <style dangerouslySetInnerHTML={{ __html: ENTRY_CSS + REPORT_CSS }} />

      <div class="card">
        <div class="filters" style="justify-content:space-between;align-items:center;margin-bottom:14px">
          <div class="tabs">
            {PRESETS.map(([key, name]) => <a class={preset === key ? "on" : ""} href={link({ period: key, from: undefined, to: undefined })}>{name}</a>)}
          </div>
          <form method="get" action="/reports" class="filters" style="flex:0 1 auto">
            <input type="hidden" name="period" value={preset} />
            {preset === "custom" ? <><input type="hidden" name="from" value={filter.from} /><input type="hidden" name="to" value={filter.to} /></> : null}
            <div class="field">
              <select name="project" data-autosubmit aria-label="Projekt">
                <option value="">Wszystkie projekty</option>
                {projects.map((p) => <option value={p.id} selected={p.id === filter.projectId}>{p.name}{p.active ? "" : " (nieaktywny)"}</option>)}
              </select>
            </div>
            {user.is_admin ? (
              <div class="field">
                <select name="user" data-autosubmit aria-label="Osoba">
                  <option value="">Wszystkie osoby</option>
                  {users.map((u) => <option value={u.id} selected={u.id === filter.userId}>{u.login}</option>)}
                </select>
              </div>
            ) : null}
            <noscript><button type="submit" class="secondary">Filtruj</button></noscript>
          </form>
        </div>
        <form method="get" action="/reports" class="filters" style="padding-top:14px;border-top:1px solid var(--line-2)">
          <input type="hidden" name="period" value="custom" />
          {filter.projectId ? <input type="hidden" name="project" value={filter.projectId} /> : null}
          {user.is_admin && filter.userId ? <input type="hidden" name="user" value={filter.userId} /> : null}
          <div class="field" style="flex:0 1 170px"><label>Własny zakres: od</label><input type="date" name="from" value={filter.from} /></div>
          <div class="field" style="flex:0 1 170px"><label>do</label><input type="date" name="to" value={filter.to} /></div>
          <button type="submit" class={preset === "custom" ? "" : "secondary"}>Pokaż</button>
        </form>
      </div>

      <p class="muted" style="margin:0 0 12px">
        Zakres: <b>{label}</b>{selectedUser ? <> · Osoba: <b>{selectedUser.login}</b> (<a href={link({ user: undefined })}>pokaż wszystkich</a>)</> : null} · Razem: <b>{formatDuration(total)}</b> ({formatHours(total)} h)
      </p>

      <div class="kpis">
        <div class="kpi"><div class="l">Łącznie</div><div class="v">{formatDuration(total)}</div></div>
        <div class="kpi"><div class="l">Dni z wpisami</div><div class="v">{activeDays}</div></div>
        <div class="kpi"><div class="l">Średnio na dzień pracy</div><div class="v">{formatDuration(activeDays ? Math.round(total / activeDays) : 0)}</div></div>
        <div class="kpi"><div class="l">Liczba wpisów</div><div class="v">{entries.length}</div></div>
      </div>

      <div class="card">
        <h2>{days <= 62 ? "Czas w kolejnych dniach" : "Czas w kolejnych miesiącach"}</h2>
        <div class="chart">
          {cols.map((col) => (
            <div class="col" title={col.title}>
              <i class={col.sec ? "" : "zero"} style={`height:${(col.sec / colMax) * 100}%`}></i>
              <span>{col.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div class="grid">
        <div class="card">
          <h2>Wg projektu</h2>
          {byProject.length === 0 ? <p class="muted">Brak danych.</p> : byProject.map((p) => (
            <div class="list-row">
              <a href={link({ project: String(p.id) })} class="proj"><i class="dot" style={`background:${projectColor(p.id, p.color)}`}></i><span>{p.key}</span></a>
              <div class="bar"><i style={`width:${(p.total_sec / projMax) * 100}%;background:${projectColor(p.id, p.color)}`}></i></div>
              <span class="dur">{formatDuration(p.total_sec)}</span>
            </div>
          ))}
        </div>
        {user.is_admin ? (
          <div class="card">
            <h2>Wg użytkownika <span class="muted" style="font-weight:400">· kliknij osobę, żeby zobaczyć tylko jej czas</span></h2>
            {byUser.length === 0 ? <p class="muted">Brak danych.</p> : byUser.map((u) => (
              <div class="list-row">
                <a href={link({ user: filter.userId === u.id ? undefined : String(u.id) })} class={`person${filter.userId === u.id ? " on" : ""}`}>
                  <span class="avatar" style="width:26px;height:26px;font-size:12px">{u.key.slice(0, 1)}</span>{u.key}
                </a>
                <div class="bar"><i style={`width:${(u.total_sec / userMax) * 100}%;background:var(--accent)`}></i></div>
                <span class="dur">{formatDuration(u.total_sec)}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div class="week-head"><b>Wpisy dzień po dniu ({entries.length})</b></div>
      <DayGroups
        entries={entries}
        tz={tz}
        today={today}
        showUser={!!user.is_admin && !filter.userId}
        canEdit={(e) => user.is_admin === 1 || e.user_id === user.id}
        back={link({})}
      />
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
