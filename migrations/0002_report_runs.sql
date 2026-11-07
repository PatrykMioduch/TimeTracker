CREATE TABLE report_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  period_from TEXT NOT NULL,
  period_to   TEXT NOT NULL,
  recipient   TEXT NOT NULL,
  trigger     TEXT NOT NULL,              -- 'cron' | 'manual'
  status      TEXT NOT NULL,              -- 'sent' | 'error'
  message_id  TEXT,
  error       TEXT,
  total_sec   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX report_runs_period ON report_runs(period_from, status);
