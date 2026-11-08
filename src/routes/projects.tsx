import { Hono, type Context } from "hono";
import type { AppEnv, Project, User } from "../types";
import { icon, page, ProjectTag, redirectErr, redirectMsg, safeBack } from "../views/layout";
import { ENTRY_CSS, ENTRY_JS, EntryBar, WeekGroups } from "../views/entries";
import { requireUser } from "../auth/middleware";
import { listActiveUsers } from "../db/users";
import {
  addMember, canAccessProject, createProject, deleteProject, getProject, listAllProjects, listMemberIds, listProjectsForUser, membersByProject, setMembers, projectEntryStats, projectTotals, saveProject, setProjectColor,
} from "../db/projects";
import {
  deleteEntry, getEntry, getRunning, insertDuration, insertRange, listForProject, listForUser, startTimer, stopTimer, updateEntry,
} from "../db/entries";
import { parseEntryForm } from "../lib/entryForm";
import { formatDuration, localDate, localDateTime, localTime, monthRange } from "../lib/time";
import { COLOR_RE, PALETTE, projectColor } from "../lib/colors";

export const projectRoutes = new Hono<AppEnv>();
projectRoutes.use("*", requireUser);

const style = (css: string) => <style dangerouslySetInnerHTML={{ __html: css }} />;

/* ---------- Śledzenie czasu (strona główna) ---------- */

projectRoutes.get("/", async (c) => {
  const user = c.get("user");
  const db = c.env.DB;
  const tz = c.env.APP_TZ;
  const today = localDate(Date.now(), tz);
  const [projects, running, entries] = await Promise.all([
    listProjectsForUser(db, user),
    getRunning(db, user.id),
    listForUser(db, user.id),
  ]);

  return page(c, { title: "Śledzenie czasu", hideTimer: true, script: ENTRY_JS }, (
    <>
      {style(ENTRY_CSS)}
      <EntryBar projects={projects} today={today} back="/" running={running} />
      <WeekGroups entries={entries} tz={tz} today={today} showUser={false} canEdit={() => true} back="/" />
    </>
  ));
});

/* ---------- Projekty ---------- */

function ColorPicker(props: { value: string }) {
  return (
    <div class="swatches" data-swatches>
      {PALETTE.map((col) => (
        <button type="button" class={`sw${col === props.value ? " on" : ""}`} style={`background:${col}`} data-color={col} title={col}></button>
      ))}
      <label class={`sw custom${PALETTE.includes(props.value) ? "" : " on"}`} title="Własny kolor" data-custom style={PALETTE.includes(props.value) ? "" : `background:${props.value}`}>
        <input type="color" name="color" value={props.value} data-color-input />
      </label>
    </div>
  );
}

const PROJECT_CSS = `
.swatches{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.sw{width:28px;height:28px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 0 1px var(--line);padding:0;cursor:pointer;flex:0 0 auto}
.sw.on{box-shadow:0 0 0 2px var(--ink)}
.sw.custom{position:relative;overflow:hidden;background:conic-gradient(#eb5757,#f2c94c,#27ae60,#2f80ed,#9b51e0,#eb5757);margin:0}
.sw.custom input{position:absolute;inset:-8px;width:44px;height:44px;opacity:0;cursor:pointer}
.color-dot{position:relative;width:16px;height:16px;border-radius:50%;display:inline-block;overflow:hidden;cursor:pointer;flex:0 0 auto;box-shadow:0 0 0 2px #fff,0 0 0 3px var(--line)}
.color-dot input{position:absolute;inset:-8px;width:32px;height:32px;opacity:0;cursor:pointer}
.ptitle{display:flex;align-items:center;gap:10px}
.ptitle a{color:inherit;font-weight:500}
.people{display:inline-flex;align-items:center;gap:4px;color:inherit}
.people:hover{text-decoration:none}
.people .avatar{width:26px;height:26px;font-size:12px;box-shadow:0 0 0 2px #fff}
.people .add{width:26px;height:26px;border-radius:50%;border:1px dashed var(--line);display:grid;place-items:center;color:var(--muted);font-weight:600}
.people:hover .add{border-color:var(--accent);color:var(--accent)}
.member{display:flex;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line-2);color:var(--ink);font-size:14px;font-weight:400;margin:0;cursor:pointer}
.member:last-of-type{border-bottom:none}
`;

