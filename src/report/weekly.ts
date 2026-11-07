import { sumByDay, sumByProject, sumByUser, type ReportFilter, type Sum } from "../db/reports";
import { formatDuration, formatHours, localDate } from "../lib/time";

export type WeekRange = { from: string; to: string };

/** Ostatni pełny tydzień (pon–niedz) przed datą lokalną `today` (YYYY-MM-DD). */
export function lastFullWeek(today: string): WeekRange {
  const [y, m, d] = today.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  const dow = (t.getUTCDay() + 6) % 7; // pon=0 … niedz=6
  const monday = new Date(t.getTime() - (dow + 7) * 86400_000);
  const sunday = new Date(monday.getTime() + 6 * 86400_000);
  return { from: monday.toISOString().slice(0, 10), to: sunday.toISOString().slice(0, 10) };
}

export type WeeklyStats = {
  range: WeekRange;
  prevRange: WeekRange;
  totalSec: number;
  prevTotalSec: number;
  byProject: Sum[];
  byUser: Sum[];
  byDay: Sum[];
};

export async function collectWeeklyStats(db: D1Database, range: WeekRange): Promise<WeeklyStats> {
  const prevFrom = new Date(Date.parse(range.from) - 7 * 86400_000).toISOString().slice(0, 10);
  const prevTo = new Date(Date.parse(range.to) - 7 * 86400_000).toISOString().slice(0, 10);
  const f: ReportFilter = { from: range.from, to: range.to };
  const [byProject, byUser, byDay, prevByProject] = await Promise.all([
    sumByProject(db, f), sumByUser(db, f), sumByDay(db, f), sumByProject(db, { from: prevFrom, to: prevTo }),
  ]);
  const total = (rows: Sum[]) => rows.reduce((s, r) => s + r.total_sec, 0);
  return {
    range, prevRange: { from: prevFrom, to: prevTo },
    totalSec: total(byProject), prevTotalSec: total(prevByProject), byProject, byUser, byDay,
  };
}

const DAYS = ["pon", "wt", "śr", "czw", "pt", "sob", "niedz"];
function dayLabel(date: string): string {
  const dow = (new Date(Date.parse(date)).getUTCDay() + 6) % 7;
  return `${DAYS[dow]} ${date.slice(8, 10)}.${date.slice(5, 7)}`;
}

function deltaText(cur: number, prev: number): string {
  if (prev === 0) return cur === 0 ? "bez zmian" : "poprzedni tydzień: 0:00";
  const pct = Math.round(((cur - prev) / prev) * 100);
  return `${pct >= 0 ? "+" : ""}${pct}% vs poprzedni tydzień (${formatDuration(prev)})`;
}

export function renderText(s: WeeklyStats): string {
  const line = (r: Sum) => `  ${r.key.padEnd(24)} ${formatDuration(r.total_sec).padStart(7)}  (${formatHours(r.total_sec)} h)`;
  const out = [
    `Raport tygodniowy TimeTracker: ${s.range.from} – ${s.range.to}`,
    "",
    `Razem: ${formatDuration(s.totalSec)} (${formatHours(s.totalSec)} h), ${deltaText(s.totalSec, s.prevTotalSec)}`,
    "",
    "Wg projektu:",
    ...(s.byProject.length ? s.byProject.map(line) : ["  brak wpisów"]),
    "",
    "Wg użytkownika:",
    ...(s.byUser.length ? s.byUser.map(line) : ["  brak wpisów"]),
    "",
    "Wg dnia:",
    ...(s.byDay.length ? s.byDay.map((r) => line({ ...r, key: dayLabel(r.key) })) : ["  brak wpisów"]),
  ];
  return out.join("\n");
}

