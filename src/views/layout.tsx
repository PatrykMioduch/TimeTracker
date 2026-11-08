import type { Context } from "hono";
import type { Child } from "hono/jsx";
import { raw } from "hono/html";
import type { AppEnv, TimeEntry } from "../types";
import { getRunning } from "../db/entries";
import { localDateTime } from "../lib/time";
import { projectColor } from "../lib/colors";

const CSS = `
:root{
  --bg:#f2f4f7;--card:#fff;--ink:#1f2933;--ink-2:#3e4c59;--muted:#7b8794;--line:#e4e7eb;--line-2:#eef0f3;
  --accent:#1e88e5;--accent-ink:#fff;--accent-soft:#e3f0fc;--danger:#e5484d;--danger-soft:#fdecec;--ok:#2e9e5b;--ok-soft:#e5f6ec;
  --side:#ffffff;--radius:10px;--shadow:0 1px 2px rgba(16,24,40,.05),0 1px 3px rgba(16,24,40,.06);
}
*{box-sizing:border-box}
html,body{margin:0}
body{font:14px/1.5 Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--ink);-webkit-font-smoothing:antialiased}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
.app{display:grid;grid-template-columns:232px 1fr;min-height:100vh}
.side{background:var(--side);border-right:1px solid var(--line);padding:18px 12px;position:sticky;top:0;height:100vh;display:flex;flex-direction:column;gap:4px}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:16px;color:var(--ink);padding:4px 10px 18px}
.brand .logo{width:28px;height:28px;border-radius:8px;background:var(--accent);display:grid;place-items:center;color:#fff}
.side a.nav{display:flex;align-items:center;gap:12px;padding:9px 12px;border-radius:8px;color:var(--ink-2);font-weight:500}
.side a.nav:hover{background:var(--line-2);text-decoration:none}
.side a.nav.on{background:var(--accent-soft);color:var(--accent)}
.side a.nav svg{width:18px;height:18px;flex:0 0 auto}
.side .sep{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);padding:16px 12px 6px}
.side .who{margin-top:auto;border-top:1px solid var(--line);padding:14px 10px 0;display:flex;align-items:center;gap:10px}
.avatar{width:30px;height:30px;border-radius:50%;background:#cfe3f7;color:#0f5aa3;display:grid;place-items:center;font-weight:700;font-size:13px;flex:0 0 auto;text-transform:uppercase}
.who .name{font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}
.who form{margin:0}
main{padding:28px 32px 60px;max-width:1180px;width:100%;min-width:0}
.page-head{display:flex;align-items:center;gap:12px;margin-bottom:18px;flex-wrap:wrap}
h1{font-size:22px;font-weight:700;margin:0;letter-spacing:-.01em}
h2{font-size:15px;font-weight:600;margin:0 0 12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:18px;margin-bottom:16px;box-shadow:var(--shadow)}
.grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(300px,1fr))}
table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line-2);vertical-align:middle}
th{font-weight:600;color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.04em}
tr:last-child td{border-bottom:none}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
.table-card{padding:0;overflow:hidden}
main>table{background:#fff;border:1px solid var(--line);border-radius:var(--radius);border-collapse:separate;border-spacing:0;overflow:hidden;box-shadow:var(--shadow)}
main>table th{background:#fafbfc}
.table-card table th{background:#fafbfc}
label{display:block;font-size:12px;font-weight:500;color:var(--muted);margin-bottom:5px}
input[type=text],input[type=password],input[type=date],input[type=time],input[type=number],select,textarea{
  width:100%;height:38px;padding:0 11px;border:1px solid var(--line);border-radius:8px;font:inherit;color:var(--ink);background:#fff;transition:border-color .15s,box-shadow .15s}
input:focus,select:focus,textarea:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.row{display:flex;gap:12px;flex-wrap:wrap}.row>*{flex:1 1 140px}.field{margin-bottom:12px}
button,.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:38px;padding:0 16px;border-radius:8px;border:1px solid var(--accent);background:var(--accent);color:var(--accent-ink);font:inherit;font-weight:600;cursor:pointer;white-space:nowrap;transition:filter .15s}
button:hover,.btn:hover{filter:brightness(.95);text-decoration:none}
button:disabled{opacity:.5;cursor:not-allowed}
button.secondary,.btn.secondary{background:#fff;color:var(--ink-2);border-color:var(--line)}
button.danger{background:var(--danger);border-color:var(--danger)}button.ok{background:var(--ok);border-color:var(--ok)}
button.sm,.btn.sm{height:30px;padding:0 10px;font-size:13px}
button.link{background:none;border:none;color:var(--danger);padding:0;height:auto;font-weight:500;font-size:13px}
button.icon,a.icon{background:none;border:none;color:var(--muted);height:32px;width:32px;padding:0;border-radius:6px;display:inline-grid;place-items:center}
button.icon:hover,a.icon:hover{background:var(--line-2);color:var(--ink);filter:none;text-decoration:none}
button.icon.del:hover{color:var(--danger);background:var(--danger-soft)}
.icon svg,button svg,.btn svg{width:16px;height:16px;flex:0 0 auto}
.flash{padding:11px 14px;border-radius:8px;margin-bottom:16px;font-weight:500}.flash.ok{background:var(--ok-soft);color:#1d6b3e}.flash.err{background:var(--danger-soft);color:#a3262a}
.muted{color:var(--muted);font-size:13px}
.badge{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:500;background:var(--line-2);color:var(--ink-2)}.badge.off{background:var(--danger-soft);color:#a3262a}
.dot{display:inline-block;width:9px;height:9px;border-radius:50%;flex:0 0 auto}
.proj{display:inline-flex;align-items:center;gap:7px;font-weight:500;max-width:100%}
.proj span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tabs{display:inline-flex;background:var(--line-2);border-radius:9px;padding:3px;gap:2px;flex-wrap:wrap}
.tabs button,.tabs a{height:32px;background:transparent;border:none;color:var(--ink-2);font-weight:500;padding:0 13px;border-radius:7px;display:inline-flex;align-items:center}
.tabs button.on,.tabs a.on{background:#fff;color:var(--ink);box-shadow:var(--shadow)}
.tabs a:hover{text-decoration:none}
.timer{background:#fff8e6;border:1px solid #f5d98b;border-radius:var(--radius);padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.timer .clock{font-size:22px;font-weight:700;font-variant-numeric:tabular-nums}.timer form{margin:0;margin-left:auto}
.dur{font-variant-numeric:tabular-nums;font-weight:600}
.bar{height:8px;border-radius:99px;background:var(--line-2);overflow:hidden;min-width:60px}.bar>i{display:block;height:100%;border-radius:99px}
.empty{text-align:center;padding:40px 20px;color:var(--muted)}
.empty b{display:block;color:var(--ink);font-size:15px;margin-bottom:4px}
.login-wrap{min-height:100vh;display:grid;place-items:center;padding:20px}
.login-wrap .card{width:100%;max-width:380px;padding:28px}
@media (max-width:860px){
  .app{grid-template-columns:minmax(0,1fr)}
  .side{position:static;height:auto;flex-direction:row;flex-wrap:wrap;align-items:center;padding:10px 12px;gap:2px}
  .brand{padding:4px 8px;margin-right:auto}.side .sep{display:none}
  .side a.nav{padding:8px 10px}.side a.nav span{display:none}
  .side .who{margin:0;border:none;padding:0 0 0 6px}.who .name{display:none}
  main{padding:18px 16px 40px}
}
`;

