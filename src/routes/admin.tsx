import { Hono } from "hono";
import type { AppEnv } from "../types";
import { page, redirectErr, redirectMsg } from "../views/layout";
import { requireAdmin } from "../auth/middleware";
import { hashPassword } from "../auth/password";
import { createUser, findByLogin, listActiveUsers, listUsers, setPassword, toggleActive } from "../db/users";
import { createProject, getProject, listAllProjects, listMemberIds, setMembers, toggleProject, updateProject } from "../db/projects";
import { lastFullWeek, sendWeeklyReport } from "../report/weekly";
import { formatDuration, localDate, localDateTime } from "../lib/time";

export const adminRoutes = new Hono<AppEnv>();
adminRoutes.use("*", requireAdmin);

const LOGIN_RE = /^[a-zA-Z0-9._@-]{2,64}$/;
const MIN_PASSWORD = 8;

adminRoutes.get("/admin/users", async (c) => {
  const users = await listUsers(c.env.DB);
  return page(c, { title: "Użytkownicy" }, (
    <>
      <div class="card">
        <h2 style="margin-top:0">Nowe konto</h2>
        <form method="post" action="/admin/users" class="row" style="align-items:flex-end">
          <div class="field"><label>Login</label><input type="text" name="login" required pattern="[a-zA-Z0-9._@-]{2,64}" /></div>
          <div class="field"><label>Hasło (min. {MIN_PASSWORD} znaków)</label><input type="password" name="password" required minlength={MIN_PASSWORD} autocomplete="new-password" /></div>
          <div class="field" style="flex:0 0 auto"><button type="submit">Dodaj</button></div>
        </form>
      </div>
      <table>
        <thead><tr><th>Login</th><th>Rola</th><th>Status</th><th>Nowe hasło</th><th></th></tr></thead>
        <tbody>
          {users.map((u) => (
            <tr>
              <td><b>{u.login}</b></td>
              <td>{u.is_admin ? <span class="badge">admin (ENV)</span> : "użytkownik"}</td>
              <td>{u.active ? <span class="badge">aktywny</span> : <span class="badge off">nieaktywny</span>}</td>
              <td>
                {u.is_admin ? <span class="muted">hasło w zmiennych środowiskowych</span> : (
                  <form method="post" action={`/admin/users/${u.id}/password`} class="row" style="align-items:center;gap:6px">
                    <input type="password" name="password" minlength={MIN_PASSWORD} required autocomplete="new-password" placeholder="nowe hasło" />
                    <button class="secondary" type="submit" style="flex:0 0 auto">Zmień</button>
                  </form>
                )}
              </td>
              <td style="text-align:right">
                {u.is_admin ? null : (
                  <form method="post" action={`/admin/users/${u.id}/toggle`} style="margin:0">
                    <button class="secondary" type="submit">{u.active ? "Dezaktywuj" : "Aktywuj"}</button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  ));
});

adminRoutes.post("/admin/users", async (c) => {
  const form = await c.req.parseBody();
  const login = String(form.login ?? "").trim();
  const password = String(form.password ?? "");
  if (!LOGIN_RE.test(login)) return redirectErr(c, "/admin/users", "Login: 2–64 znaki, litery, cyfry, . _ @ -");
  if (password.length < MIN_PASSWORD) return redirectErr(c, "/admin/users", `Hasło musi mieć min. ${MIN_PASSWORD} znaków`);
  if (login === c.env.ADMIN_LOGIN || (await findByLogin(c.env.DB, login))) return redirectErr(c, "/admin/users", "Taki login już istnieje");
  const { hash, salt } = await hashPassword(password);
  await createUser(c.env.DB, login, hash, salt);
  return redirectMsg(c, "/admin/users", `Utworzono konto ${login}`);
});

adminRoutes.post("/admin/users/:id/password", async (c) => {
  const id = Number(c.req.param("id"));
  const form = await c.req.parseBody();
  const password = String(form.password ?? "");
  if (password.length < MIN_PASSWORD) return redirectErr(c, "/admin/users", `Hasło musi mieć min. ${MIN_PASSWORD} znaków`);
  const { hash, salt } = await hashPassword(password);
  await setPassword(c.env.DB, id, hash, salt);
  return redirectMsg(c, "/admin/users", "Hasło zmienione");
});

adminRoutes.post("/admin/users/:id/toggle", async (c) => {
  await toggleActive(c.env.DB, Number(c.req.param("id")));
  return redirectMsg(c, "/admin/users", "Status zmieniony");
});

adminRoutes.get("/admin/projects", async (c) => {
  const projects = await listAllProjects(c.env.DB);
  return page(c, { title: "Admin: projekty" }, (
    <>
      <div class="card">
        <h2 style="margin-top:0">Nowy projekt</h2>
        <form method="post" action="/admin/projects" class="row" style="align-items:flex-end">
          <div class="field"><label>Nazwa</label><input type="text" name="name" required maxlength={100} /></div>
          <div class="field" style="flex:2 1 240px"><label>Opis</label><input type="text" name="description" maxlength={500} /></div>
          <div class="field" style="flex:0 0 auto"><button type="submit">Dodaj</button></div>
        </form>
      </div>
      <table>
        <thead><tr><th>Projekt</th><th>Opis</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {projects.map((p) => (
            <tr>
              <td><a href={`/admin/projects/${p.id}`}><b>{p.name}</b></a></td>
              <td class="muted">{p.description}</td>
              <td>{p.active ? <span class="badge">aktywny</span> : <span class="badge off">nieaktywny</span>}</td>
              <td style="text-align:right"><a href={`/admin/projects/${p.id}`}>Edytuj / członkowie</a></td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  ));
});

adminRoutes.post("/admin/projects", async (c) => {
  const form = await c.req.parseBody();
  const name = String(form.name ?? "").trim().slice(0, 100);
  const description = String(form.description ?? "").trim().slice(0, 500);
  if (!name) return redirectErr(c, "/admin/projects", "Nazwa jest wymagana");
  const id = await createProject(c.env.DB, name, description);
  return redirectMsg(c, `/admin/projects/${id}`, "Projekt utworzony. Przypisz członków.");
});

adminRoutes.get("/admin/projects/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const db = c.env.DB;
  const project = await getProject(db, id);
  if (!project) return c.text("Nie znaleziono projektu", 404);
  const [users, memberIds] = await Promise.all([listActiveUsers(db), listMemberIds(db, id)]);
  const members = new Set(memberIds);
  return page(c, { title: `Projekt: ${project.name}` }, (
    <div class="grid">
      <div class="card">
        <h2 style="margin-top:0">Dane projektu</h2>
        <form method="post" action={`/admin/projects/${id}`}>
          <div class="field"><label>Nazwa</label><input type="text" name="name" value={project.name} required maxlength={100} /></div>
          <div class="field"><label>Opis</label><input type="text" name="description" value={project.description} maxlength={500} /></div>
          <button type="submit">Zapisz</button>
        </form>
        <form method="post" action={`/admin/projects/${id}/toggle`} style="margin-top:12px">
          <button class="secondary" type="submit">{project.active ? "Dezaktywuj projekt" : "Aktywuj projekt"}</button>
        </form>
      </div>
      <div class="card">
        <h2 style="margin-top:0">Członkowie</h2>
        <p class="muted">Admin ma dostęp do wszystkich projektów bez przypisania.</p>
        <form method="post" action={`/admin/projects/${id}/members`}>
          {users.filter((u) => !u.is_admin).map((u) => (
            <div style="margin-bottom:6px">
              <label style="display:flex;gap:8px;align-items:center;color:inherit;font-size:15px">
                <input type="checkbox" name="user" value={u.id} checked={members.has(u.id)} /> {u.login}
              </label>
            </div>
          ))}
          {users.filter((u) => !u.is_admin).length === 0 ? <p class="muted">Brak użytkowników. <a href="/admin/users">Dodaj konto</a>.</p> : null}
          <button type="submit" style="margin-top:8px">Zapisz członków</button>
        </form>
      </div>
      <p><a href="/admin/projects">← Lista projektów</a> · <a href={`/projects/${id}`}>Widok projektu</a></p>
    </div>
  ));
});

adminRoutes.post("/admin/projects/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const form = await c.req.parseBody();
  const name = String(form.name ?? "").trim().slice(0, 100);
  const description = String(form.description ?? "").trim().slice(0, 500);
  if (!name) return redirectErr(c, `/admin/projects/${id}`, "Nazwa jest wymagana");
  await updateProject(c.env.DB, id, name, description);
  return redirectMsg(c, `/admin/projects/${id}`, "Zapisano");
});

adminRoutes.post("/admin/projects/:id/toggle", async (c) => {
  const id = Number(c.req.param("id"));
  await toggleProject(c.env.DB, id);
  return redirectMsg(c, `/admin/projects/${id}`, "Status zmieniony");
});

adminRoutes.post("/admin/projects/:id/members", async (c) => {
  const id = Number(c.req.param("id"));
  const form = await c.req.parseBody({ all: true });
  const raw = form.user;
  const ids = (Array.isArray(raw) ? raw : raw ? [raw] : []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  await setMembers(c.env.DB, id, ids);
  return redirectMsg(c, `/admin/projects/${id}`, `Zapisano członków (${ids.length})`);
});

type ReportRun = {
  id: number; period_from: string; period_to: string; recipient: string; trigger: string;
  status: string; message_id: string | null; error: string | null; total_sec: number; created_at: string;
};

adminRoutes.get("/admin/reports", async (c) => {
  const tz = c.env.APP_TZ;
  const { results: runs } = await c.env.DB.prepare("SELECT * FROM report_runs ORDER BY id DESC LIMIT 50").all<ReportRun>();
  const week = lastFullWeek(localDate(Date.now(), tz));
  const fromOk = !/CHANGE-ME/.test(c.env.REPORT_FROM ?? "");
  return page(c, { title: "Raport e-mail" }, (
    <>
      <div class="card">
        <p style="margin:0 0 8px">
          Cron: <b>każdy poniedziałek 06:00 UTC</b> (07:00 CET / 08:00 CEST). Odbiorca: <b>{c.env.REPORT_TO}</b>, nadawca: <b>{c.env.REPORT_FROM}</b>.
        </p>
        {!fromOk ? <div class="flash err" style="margin:8px 0">Ustaw <code>REPORT_FROM</code> w <code>wrangler.jsonc</code> na adres w domenie dodanej do Cloudflare Email Sending.</div> : null}
        <p class="muted">Raport obejmuje ostatni pełny tydzień: <b>{week.from} – {week.to}</b>. Cron nie wyśle drugi raz za ten sam tydzień; wysyłka ręczna zawsze wysyła.</p>
        <form method="post" action="/admin/reports/send" style="margin:0">
          <button type="submit">Wyślij raport za ostatni tydzień teraz</button>
        </form>
      </div>
      <h2>Historia wysyłek</h2>
      <table>
        <thead><tr><th>Kiedy</th><th>Okres</th><th>Odbiorca</th><th>Źródło</th><th>Status</th><th class="num">Suma</th><th>Szczegóły</th></tr></thead>
        <tbody>
          {runs.length === 0 ? <tr><td colspan={7} class="muted">Jeszcze nic nie wysłano.</td></tr> : null}
          {runs.map((r) => (
            <tr>
              <td>{localDateTime(r.created_at, tz)}</td>
              <td>{r.period_from} – {r.period_to}</td>
              <td>{r.recipient}</td>
              <td>{r.trigger}</td>
              <td>{r.status === "sent" ? <span class="badge">wysłano</span> : <span class="badge off">błąd</span>}</td>
              <td class="num">{formatDuration(r.total_sec)}</td>
              <td class="muted">{r.error ?? r.message_id}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  ));
});

adminRoutes.post("/admin/reports/send", async (c) => {
  const result = await sendWeeklyReport(c.env, { trigger: "manual", force: true });
  if (result.status === "sent") return redirectMsg(c, "/admin/reports", result.detail);
  return redirectErr(c, "/admin/reports", result.detail);
});