const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function renderHtml(s: WeeklyStats): string {
  const table = (title: string, rows: Sum[], label: (k: string) => string = (k) => k) => `
    <h3 style="margin:20px 0 6px;font-size:15px">${title}</h3>
    ${rows.length === 0 ? `<p style="color:#6b7280;margin:0">brak wpisów</p>` : `
    <table cellpadding="6" cellspacing="0" style="border-collapse:collapse;min-width:360px">
      ${rows.map((r) => `<tr>
        <td style="border-bottom:1px solid #e5e7eb">${esc(label(r.key))}</td>
        <td style="border-bottom:1px solid #e5e7eb;text-align:right;font-variant-numeric:tabular-nums"><b>${formatDuration(r.total_sec)}</b></td>
        <td style="border-bottom:1px solid #e5e7eb;text-align:right;color:#6b7280">${formatHours(r.total_sec)} h</td>
      </tr>`).join("")}
    </table>`}`;
  return `<!doctype html><html><body style="font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1c1f24;padding:16px">
    <h2 style="margin:0 0 4px">Raport tygodniowy</h2>
    <p style="margin:0;color:#6b7280">${s.range.from} – ${s.range.to}</p>
    <p style="font-size:22px;margin:16px 0 2px"><b>${formatDuration(s.totalSec)}</b> <span style="font-size:14px;color:#6b7280">(${formatHours(s.totalSec)} h)</span></p>
    <p style="margin:0;color:#6b7280">${esc(deltaText(s.totalSec, s.prevTotalSec))}</p>
    ${table("Wg projektu", s.byProject)}
    ${table("Wg użytkownika", s.byUser)}
    ${table("Wg dnia", s.byDay, dayLabel)}
  </body></html>`;
}

export type SendResult = { status: "sent" | "skipped" | "error"; range: WeekRange; detail: string };

type ReportEnv = { DB: D1Database; APP_TZ: string; REPORT_TO: string; REPORT_FROM: string; EMAIL: SendEmail };

export async function alreadySent(db: D1Database, range: WeekRange, recipient: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS ok FROM report_runs WHERE period_from = ? AND recipient = ? AND status = 'sent'")
    .bind(range.from, recipient)
    .first();
  return !!row;
}

/**
 * Wysyła raport za ostatni pełny tydzień. Przy `force=false` pomija, gdy raport za ten tydzień już poszedł
 * (cron może odpalić się więcej niż raz).
 */
export async function sendWeeklyReport(
  env: ReportEnv,
  opts: { trigger: "cron" | "manual"; force?: boolean; now?: number },
): Promise<SendResult> {
  const now = opts.now ?? Date.now();
  const range = lastFullWeek(localDate(now, env.APP_TZ));
  const to = env.REPORT_TO;
  const from = env.REPORT_FROM;
  if (!to || !from) return { status: "error", range, detail: "Brak REPORT_TO lub REPORT_FROM w konfiguracji" };
  if (!opts.force && (await alreadySent(env.DB, range, to))) {
    return { status: "skipped", range, detail: "Raport za ten tydzień już wysłany" };
  }

  const stats = await collectWeeklyStats(env.DB, range);
  const subject = `TimeTracker: tydzień ${range.from} – ${range.to} · ${formatDuration(stats.totalSec)}`;
  const record = (status: "sent" | "error", messageId: string | null, error: string | null) =>
    env.DB.prepare(
      `INSERT INTO report_runs (period_from, period_to, recipient, trigger, status, message_id, error, total_sec)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(range.from, range.to, to, opts.trigger, status, messageId, error, stats.totalSec).run();

  try {
    const res = await env.EMAIL.send({
      to, from: { email: from, name: "TimeTracker" }, subject,
      text: renderText(stats), html: renderHtml(stats),
    });
    await record("sent", res.messageId, null);
    return { status: "sent", range, detail: `Wysłano do ${to} (id ${res.messageId})` };
  } catch (err) {
    const code = (err as { code?: string })?.code;
    const msg = `${code ? code + ": " : ""}${err instanceof Error ? err.message : String(err)}`;
    await record("error", null, msg);
    return { status: "error", range, detail: msg };
  }
}
