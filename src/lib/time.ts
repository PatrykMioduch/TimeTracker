export type Parts = { y: number; m: number; d: number; h: number; mi: number; s: number };

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export function partsInTz(ms: number, tz: string): Parts {
  const p: Record<string, string> = {};
  for (const part of fmt(tz).formatToParts(new Date(ms))) p[part.type] = part.value;
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second };
}

const pad = (n: number) => String(n).padStart(2, "0");

export function localDate(ms: number, tz: string): string {
  const p = partsInTz(ms, tz);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

export function localTime(ms: number, tz: string): string {
  const p = partsInTz(ms, tz);
  return `${pad(p.h)}:${pad(p.mi)}`;
}

export function localDateTime(iso: string, tz: string): string {
  const ms = Date.parse(iso);
  return `${localDate(ms, tz)} ${localTime(ms, tz)}`;
}

function tzOffsetMs(utcMs: number, tz: string): number {
  const p = partsInTz(utcMs, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(utcMs / 1000) * 1000;
}

/** Czas lokalny (data + HH:MM w strefie tz) -> milisekundy UTC. */
export function zonedToUtc(date: string, time: string, tz: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const naive = Date.UTC(y, m - 1, d, h, mi);
  let utc = naive - tzOffsetMs(naive, tz);
  const off2 = tzOffsetMs(utc, tz);
  if (naive - off2 !== utc) utc = naive - off2;
  return utc;
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Zakres miesiąca względem podanej daty lokalnej. offset 0 = ten miesiąc, -1 = poprzedni. */
export function monthRange(date: string, offset: number): { from: string; to: string } {
  const [y, m] = date.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + offset, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
  const fy = first.getUTCFullYear();
  const fm = pad(first.getUTCMonth() + 1);
  return { from: `${fy}-${fm}-01`, to: `${fy}-${fm}-${pad(last.getUTCDate())}` };
}

/** "1:30", "1.5", "90m", "2h" -> sekundy. null gdy nie da się sparsować. */
export function parseDuration(input: string): number | null {
  const s = input.trim().toLowerCase().replace(",", ".");
  if (!s) return null;
  let sec: number;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{1,2}):([0-5]\d)$/))) sec = +m[1] * 3600 + +m[2] * 60;
  else if ((m = s.match(/^(\d+(?:\.\d+)?)\s*h?$/))) sec = Math.round(+m[1] * 3600);
  else if ((m = s.match(/^(\d+)\s*m(in)?$/))) sec = +m[1] * 60;
  else if ((m = s.match(/^(\d+)\s*h\s*(\d{1,2})\s*m?$/))) sec = +m[1] * 3600 + +m[2] * 60;
  else return null;
  if (sec <= 0 || sec > 24 * 3600) return null;
  return sec;
}

export function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}:${pad(m)}`;
}

export function formatHours(sec: number): string {
  return (sec / 3600).toFixed(2);
}

/** Dodaje dni do daty YYYY-MM-DD. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** 0 = poniedziałek … 6 = niedziela */
export function weekday(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** Tydzień pon–niedz zawierający datę. offset -1 = poprzedni tydzień. */
export function weekRange(date: string, offset = 0): { from: string; to: string } {
  const from = addDays(date, -weekday(date) + offset * 7);
  return { from, to: addDays(from, 6) };
}

/** Rok zawierający datę. offset -1 = poprzedni rok. */
export function yearRange(date: string, offset = 0): { from: string; to: string } {
  const y = Number(date.slice(0, 4)) + offset;
  return { from: `${y}-01-01`, to: `${y}-12-31` };
}

const DAYS_SHORT = ["pon.", "wt.", "śr.", "czw.", "pt.", "sob.", "niedz."];
const MONTHS_GEN = ["sty", "lut", "mar", "kwi", "maj", "cze", "lip", "sie", "wrz", "paź", "lis", "gru"];
export const MONTHS_NOM = ["styczeń", "luty", "marzec", "kwiecień", "maj", "czerwiec", "lipiec", "sierpień", "wrzesień", "październik", "listopad", "grudzień"];

/** "pt., 6 lis" */
export function shortDate(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${DAYS_SHORT[weekday(date)]}, ${d} ${MONTHS_GEN[m - 1]}`;
}

/** "Dziś" / "Wczoraj" / "pt., 6 lis" (+ rok, gdy inny niż bieżący) */
export function dayLabel(date: string, today: string): string {
  if (date === today) return "Dziś";
  if (date === addDays(today, -1)) return "Wczoraj";
  return shortDate(date) + (date.slice(0, 4) !== today.slice(0, 4) ? ` ${date.slice(0, 4)}` : "");
}

/** "3 – 9 lis" / "27 paź – 2 lis" */
export function rangeLabel(from: string, to: string): string {
  const [, fm, fd] = from.split("-").map(Number);
  const [, tm, td] = to.split("-").map(Number);
  return fm === tm ? `${fd} – ${td} ${MONTHS_GEN[tm - 1]}` : `${fd} ${MONTHS_GEN[fm - 1]} – ${td} ${MONTHS_GEN[tm - 1]}`;
}
