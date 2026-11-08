import { isValidDate, parseDuration, TIME_RE, zonedToUtc } from "./time";

export type ParsedEntry =
  | { ok: true; entryDate: string; startedAt: string | null; endedAt: string | null; durationSec: number; note: string }
  | { ok: false; error: string };

/**
 * Wspólne parsowanie formularza wpisu (dodawanie i edycja).
 * Gdy podano godziny od i do → wpis od–do. W przeciwnym razie → data + czas trwania.
 * `kind` (stare formularze) wymusza tryb.
 */
export function parseEntryForm(form: Record<string, unknown>, tz: string): ParsedEntry {
  const date = String(form.date ?? "");
  const note = String(form.note ?? "").trim().slice(0, 200);
  const start = String(form.start ?? "").trim();
  const end = String(form.end ?? "").trim();
  const duration = String(form.duration ?? "").trim();
  if (!isValidDate(date)) return { ok: false, error: "Nieprawidłowa data" };

  const kind = form.kind === "duration" || form.kind === "range" ? form.kind : start && end ? "range" : "duration";

  if (kind === "range") {
    if (!TIME_RE.test(start) || !TIME_RE.test(end)) return { ok: false, error: "Nieprawidłowa godzina" };
    const s = zonedToUtc(date, start, tz);
    const e = zonedToUtc(date, end, tz);
    if (e <= s) return { ok: false, error: "Godzina zakończenia musi być późniejsza niż rozpoczęcia" };
    return {
      ok: true, entryDate: date, note,
      startedAt: new Date(s).toISOString(), endedAt: new Date(e).toISOString(), durationSec: Math.round((e - s) / 1000),
    };
  }

  const sec = parseDuration(duration);
  if (!sec) return { ok: false, error: "Podaj godziny od–do albo czas trwania (np. 1:30, 1.5 lub 90m; maks. 24h)" };
  return { ok: true, entryDate: date, note, startedAt: null, endedAt: null, durationSec: sec };
}
