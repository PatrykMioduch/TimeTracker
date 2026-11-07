import { Hono } from "hono";
import type { AppEnv, TimeEntry } from "../types";
import { page, redirectErr, redirectMsg } from "../views/layout";
import { requireUser } from "../auth/middleware";
import { canAccessProject, getProject, listProjectsForUser } from "../db/projects";
import { deleteEntry, getEntry, getRunning, insertDuration, insertRange, listForProject, startTimer, stopTimer } from "../db/entries";
import { formatDuration, isValidDate, localDate, localDateTime, localTime, parseDuration, TIME_RE, zonedToUtc } from "../lib/time";

export const projectRoutes = new Hono<AppEnv>();
projectRoutes.use("*", requireUser);

projectRoutes.get("/", async (c) => {
  const user = c.get("user");
  const projects = await listProjectsForUser(c.env.DB, user);
  return page(c, { title: "Moje projekty" }, (
    <div class="card">
      {projects.length === 0 ? (
        <p class="muted">Nie jesteś przypisany do żadnego projektu. {user.is_admin ? <a href="/admin/projects">Dodaj projekt</a> : "Poproś administratora o przypisanie."}</p>
      ) : (
        <table>
          <thead><tr><th>Projekt</th><th>Opis</th><th></th></tr></thead>
          <tbody>
            {projects.map((p) => (
              <tr>
                <td><a href={`/projects/${p.id}`}><b>{p.name}</b></a></td>
                <td class="muted">{p.description}</td>
                <td style="text-align:right">
                  <form method="post" action={`/projects/${p.id}/timer/start`} style="margin:0">
                    <button class="ok" type="submit">▶ Start</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  ));
});

function entryRow(e: TimeEntry, tz: string, showUser: boolean, canDelete: boolean) {
  const running = e.started_at && !e.ended_at;
  return (
    <tr>
      <td>{e.entry_date}</td>
      {showUser ? <td>{e.user_login}</td> : null}
      <td class="muted">
        {running ? "biegnie…" : e.started_at && e.ended_at ? `${localTime(Date.parse(e.started_at), tz)} – ${localTime(Date.parse(e.ended_at), tz)}` : "czas trwania"}
      </td>
      <td class="num">{running ? "—" : formatDuration(e.duration_sec)}</td>
      <td>{e.note}</td>
      <td style="text-align:right">
        {canDelete && !running ? (
          <form method="post" action={`/entries/${e.id}/delete`} style="margin:0" onsubmit="return confirm('Usunąć wpis?')">
            <button class="link" type="submit">usuń</button>
          </form>
        ) : null}
      </td>
    </tr>
  );
}

projectRoutes.get("/projects/:id", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const db = c.env.DB;
  const tz = c.env.APP_TZ;
  const project = await getProject(db, id);
  if (!project || !(await canAccessProject(db, user, id))) return c.text("Nie znaleziono projektu", 404);

  const [entries, running] = await Promise.all([listForProject(db, id, user), getRunning(db, user.id)]);
  const today = localDate(Date.now(), tz);
  const total = entries.filter((e) => e.ended_at || !e.started_at).reduce((s, e) => s + e.duration_sec, 0);

  return page(c, { title: project.name }, (
    <>
      {project.description ? <p class="muted">{project.description}</p> : null}
      {!project.active ? <div class="flash err">Projekt jest nieaktywny. Nie można logować czasu.</div> : null}

      <div class="card">
        {running && running.project_id === id ? (
          <p>Timer dla tego projektu biegnie. Zatrzymaj go przyciskiem <b>Stop</b> u góry.</p>
        ) : running ? (
          <p class="muted">Timer biegnie w projekcie <a href={`/projects/${running.project_id}`}>{running.project_name}</a>. Zatrzymaj go, żeby wystartować tutaj.</p>
        ) : (
          <form method="post" action={`/projects/${id}/timer/start`} class="row" style="align-items:flex-end">
            <div class="field" style="flex:3 1 240px">
              <label>Notatka (opcjonalnie)</label>
              <input type="text" name="note" maxlength={200} />
            </div>
            <div class="field" style="flex:0 0 auto">
              <button class="ok" type="submit" disabled={!project.active}>▶ Start</button>
            </div>
          </form>
        )}
      </div>

      <div class="grid">
        <div class="card">
          <h2 style="margin-top:0">Data + czas trwania</h2>
          <form method="post" action={`/projects/${id}/entries`}>
            <input type="hidden" name="kind" value="duration" />
            <div class="row">
              <div class="field"><label>Data</label><input type="date" name="date" value={today} required /></div>
              <div class="field"><label>Czas (np. 1:30, 1.5, 90m)</label><input type="text" name="duration" placeholder="1:30" required /></div>
            </div>
            <div class="field"><label>Notatka</label><input type="text" name="note" maxlength={200} /></div>
            <button type="submit" disabled={!project.active}>Dodaj</button>
          </form>
        </div>
        <div class="card">
          <h2 style="margin-top:0">Od – do</h2>
          <form method="post" action={`/projects/${id}/entries`}>
            <input type="hidden" name="kind" value="range" />
            <div class="row">
              <div class="field"><label>Data</label><input type="date" name="date" value={today} required /></div>
              <div class="field"><label>Od</label><input type="time" name="start" required /></div>
              <div class="field"><label>Do</label><input type="time" name="end" required /></div>
            </div>
            <div class="field"><label>Notatka</label><input type="text" name="note" maxlength={200} /></div>
            <button type="submit" disabled={!project.active}>Dodaj</button>
          </form>
        </div>
      </div>

      <h2>Ostatnie wpisy {user.is_admin ? <span class="muted">(wszyscy użytkownicy)</span> : null}</h2>
      <table>
        <thead>
          <tr><th>Data</th>{user.is_admin ? <th>Kto</th> : null}<th>Godziny</th><th class="num">Czas</th><th>Notatka</th><th></th></tr>
        </thead>
        <tbody>
          {entries.length === 0 ? <tr><td colspan={6} class="muted">Brak wpisów.</td></tr> : null}
          {entries.map((e) => entryRow(e, tz, !!user.is_admin, user.is_admin === 1 || e.user_id === user.id))}
        </tbody>
        {entries.length > 0 ? (
          <tfoot><tr><th colspan={user.is_admin ? 3 : 2}>Suma (pokazane wpisy)</th><th class="num">{formatDuration(total)}</th><th colspan={2}></th></tr></tfoot>
        ) : null}
      </table>
      <p class="muted">Pełne zestawienie: <a href={`/reports?project=${id}`}>Raporty</a>.</p>
    </>
  ));
});

projectRoutes.post("/projects/:id/entries", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const db = c.env.DB;
  const tz = c.env.APP_TZ;
  const back = `/projects/${id}`;
  const project = await getProject(db, id);
  if (!project || !(await canAccessProject(db, user, id))) return c.text("Nie znaleziono projektu", 404);
  if (!project.active) return redirectErr(c, back, "Projekt jest nieaktywny");

  const form = await c.req.parseBody();
  const date = String(form.date ?? "");
  const note = String(form.note ?? "").trim().slice(0, 200);
  if (!isValidDate(date)) return redirectErr(c, back, "Nieprawidłowa data");

  if (form.kind === "duration") {
    const sec = parseDuration(String(form.duration ?? ""));
    if (!sec) return redirectErr(c, back, "Nieprawidłowy czas trwania (użyj np. 1:30, 1.5 lub 90m; maks. 24h)");
    await insertDuration(db, { projectId: id, userId: user.id, entryDate: date, durationSec: sec, note });
    return redirectMsg(c, back, `Dodano ${formatDuration(sec)}`);
  }

  if (form.kind === "range") {
    const start = String(form.start ?? "");
    const end = String(form.end ?? "");
    if (!TIME_RE.test(start) || !TIME_RE.test(end)) return redirectErr(c, back, "Nieprawidłowa godzina");
    const s = zonedToUtc(date, start, tz);
    const e = zonedToUtc(date, end, tz);
    if (e <= s) return redirectErr(c, back, "Godzina zakończenia musi być późniejsza niż rozpoczęcia");
    const sec = Math.round((e - s) / 1000);
    await insertRange(db, {
      projectId: id, userId: user.id, entryDate: date,
      startedAt: new Date(s).toISOString(), endedAt: new Date(e).toISOString(), durationSec: sec, note,
    });
    return redirectMsg(c, back, `Dodano ${start} – ${end} (${formatDuration(sec)})`);
  }

  return redirectErr(c, back, "Nieznany typ wpisu");
});

projectRoutes.post("/projects/:id/timer/start", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const db = c.env.DB;
  const back = `/projects/${id}`;
  const project = await getProject(db, id);
  if (!project || !(await canAccessProject(db, user, id))) return c.text("Nie znaleziono projektu", 404);
  if (!project.active) return redirectErr(c, back, "Projekt jest nieaktywny");
  const form = await c.req.parseBody();
  const note = String(form.note ?? "").trim().slice(0, 200);
  const now = Date.now();
  const ok = await startTimer(db, {
    projectId: id, userId: user.id, entryDate: localDate(now, c.env.APP_TZ), startedAt: new Date(now).toISOString(), note,
  });
  if (!ok) return redirectErr(c, back, "Masz już biegnący timer. Zatrzymaj go najpierw.");
  return redirectMsg(c, back, "Timer wystartował");
});

projectRoutes.post("/timer/stop", async (c) => {
  const user = c.get("user");
  const stopped = await stopTimer(c.env.DB, user.id, new Date().toISOString());
  if (!stopped) return redirectErr(c, "/", "Brak biegnącego timera");
  return redirectMsg(c, `/projects/${stopped.project_id}`, `Zatrzymano: ${formatDuration(stopped.duration_sec)} (od ${localDateTime(stopped.started_at!, c.env.APP_TZ)})`);
});

projectRoutes.post("/entries/:id/delete", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const entry = await getEntry(c.env.DB, id);
  if (!entry) return c.text("Nie znaleziono wpisu", 404);
  if (!user.is_admin && entry.user_id !== user.id) return c.text("Brak uprawnień", 403);
  await deleteEntry(c.env.DB, id);
  return redirectMsg(c, `/projects/${entry.project_id}`, "Wpis usunięty");
});
