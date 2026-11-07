import type { Context } from "hono";
import type { Child } from "hono/jsx";
import type { AppEnv, TimeEntry } from "../types";
import { getRunning } from "../db/entries";
import { localDateTime } from "../lib/time";

const CSS = `
:root{--bg:#f6f7f9;--card:#fff;--ink:#1c1f24;--muted:#6b7280;--line:#e5e7eb;--accent:#2563eb;--danger:#dc2626;--ok:#16a34a}
*{box-sizing:border-box}body{margin:0;font:15px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--ink)}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
header{background:#111827;color:#fff;padding:0 20px}header nav{display:flex;gap:18px;align-items:center;height:52px;max-width:1100px;margin:0 auto}
header a{color:#e5e7eb}header .brand{font-weight:700;color:#fff;margin-right:auto}header form{margin:0}
main{max-width:1100px;margin:24px auto;padding:0 20px}
h1{font-size:22px;margin:0 0 16px}h2{font-size:17px;margin:24px 0 10px}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:16px;margin-bottom:16px}
.grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(300px,1fr))}
table{width:100%;border-collapse:collapse;background:var(--card)}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}th{font-weight:600;color:var(--muted);font-size:13px}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
label{display:block;font-size:13px;color:var(--muted);margin-bottom:4px}
input[type=text],input[type=password],input[type=date],input[type=time],input[type=number],select,textarea{width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:6px;font:inherit;background:#fff}
.row{display:flex;gap:12px;flex-wrap:wrap}.row>*{flex:1 1 140px}.field{margin-bottom:12px}
button,.btn{display:inline-block;padding:8px 14px;border-radius:6px;border:1px solid var(--accent);background:var(--accent);color:#fff;font:inherit;cursor:pointer}
button.secondary,.btn.secondary{background:#fff;color:var(--ink);border-color:var(--line)}
button.danger{background:var(--danger);border-color:var(--danger)}button.ok{background:var(--ok);border-color:var(--ok)}
button.link{background:none;border:none;color:var(--danger);padding:0;cursor:pointer;font-size:13px}
.flash{padding:10px 14px;border-radius:6px;margin-bottom:16px}.flash.ok{background:#dcfce7;color:#166534}.flash.err{background:#fee2e2;color:#991b1b}
.timer{background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.timer .clock{font-size:24px;font-weight:700;font-variant-numeric:tabular-nums}.timer form{margin:0;margin-left:auto}
.muted{color:var(--muted);font-size:13px}.chips a{display:inline-block;margin:0 8px 8px 0}
.badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;background:#e5e7eb}.badge.off{background:#fee2e2;color:#991b1b}
`;

const TIMER_JS = `
(function(){var el=document.querySelector('[data-started-at]');if(!el)return;var start=Date.parse(el.getAttribute('data-started-at'));
function pad(n){return String(n).padStart(2,'0')}
function tick(){var s=Math.max(0,Math.floor((Date.now()-start)/1000));el.textContent=pad(Math.floor(s/3600))+':'+pad(Math.floor(s%3600/60))+':'+pad(s%60)}
tick();setInterval(tick,1000)})();`;

type PageOpts = { title: string; wide?: boolean };

export async function page(c: Context<AppEnv>, opts: PageOpts, body: Child) {
  const user = c.get("user");
  const running: TimeEntry | null = user ? await getRunning(c.env.DB, user.id) : null;
  const msg = c.req.query("msg");
  const err = c.req.query("err");
  const tz = c.env.APP_TZ;
  return c.html(
    <html lang="pl">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{opts.title} · TimeTracker</title>
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
      </head>
      <body>
        <header>
          <nav>
            <a class="brand" href="/">TimeTracker</a>
            {user && (
              <>
                <a href="/">Projekty</a>
                <a href="/reports">Raporty</a>
                {user.is_admin ? <a href="/admin/users">Użytkownicy</a> : null}
                {user.is_admin ? <a href="/admin/projects">Admin: projekty</a> : null}
                {user.is_admin ? <a href="/admin/reports">Raport e-mail</a> : null}
                <span class="muted" style="color:#9ca3af">{user.login}</span>
                <form method="post" action="/logout">
                  <button class="secondary" type="submit">Wyloguj</button>
                </form>
              </>
            )}
          </nav>
        </header>
        <main>
          {msg ? <div class="flash ok">{msg}</div> : null}
          {err ? <div class="flash err">{err}</div> : null}
          {running ? (
            <div class="timer">
              <span>
                ⏱ Timer biegnie: <a href={`/projects/${running.project_id}`}><b>{running.project_name}</b></a>
                <span class="muted"> od {localDateTime(running.started_at!, tz)}</span>
                {running.note ? <span class="muted"> · {running.note}</span> : null}
              </span>
              <span class="clock" data-started-at={running.started_at}>00:00:00</span>
              <form method="post" action="/timer/stop">
                <button class="danger" type="submit">Stop</button>
              </form>
            </div>
          ) : null}
          <h1>{opts.title}</h1>
          {body}
        </main>
        <script dangerouslySetInnerHTML={{ __html: TIMER_JS }} />
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