const PROJECT_JS = `
document.querySelectorAll('[data-swatches]').forEach(function(box){var input=box.querySelector('[data-color-input]');
  var custom=box.querySelector('[data-custom]');
  function mark(v){var hit=false;box.querySelectorAll('.sw[data-color]').forEach(function(b){var on=b.getAttribute('data-color').toLowerCase()===v.toLowerCase();if(on)hit=true;b.classList.toggle('on',on)});
    custom.classList.toggle('on',!hit);custom.style.background=hit?'':v}
  box.querySelectorAll('.sw[data-color]').forEach(function(b){b.addEventListener('click',function(){input.value=b.getAttribute('data-color');mark(input.value)})});
  input.addEventListener('input',function(){mark(input.value)});});
document.querySelectorAll('[data-color-quick]').forEach(function(inp){inp.addEventListener('change',function(){inp.form.submit()});
  inp.addEventListener('input',function(){inp.parentNode.style.background=inp.value})});
`;

async function myProjects(db: D1Database, user: User): Promise<Project[]> {
  if (user.is_admin) return listAllProjects(db);
  const { results } = await db
    .prepare(`SELECT p.* FROM projects p JOIN project_members m ON m.project_id = p.id WHERE m.user_id = ? ORDER BY p.active DESC, p.name`)
    .bind(user.id)
    .all<Project>();
  return results;
}

function readProjectForm(form: Record<string, unknown>) {
  const name = String(form.name ?? "").trim().slice(0, 100);
  const description = String(form.description ?? "").trim().slice(0, 500);
  const raw = String(form.color ?? "");
  const color = COLOR_RE.test(raw) ? raw.toLowerCase() : "";
  return { name, description, color };
}

