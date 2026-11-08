# TimeTracker

Prosty klon Clockify na Cloudflare Workers + D1. Projekty, przypisani użytkownicy, logowanie czasu (data + czas, od–do, Start/Stop), raporty miesięczne i za okres, eksport CSV, tygodniowy raport e-mail z Cron Triggera.

## Uruchomienie lokalne

```sh
npm install
cp wrangler.example.jsonc wrangler.jsonc   # uzupełnij database_id, domenę, adresy e-mail
npm run db:migrate:local
npm run dev          # http://localhost:8787
```

Admin logowany z pliku `.dev.vars` (lokalnie): `ADMIN_LOGIN`, `ADMIN_PASSWORD`.

`wrangler.jsonc` jest w `.gitignore` (zawiera `database_id`, domenę i adresy e-mail konkretnej instalacji). Szablon: `wrangler.example.jsonc`.

## Testy

```sh
npm test             # Vitest w runtime Workers, lokalne D1
npm run typecheck
```

## Wdrożenie

```sh
npx wrangler login
npx wrangler secret put ADMIN_LOGIN      # wpisz login admina
npx wrangler secret put ADMIN_PASSWORD   # wpisz hasło admina
npm run db:migrate:remote
npm run deploy
```

Strefa czasu dla dat i granic miesiąca: `APP_TZ` w `wrangler.jsonc` (domyślnie `Europe/Warsaw`).

## Tygodniowy raport e-mail

Cron Trigger `0 6 * * 1` (poniedziałek 06:00 UTC) wysyła statystyki za ostatni pełny tydzień (pon–niedz) na `REPORT_TO` przez Cloudflare Email Service (binding `EMAIL`). Historia wysyłek i przycisk ręcznej wysyłki: `/admin/reports`. Cron nie wysyła dwa razy za ten sam tydzień.

Wymagania jednorazowe:

1. Domena w Cloudflare z włączonym Email Sending: `npx wrangler email sending enable twoja-domena.pl`, potem `npx wrangler email sending dns get twoja-domena.pl` (SPF/DKIM).
2. `REPORT_FROM` w `wrangler.jsonc` ustawione na adres w tej domenie, `REPORT_TO` na odbiorcę.
3. `npm run deploy`.

Lokalnie (`npm run dev`) maile nie wychodzą, trafiają do `.wrangler/tmp/email/`. Cron lokalnie: `npx wrangler dev --test-scheduled`, potem `curl 'http://localhost:8787/__scheduled?cron=0+6+*+*+1'`.

## Struktura

- `src/index.tsx` – aplikacja Hono, routing
- `src/auth/` – hasła (PBKDF2), sesje w D1, middleware
- `src/db/` – zapytania D1: users, projects, entries, reports
- `src/routes/` – logowanie, projekty i timer, raporty, panel admina
- `src/views/layout.tsx` – układ strony, CSS, licznik timera
- `src/lib/time.ts` – strefy czasu, zakresy miesięcy, parsowanie czasu
- `src/report/weekly.ts` – statystyki tygodniowe, treść maila, wysyłka i deduplikacja
- `migrations/` – schemat D1
- `test/` – testy

## Role

- **Admin** (z ENV): wszystkie projekty, wszystkie wpisy, panel `/admin/users` i `/admin/projects`.
- **Użytkownik**: tylko projekty, do których jest przypisany, tylko własne wpisy i raporty.
