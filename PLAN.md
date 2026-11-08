# TimeTracker (klon Clockify) — plan budowy

Stan (2026-10-26): kroki 1–5 zrobione, 35 testów przechodzi, Worker wdrożony. Do zrobienia: sekrety ADMIN_LOGIN i ADMIN_PASSWORD (krok 6).

## 1. Decyzje

| Obszar | Wybór | Dlaczego |
|---|---|---|
| Runtime | Cloudflare Workers | wymaganie |
| Baza | Cloudflare D1 (SQLite) | "Cloudflare Database", darmowy tier, migracje w wranglerze |
| Framework | Hono + TypeScript | lekki, natywny dla Workers, ma JSX do renderowania HTML po stronie serwera |
| UI | HTML renderowany na serwerze + mały vanilla JS (timer Start/Stop) | jeden deploy, zero bundlera frontu, prosto w utrzymaniu |
| Auth | sesja w cookie (HttpOnly), tabela `sessions` w D1 | brak zewnętrznego IdP, działa na Workers |
| Hasła | PBKDF2-SHA256 przez Web Crypto (`crypto.subtle`) | natywne w Workers, bcrypt nie jest |
| Admin | login + hasło w sekretach Workera (`ADMIN_LOGIN`, `ADMIN_PASSWORD`) | wymaganie |
| Testy | Vitest + `@cloudflare/vitest-plugin` | testy biegną w prawdziwym runtime Workers z lokalnym D1 |
| Strefa czasu | jedna, w zmiennej `APP_TZ` (domyślnie `Europe/Warsaw`) | raporty miesięczne muszą mieć stałą granicę dnia |

## 2. Model danych (D1)

```sql
users            (id, login UNIQUE, password_hash, salt, is_admin, active, created_at)
sessions         (id, user_id, expires_at)
projects         (id, name, description, active, created_at)
project_members  (project_id, user_id, PRIMARY KEY(project_id, user_id))
time_entries     (id, project_id, user_id, entry_date TEXT 'YYYY-MM-DD',
                  started_at TEXT NULL, ended_at TEXT NULL,
                  duration_sec INTEGER NOT NULL DEFAULT 0,
                  note TEXT, created_at)
```

Zasady:
- Trzy sposoby logowania czasu trafiają do jednej tabeli:
  - data + czas trwania → `entry_date`, `duration_sec`, czasy puste
  - od–do → `started_at`, `ended_at`, `duration_sec` policzone przy zapisie
  - Start/Stop → wpis z `started_at` i `ended_at = NULL` oznacza "biegnie"; Stop uzupełnia `ended_at` i `duration_sec`
- Jeden biegnący timer na użytkownika: `CREATE UNIQUE INDEX one_running_per_user ON time_entries(user_id) WHERE ended_at IS NULL AND started_at IS NOT NULL`
- Raporty sumują `duration_sec` i filtrują po `entry_date`. Nic nie liczy się "w locie".
- Admin z ENV: przy logowaniu porównanie z sekretami, potem upsert wiersza w `users` z `is_admin=1`, żeby wpisy czasu admina miały normalny `user_id`.

## 3. Ekrany i trasy

| Trasa | Kto | Co |
|---|---|---|
| `GET/POST /login`, `POST /logout` | wszyscy | logowanie |
| `GET /` | zalogowany | lista moich projektów + pasek biegnącego timera |
| `GET /projects/:id` | członek projektu | wpisy czasu w projekcie, formularz ręczny (data+czas lub od–do), przycisk Start/Stop |
| `POST /projects/:id/entries` | członek | dodaj wpis ręczny |
| `POST /projects/:id/timer/start`, `POST /timer/stop` | członek | timer |
| `POST /entries/:id/delete` | autor lub admin | usuń wpis |
| `GET /reports` | zalogowany | przyciski: Ten miesiąc / Poprzedni miesiąc / Zakres od–do; filtr projekt, użytkownik (admin); suma per projekt, per użytkownik, per dzień; lista wpisów; link do CSV |
| `GET /reports.csv` | zalogowany | ten sam filtr, eksport |
| `GET /admin/users`, `POST /admin/users`, `POST /admin/users/:id/password`, `POST /admin/users/:id/toggle` | admin | konta: login, hasło, aktywny |
| `GET /admin/projects`, `POST /admin/projects`, `POST /admin/projects/:id/members` | admin | projekty i przypisania |