projectRoutes.get("/projects", async (c) => {
  const user = c.get("user");
  const db = c.env.DB;
  const today = localDate(Date.now(), c.env.APP_TZ);
  const month = monthRange(today, 0);
  const [projects, members] = await Promise.all([myProjects(db, user), membersByProject(db)]);
  const totals = await projectTotals(db, month.from, month.to, user.is_admin ? undefined : user.id);
  const max = Math.max(1, ...projects.map((p) => totals.get(p.id) ?? 0));
  const nextColor = PALETTE[projects.length % PALETTE.length];

  return page(c, { title: "Projekty", script: PROJECT_JS }, (
    <>
      <style dangerouslySetInnerHTML={{ __html: PROJECT_CSS }} />
      <form method="post" action="/projects" class="card">
        <div class="row" style="align-items:flex-end">
          <div class="field" style="margin:0"><label>Nazwa nowego projektu</label><input type="text" name="name" required maxlength={100} placeholder="np. Bajki AI" /></div>
          <div class="field" style="margin:0;flex:2 1 240px"><label>Opis (opcjonalnie)</label><input type="text" name="description" maxlength={500} /></div>
          <div style="flex:0 0 auto"><button type="submit">{icon("plus")} Dodaj projekt</button></div>
        </div>
        <div style="margin-top:12px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <span class="muted">Kolor:</span>
          <ColorPicker value={nextColor} />
        </div>
      </form>

      {projects.length === 0 ? (
        <div class="card empty"><b>Brak projektów</b>Dodaj pierwszy projekt powyżej.</div>
      ) : (
        <div class="card table-card">
          <table>
            <thead>
              <tr><th>Projekt</th><th>Osoby</th><th class="num" style="width:220px">Ten miesiąc</th><th style="width:170px"></th></tr>
            </thead>
            <tbody>
              {projects.map((p) => {
                const t = totals.get(p.id) ?? 0;
                const col = projectColor(p.id, p.color);
                return (
                  <tr>
                    <td>
                      <div class="ptitle">
                        <form method="post" action={`/projects/${p.id}/color`} style="margin:0;display:flex">
                          <label class="color-dot" style={`background:${col}`} title="Kliknij, żeby zmienić kolor">
                            <input type="color" name="color" value={col} data-color-quick />
                          </label>
                        </form>
                        <div>
                          <a href={`/projects/${p.id}`}>{p.name}</a>
                          {p.active ? null : <> <span class="badge off">nieaktywny</span></>}
                          {p.description ? <div class="muted" style="font-size:12px">{p.description}</div> : null}
                        </div>
                      </div>
                    </td>
                    <td>
                      <a href={`/projects/${p.id}/edit#osoby`} class="people" title="Przypisz osoby">
                        {(members.get(p.id) ?? []).map((login) => <span class="avatar" title={login}>{login.slice(0, 1)}</span>)}
                        {(members.get(p.id) ?? []).length === 0 ? <span class="muted">nikt</span> : null}
                        <span class="add">+</span>
                      </a>
                    </td>
                    <td class="num">
                      <div style="display:flex;align-items:center;gap:10px;justify-content:flex-end">
                        <div class="bar" style="width:100px"><i style={`width:${(t / max) * 100}%;background:${col}`}></i></div>
                        <span class="dur" style="min-width:48px">{formatDuration(t)}</span>
                      </div>
                    </td>
                    <td>
                      <div style="display:flex;gap:4px;justify-content:flex-end;align-items:center">
                        {p.active ? (
                          <form method="post" action="/timer/start" style="margin:0">
                            <input type="hidden" name="project" value={p.id} />
                            <input type="hidden" name="back" value="/" />
                            <button class="secondary sm" type="submit">{icon("play")} Start</button>
                          </form>
                        ) : null}
                        <a class="icon" href={`/projects/${p.id}/edit`} title="Edytuj projekt">{icon("edit")}</a>
                        <a class="icon del" href={`/projects/${p.id}/edit#usun`} title="Usuń projekt">{icon("trash")}</a>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  ));
});

projectRoutes.post("/projects", async (c) => {
  const user = c.get("user");
  const db = c.env.DB;
  const f = readProjectForm(await c.req.parseBody());
  if (!f.name) return redirectErr(c, "/projects", "Nazwa jest wymagana");
  const id = await createProject(db, f.name, f.description);
  if (f.color) await setProjectColor(db, id, f.color);
  if (!user.is_admin) await addMember(db, id, user.id);
  return redirectMsg(c, "/projects", `Dodano projekt „${f.name}”`);
});

projectRoutes.post("/projects/:id/color", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  if (!(await getProject(c.env.DB, id)) || !(await canAccessProject(c.env.DB, user, id))) return c.text("Nie znaleziono projektu", 404);
  const { color } = readProjectForm(await c.req.parseBody());
  if (!color) return redirectErr(c, "/projects", "Nieprawidłowy kolor");
  await setProjectColor(c.env.DB, id, color);
  return redirectMsg(c, "/projects", "Kolor zmieniony");
});

projectRoutes.get("/projects/:id/edit", async (c) => {
  const user = c.get("user");
  const db = c.env.DB;
  const id = Number(c.req.param("id"));
  const project = await getProject(db, id);
  if (!project || !(await canAccessProject(db, user, id))) return c.text("Nie znaleziono projektu", 404);
  const [stats, users, memberIds] = await Promise.all([projectEntryStats(db, id), listActiveUsers(db), listMemberIds(db, id)]);
  const col = projectColor(id, project.color);
  const people = users.filter((u) => !u.is_admin);
  const assigned = new Set(memberIds);

  return page(c, { title: "Edytuj projekt", script: PROJECT_JS }, (
    <>
      <style dangerouslySetInnerHTML={{ __html: PROJECT_CSS }} />
      <div class="card" style="max-width:640px">
        <form method="post" action={`/projects/${id}/edit`}>
          <div class="field"><label>Nazwa</label><input type="text" name="name" value={project.name} required maxlength={100} /></div>
          <div class="field"><label>Opis</label><input type="text" name="description" value={project.description} maxlength={500} /></div>
          <div class="field"><label>Kolor</label><ColorPicker value={col} /></div>
          <div class="field">
            <label style="display:flex;gap:8px;align-items:center;color:var(--ink);font-size:14px;font-weight:400">
              <input type="checkbox" name="active" value="1" checked={!!project.active} /> Projekt aktywny (można na nim zapisywać czas)
            </label>
          </div>
          <div style="display:flex;gap:8px">
            <button type="submit">Zapisz</button>
            <a class="btn secondary" href="/projects">Anuluj</a>
          </div>
        </form>
      </div>

      <div class="card" style="max-width:640px" id="osoby">
        <h2>Osoby w projekcie</h2>
        <p class="muted" style="margin-top:0">Zaznaczone osoby widzą ten projekt i mogą zapisywać na nim czas.{user.is_admin ? " Dyrektor (admin) widzi wszystkie projekty bez przypisania." : ""}</p>
        <form method="post" action={`/projects/${id}/members`} style="margin:0">
          {people.map((u) => (
            <label class="member">
              <input type="checkbox" name="user" value={u.id} checked={assigned.has(u.id)} disabled={!user.is_admin && u.id === user.id} />
              <span class="avatar" style="width:28px;height:28px;font-size:12px">{u.login.slice(0, 1)}</span>
              {u.login}{u.id === user.id ? <span class="muted">(Ty)</span> : null}
            </label>
          ))}
          {people.length === 0 ? <p class="muted">Brak pracowników.</p> : null}
          <div style="display:flex;gap:12px;align-items:center;margin-top:12px;flex-wrap:wrap">
            <button type="submit" class="secondary">Zapisz osoby</button>
            {user.is_admin ? <a href="/admin/users" class="muted">Dodaj nowego pracownika w „Zespół” →</a> : <span class="muted">Nowe konta pracowników zakłada dyrektor.</span>}
          </div>
        </form>
      </div>

      <div class="card" style="max-width:640px;border-color:#f5c2c4" id="usun">
        <h2 style="color:#a3262a">Usuń projekt</h2>
        <p class="muted" style="margin-top:0">
          {stats.n === 0
            ? "Ten projekt nie ma żadnych wpisów czasu."
            : <>Razem z projektem znikną <b>wszystkie jego wpisy ({stats.n}, łącznie {formatDuration(stats.total)})</b>. Tego nie da się cofnąć. Jeśli chcesz tylko ukryć projekt, odznacz „Projekt aktywny”.</>}
        </p>
        <form method="post" action={`/projects/${id}/delete`} onsubmit={`return confirm('Na pewno usunąć projekt „${project.name.replace(/['"\\]/g, "")}”${stats.n ? ` i ${stats.n} wpisów` : ""}?')`} style="margin:0">
          <button class="danger" type="submit">{icon("trash")} Usuń projekt</button>
        </form>
      </div>
    </>
  ));
});

projectRoutes.post("/projects/:id/edit", async (c) => {
  const user = c.get("user");
  const db = c.env.DB;
  const id = Number(c.req.param("id"));
  if (!(await getProject(db, id)) || !(await canAccessProject(db, user, id))) return c.text("Nie znaleziono projektu", 404);
  const form = await c.req.parseBody();
  const f = readProjectForm(form);
  if (!f.name) return redirectErr(c, `/projects/${id}/edit`, "Nazwa jest wymagana");
  await saveProject(db, id, { ...f, active: form.active ? 1 : 0 });
  return redirectMsg(c, "/projects", "Zapisano projekt");
});

projectRoutes.post("/projects/:id/members", async (c) => {
  const user = c.get("user");
  const db = c.env.DB;
  const id = Number(c.req.param("id"));
  if (!(await getProject(db, id)) || !(await canAccessProject(db, user, id))) return c.text("Nie znaleziono projektu", 404);
  const form = await c.req.parseBody({ all: true });
  const raw = form.user;
  const valid = new Set((await listActiveUsers(db)).filter((u) => !u.is_admin).map((u) => u.id));
  const ids = new Set((Array.isArray(raw) ? raw : raw ? [raw] : []).map(Number).filter((n) => valid.has(n)));
  if (!user.is_admin) ids.add(user.id); // nie można odpiąć samej siebie
  await setMembers(db, id, [...ids]);
  return redirectMsg(c, `/projects/${id}/edit#osoby`, `Zapisano osoby w projekcie (${ids.size})`);
});

projectRoutes.post("/projects/:id/delete", async (c) => {
  const user = c.get("user");
  const db = c.env.DB;
  const id = Number(c.req.param("id"));
  const project = await getProject(db, id);
  if (!project || !(await canAccessProject(db, user, id))) return c.text("Nie znaleziono projektu", 404);
  await deleteProject(db, id);
  return redirectMsg(c, "/projects", `Usunięto projekt „${project.name}”`);
});

projectRoutes.get("/projects/:id", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const db = c.env.DB;
  const tz = c.env.APP_TZ;
  const project = await getProject(db, id);
  if (!project || !(await canAccessProject(db, user, id))) return c.text("Nie znaleziono projektu", 404);

  const today = localDate(Date.now(), tz);
  const month = monthRange(today, 0);
  const [entries, running, totals] = await Promise.all([
    listForProject(db, id, user, 200),
    getRunning(db, user.id),
    projectTotals(db, month.from, month.to, user.is_admin ? undefined : user.id),
  ]);
  const done = entries.filter((e) => e.ended_at || !e.started_at);
  const back = `/projects/${id}`;
  const runningHere = running && running.project_id === id ? running : null;

  return page(c, {
    title: project.name,
    script: ENTRY_JS,
    actions: (
      <span class="muted">
        Ten miesiąc: <b class="dur" style="color:var(--ink)">{formatDuration(totals.get(id) ?? 0)}</b>
        {user.is_admin ? <> · <a href={`/admin/projects/${id}`}>Ustawienia</a></> : null}
        {" · "}<a href={`/reports?project=${id}`}>Raport</a>
      </span>
    ),
  }, (
    <>
      {style(ENTRY_CSS)}
      {project.description ? <p class="muted" style="margin:-8px 0 16px">{project.description}</p> : null}
      {!project.active ? <div class="flash err">Projekt jest nieaktywny. Nie można logować czasu.</div> : null}
      {running && !runningHere ? (
        <div class="card muted">Timer biegnie w projekcie <a href={`/projects/${running.project_id}`}>{running.project_name}</a>. Zatrzymaj go, żeby wystartować tutaj.</div>
      ) : (
        <EntryBar projects={[]} fixedProject={project} today={today} back={back} running={runningHere} />
      )}
      <WeekGroups
        entries={done}
        tz={tz}
        today={today}
        showUser={!!user.is_admin}
        canEdit={(e) => user.is_admin === 1 || e.user_id === user.id}
        back={back}
      />
    </>
  ));
});

/* ---------- Dodawanie wpisów ---------- */

async function loadWritableProject(c: Context<AppEnv>, user: User, id: number): Promise<Project | string> {
  const project = await getProject(c.env.DB, id);
  if (!project || !(await canAccessProject(c.env.DB, user, id))) return "Nie znaleziono projektu";
  if (!project.active) return "Projekt jest nieaktywny";
  return project;
}

async function addEntry(c: Context<AppEnv>, projectId: number, form: Record<string, unknown>, back: string) {
  const user = c.get("user");
  const project = await loadWritableProject(c, user, projectId);
  if (typeof project === "string") return redirectErr(c, back, project);

  const p = parseEntryForm(form, c.env.APP_TZ);
  if (!p.ok) return redirectErr(c, back, p.error);

  if (p.startedAt && p.endedAt) {
    await insertRange(c.env.DB, {
      projectId, userId: user.id, entryDate: p.entryDate, startedAt: p.startedAt, endedAt: p.endedAt, durationSec: p.durationSec, note: p.note,
    });
    const tz = c.env.APP_TZ;
    return redirectMsg(c, back, `Dodano ${localTime(Date.parse(p.startedAt), tz)} – ${localTime(Date.parse(p.endedAt), tz)} (${formatDuration(p.durationSec)})`);
  }
  await insertDuration(c.env.DB, { projectId, userId: user.id, entryDate: p.entryDate, durationSec: p.durationSec, note: p.note });
  return redirectMsg(c, back, `Dodano ${formatDuration(p.durationSec)}`);
}

projectRoutes.post("/entries", async (c) => {
  const form = await c.req.parseBody();
  return addEntry(c, Number(form.project), form, safeBack(form.back, "/"));
});

projectRoutes.post("/projects/:id/entries", async (c) => {
  const id = Number(c.req.param("id"));
  const form = await c.req.parseBody();
  const project = await getProject(c.env.DB, id);
  if (!project || !(await canAccessProject(c.env.DB, c.get("user"), id))) return c.text("Nie znaleziono projektu", 404);
  return addEntry(c, id, form, safeBack(form.back, `/projects/${id}`));
});

/* ---------- Timer ---------- */

async function start(c: Context<AppEnv>, projectId: number, form: Record<string, unknown>, back: string) {
  const user = c.get("user");
  const project = await loadWritableProject(c, user, projectId);
  if (typeof project === "string") return redirectErr(c, back, project);
  const note = String(form.note ?? "").trim().slice(0, 200);
  const now = Date.now();
  const ok = await startTimer(c.env.DB, {
    projectId, userId: user.id, entryDate: localDate(now, c.env.APP_TZ), startedAt: new Date(now).toISOString(), note,
  });
  if (!ok) return redirectErr(c, back, "Masz już biegnący timer. Zatrzymaj go najpierw.");
  return redirectMsg(c, back, "Timer wystartował");
}

projectRoutes.post("/timer/start", async (c) => {
  const form = await c.req.parseBody();
  return start(c, Number(form.project), form, safeBack(form.back, "/"));
});

projectRoutes.post("/projects/:id/timer/start", async (c) => {
  const id = Number(c.req.param("id"));
  const project = await getProject(c.env.DB, id);
  if (!project || !(await canAccessProject(c.env.DB, c.get("user"), id))) return c.text("Nie znaleziono projektu", 404);
  const form = await c.req.parseBody();
  return start(c, id, form, safeBack(form.back, `/projects/${id}`));
});

projectRoutes.post("/timer/stop", async (c) => {
  const user = c.get("user");
  const form = await c.req.parseBody();
  const stopped = await stopTimer(c.env.DB, user.id, new Date().toISOString());
  if (!stopped) return redirectErr(c, safeBack(form.back, "/"), "Brak biegnącego timera");
  return redirectMsg(c, safeBack(form.back, "/"), `Zatrzymano: ${formatDuration(stopped.duration_sec)} (od ${localDateTime(stopped.started_at!, c.env.APP_TZ)})`);
});

/* ---------- Edycja i usuwanie ---------- */

projectRoutes.get("/entries/:id/edit", async (c) => {
  const user = c.get("user");
  const db = c.env.DB;
  const tz = c.env.APP_TZ;
  const entry = await getEntry(db, Number(c.req.param("id")));
  if (!entry) return c.text("Nie znaleziono wpisu", 404);
  if (!user.is_admin && entry.user_id !== user.id) return c.text("Brak uprawnień", 403);
  const back = safeBack(c.req.query("back"), "/");
  if (entry.started_at && !entry.ended_at) return redirectErr(c, back, "Najpierw zatrzymaj timer");

  const projects = await listProjectsForUser(db, user);
  if (!projects.some((p) => p.id === entry.project_id)) {
    projects.unshift({ id: entry.project_id, name: entry.project_name ?? "", description: "", active: 0, color: entry.project_color });
  }
  const isRange = !!(entry.started_at && entry.ended_at);

  return page(c, { title: "Edytuj wpis", script: ENTRY_JS }, (
    <div class="card" style="max-width:640px">
      <form method="post" action={`/entries/${entry.id}`}>
        <input type="hidden" name="back" value={back} />
        <div class="field"><label>Opis</label><input type="text" name="note" value={entry.note} maxlength={200} placeholder="Opis zadania" /></div>
        <div class="field">
          <label>Projekt</label>
          <div style="display:flex;align-items:center;gap:8px">
            <i class="dot" data-dot></i>
            <select name="project" data-project>
              {projects.map((p) => <option value={p.id} data-color={projectColor(p.id, p.color)} selected={p.id === entry.project_id}>{p.name}{p.active ? "" : " (nieaktywny)"}</option>)}
            </select>
          </div>
        </div>
        <div class="row">
          <div class="field"><label>Data</label><input type="date" name="date" value={entry.entry_date} required /></div>
          <div class="field"><label>Od</label><input type="time" name="start" data-start value={isRange ? localTime(Date.parse(entry.started_at!), tz) : ""} /></div>
          <div class="field"><label>Do</label><input type="time" name="end" data-end value={isRange ? localTime(Date.parse(entry.ended_at!), tz) : ""} /></div>
          <div class="field"><label>Czas trwania</label><input type="text" name="duration" data-dur value={formatDuration(entry.duration_sec)} placeholder="1:30" /></div>
        </div>
        <p class="muted" style="margin-top:0">Podaj godziny od–do albo sam czas trwania.</p>
        {user.is_admin && entry.user_login ? <p class="muted">Osoba: <b>{entry.user_login}</b></p> : null}
        <div style="display:flex;gap:8px;align-items:center">
          <button type="submit">Zapisz</button>
          <a class="btn secondary" href={back}>Anuluj</a>
        </div>
      </form>
      <form method="post" action={`/entries/${entry.id}/delete`} onsubmit="return confirm('Usunąć ten wpis?')" style="margin:16px 0 0;border-top:1px solid var(--line-2);padding-top:14px">
        <input type="hidden" name="back" value={back} />
        <button class="link" type="submit">Usuń wpis</button>
      </form>
    </div>
  ));
});

projectRoutes.post("/entries/:id", async (c) => {
  const user = c.get("user");
  const db = c.env.DB;
  const id = Number(c.req.param("id"));
  const entry = await getEntry(db, id);
  if (!entry) return c.text("Nie znaleziono wpisu", 404);
  if (!user.is_admin && entry.user_id !== user.id) return c.text("Brak uprawnień", 403);
  const form = await c.req.parseBody();
  const back = safeBack(form.back, "/");
  const editUrl = `/entries/${id}/edit?back=${encodeURIComponent(back)}`;
  if (entry.started_at && !entry.ended_at) return redirectErr(c, back, "Najpierw zatrzymaj timer");

  const projectId = Number(form.project) || entry.project_id;
  if (projectId !== entry.project_id) {
    const project = await loadWritableProject(c, user, projectId);
    if (typeof project === "string") return redirectErr(c, editUrl, project);
  }
  const p = parseEntryForm(form, c.env.APP_TZ);
  if (!p.ok) return redirectErr(c, editUrl, p.error);

  await updateEntry(db, id, { projectId, entryDate: p.entryDate, startedAt: p.startedAt, endedAt: p.endedAt, durationSec: p.durationSec, note: p.note });
  return redirectMsg(c, back, "Zapisano zmiany");
});

projectRoutes.post("/entries/:id/delete", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const entry = await getEntry(c.env.DB, id);
  if (!entry) return c.text("Nie znaleziono wpisu", 404);
  if (!user.is_admin && entry.user_id !== user.id) return c.text("Brak uprawnień", 403);
  const form = await c.req.parseBody();
  await deleteEntry(c.env.DB, id);
  return redirectMsg(c, safeBack(form.back, `/projects/${entry.project_id}`), "Wpis usunięty");
});