const TIMER_JS = `
(function(){document.querySelectorAll('[data-started-at]').forEach(function(el){var start=Date.parse(el.getAttribute('data-started-at'));
function pad(n){return String(n).padStart(2,'0')}
function tick(){var s=Math.max(0,Math.floor((Date.now()-start)/1000));el.textContent=pad(Math.floor(s/3600))+':'+pad(Math.floor(s%3600/60))+':'+pad(s%60)}
tick();setInterval(tick,1000)})})();`;

const ICONS: Record<string, string> = {
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
  settings: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  play: '<path d="M7 5v14l12-7z" fill="currentColor"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
};

export function icon(name: string) {
  return raw(
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ""}</svg>`,
  );
}

export function ProjectTag(props: { id: number; name?: string; color?: string }) {
  return (
    <span class="proj">
      <i class="dot" style={`background:${projectColor(props.id, props.color)}`}></i>
      <span>{props.name}</span>
    </span>
  );
}

type PageOpts = { title: string; hideTimer?: boolean; bare?: boolean; actions?: Child; script?: string };

function NavLink(props: { href: string; path: string; icon: string; label: string; exact?: boolean }) {
  const on = props.exact ? props.path === props.href : props.path === props.href || props.path.startsWith(props.href + "/");
  return (
    <a class={`nav${on ? " on" : ""}`} href={props.href}>
      {icon(props.icon)}
      <span>{props.label}</span>
    </a>
  );
}

export async function page(c: Context<AppEnv>, opts: PageOpts, body: Child) {
  const user = c.get("user");
  const running: TimeEntry | null = user && !opts.hideTimer ? await getRunning(c.env.DB, user.id) : null;
  const msg = c.req.query("msg");
  const err = c.req.query("err");
  const tz = c.env.APP_TZ;
  const path = c.req.path;

  const flashes = (
    <>
      {msg ? <div class="flash ok">{msg}</div> : null}
      {err ? <div class="flash err">{err}</div> : null}
    </>
  );

  return c.html(
    <html lang="pl">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{opts.title} · TimeTracker</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" />
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
      </head>
      <body>
        {opts.bare || !user ? (
          <div class="login-wrap">
            <div style="width:100%;max-width:380px">
              <div class="brand" style="justify-content:center;padding-bottom:20px">
                <span class="logo">{icon("clock")}</span> TimeTracker
              </div>
              {flashes}
              {body}
            </div>
          </div>
        ) : (
          <div class="app">
            <aside class="side">
              <a class="brand" href="/" style="text-decoration:none">
                <span class="logo">{icon("clock")}</span> TimeTracker
              </a>
              <NavLink href="/" path={path} icon="clock" label="Śledzenie czasu" exact />
              <NavLink href="/projects" path={path} icon="folder" label="Projekty" />
              <NavLink href="/reports" path={path} icon="chart" label="Raporty" />
              {user.is_admin ? (
                <>
                  <div class="sep">Zarządzanie</div>
                  <NavLink href="/admin/users" path={path} icon="users" label="Zespół" />
                  <NavLink href="/admin/projects" path={path} icon="settings" label="Ustawienia projektów" />
                  <NavLink href="/admin/reports" path={path} icon="mail" label="Raport e-mail" />
                </>
              ) : null}
              <div class="who">
                <span class="avatar">{user.login.slice(0, 1)}</span>
                <span class="name">{user.login}</span>
                <form method="post" action="/logout">
                  <button class="icon" type="submit" title="Wyloguj">{icon("logout")}</button>
                </form>
              </div>
            </aside>
            <main>
              {flashes}
              {running ? (
                <div class="timer">
                  <span>
                    Timer biegnie: <a href={`/projects/${running.project_id}`}><b>{running.project_name}</b></a>
                    <span class="muted"> od {localDateTime(running.started_at!, tz)}</span>
                    {running.note ? <span class="muted"> · {running.note}</span> : null}
                  </span>
                  <span class="clock" data-started-at={running.started_at}>00:00:00</span>
                  <form method="post" action="/timer/stop">
                    <button class="danger" type="submit">Stop</button>
                  </form>
                </div>
              ) : null}
              <div class="page-head">
                <h1>{opts.title}</h1>
                {opts.actions ? <div style="margin-left:auto">{opts.actions}</div> : null}
              </div>
              {body}
            </main>
          </div>
        )}
        <script dangerouslySetInnerHTML={{ __html: TIMER_JS + (opts.script ?? "") }} />
      </body>
    </html>,
  );
}

export function redirectMsg(c: Context<AppEnv>, to: string, msg: string) {
  return c.redirect(`${to}${to.includes("?") ? "&" : "?"}msg=${encodeURIComponent(msg)}`);
}
export function redirectErr(c: Context<AppEnv>, to: string, err: string) {
  return c.redirect(`${to}${to.includes("?") ? "&" : "?"}err=${encodeURIComponent(err)}`);
}

/** Bezpieczny adres powrotu z formularza (tylko ścieżki w aplikacji). */
export function safeBack(v: unknown, fallback: string): string {
  const s = typeof v === "string" ? v : "";
  return s.startsWith("/") && !s.startsWith("//") ? s : fallback;
}