Zwykły użytkownik widzi w raportach tylko swoje wpisy. Admin widzi wszystko.

## 4. Struktura katalogów

```
src/
  index.ts            # Hono app, routing, middleware sesji
  env.d.ts            # typ Bindings: DB, ADMIN_LOGIN, ADMIN_PASSWORD, APP_TZ
  auth/               # hash hasła, sesje, middleware requireUser / requireAdmin
  db/                 # zapytania do D1 (users, projects, entries, reports)
  routes/             # login, projects, timer, reports, admin
  views/              # komponenty JSX: layout, formularze, tabele
  static/timer.js     # odliczanie w przeglądarce, Start/Stop przez fetch
migrations/
  0001_init.sql
test/
wrangler.jsonc
.dev.vars             # lokalne sekrety, w .gitignore
```

## 5. Kroki wykonania

Szacunki dotyczą pracy z asystentem; "test" znaczy komenda, która potwierdza krok.

1. **Szkielet** (~30 min)
   `npm create hono@latest . -- --template cloudflare-workers`, `npm i -D wrangler vitest @cloudflare/vitest-pool-workers`, `wrangler d1 create timetracker`, wpis `d1_databases` w `wrangler.jsonc`, `migrations/0001_init.sql`, `wrangler d1 migrations apply timetracker --local`.
   Test: `npm run dev` zwraca stronę na `http://localhost:8787`.

2. **Logowanie + admin z ENV** (~1.5 h)
   `.dev.vars` z `ADMIN_LOGIN`, `ADMIN_PASSWORD`. Formularz `/login`, sesja w cookie, middleware `requireUser`, `requireAdmin`.
   Test: logowanie adminem z ENV działa, zły login dostaje 401.

3. **Panel admina: użytkownicy, projekty, przypisania** (~2.5 h)
   Dodawanie konta (login + hasło), zmiana hasła, dezaktywacja. Projekty CRUD. Checkboxy członków w projekcie.
   Test: nowy użytkownik loguje się i widzi tylko projekty, do których jest przypisany.

4. **Logowanie czasu** (~3 h)
   Widok projektu: formularz "data + czas trwania", formularz "od – do", przycisk Start/Stop z odliczaniem w JS. Walidacja: koniec > początek, jeden timer na raz, tylko członek projektu.
   Test: trzy ścieżki tworzą wpisy z poprawnym `duration_sec`; drugi Start zwraca błąd.

5. **Raporty** (~2.5 h)
   Presety "Ten miesiąc" / "Poprzedni miesiąc" / zakres od–do liczone w `APP_TZ`. Sumy per projekt, użytkownik, dzień. Eksport CSV.
   Test: wpisy z ostatniego dnia miesiąca trafiają do właściwego miesiąca.

6. **Deploy** (~45 min)
   `wrangler login`, `wrangler secret put ADMIN_LOGIN` (i `ADMIN_PASSWORD`), `wrangler d1 migrations apply timetracker --remote`, `wrangler deploy`.
   Test: logowanie na `*.workers.dev`, wpis czasu, raport.

Razem: ok. 1.5 dnia pracy.

## 6. Raport e-mail (dodane 2026-10-26)

- Cron Trigger `0 6 * * 1`, handler `scheduled` w `src/index.tsx`, logika w `src/report/weekly.ts`.
- Email przez binding `send_email` (Cloudflare Email Service). Nadawca `REPORT_FROM` musi być w domenie z Email Sending.
- Tabela `report_runs` pilnuje, żeby cron nie wysłał dwa razy za ten sam tydzień, i daje historię w `/admin/reports`.

## 7. Poza zakresem pierwszej wersji

- Stawki godzinowe i faktury
- Zaproszenia mailem, reset hasła przez e-mail
- Edycja wpisu w miejscu (pierwsza wersja: usuń i dodaj ponownie)
- Wiele stref czasowych per użytkownik
