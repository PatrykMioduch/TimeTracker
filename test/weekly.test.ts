import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { collectWeeklyStats, lastFullWeek, renderHtml, renderText, sendWeeklyReport } from "../src/report/weekly";
import worker from "../src/index";

describe("lastFullWeek", () => {
  it.each([
    ["2026-10-26", "2026-10-19", "2026-10-25"], // poniedziałek -> poprzedni pon–niedz
    ["2026-10-25", "2026-10-12", "2026-10-18"], // niedziela -> tydzień wcześniej (bieżący nie jest pełny)
    ["2026-10-28", "2026-10-19", "2026-10-25"], // środa
    ["2026-01-01", "2025-12-22", "2025-12-28"], // przełom roku
  ])("%s -> %s..%s", (today, from, to) => expect(lastFullWeek(today)).toEqual({ from, to }));
});

type Sent = Parameters<SendEmail["send"]>[0];

function fakeEmail(): { sent: Sent[]; binding: SendEmail; fail?: { code: string } } {
  const box = { sent: [] as Sent[], fail: undefined as { code: string } | undefined, binding: undefined as unknown as SendEmail };
  box.binding = {
    async send(msg: Sent) {
      if (box.fail) throw Object.assign(new Error("sender not verified"), { code: box.fail.code });
      box.sent.push(msg);
      return { messageId: `msg-${box.sent.length}` };
    },
  } as SendEmail;
  return box;
}

async function seed() {
  await env.DB.batch(
    ["time_entries", "project_members", "sessions", "projects", "users", "report_runs"].map((t) => env.DB.prepare(`DELETE FROM ${t}`)),
  );
  await env.DB.batch([
    env.DB.prepare("INSERT INTO users (id, login, is_admin) VALUES (1, 'admin', 1), (2, 'alice', 0)"),
    env.DB.prepare("INSERT INTO projects (id, name) VALUES (1, 'Website'), (2, 'API')"),
    // tydzień 2026-10-19..25
    env.DB.prepare("INSERT INTO time_entries (project_id, user_id, entry_date, duration_sec) VALUES (1, 2, '2026-10-19', 3600)"),
    env.DB.prepare("INSERT INTO time_entries (project_id, user_id, entry_date, duration_sec) VALUES (2, 1, '2026-10-25', 7200)"),
    // poza tygodniem
    env.DB.prepare("INSERT INTO time_entries (project_id, user_id, entry_date, duration_sec) VALUES (1, 2, '2026-10-18', 999)"),
    env.DB.prepare("INSERT INTO time_entries (project_id, user_id, entry_date, duration_sec) VALUES (1, 2, '2026-10-26', 999)"),
    // biegnący timer w tygodniu: pomijany
    env.DB.prepare("INSERT INTO time_entries (project_id, user_id, entry_date, started_at, duration_sec) VALUES (1, 2, '2026-10-20', '2026-10-20T08:00:00.000Z', 0)"),
  ]);
}

const MONDAY_0600_UTC = Date.parse("2026-10-26T06:00:00.000Z");

describe("weekly stats", () => {
  beforeEach(seed);

  it("sums only the last full week, ignoring running timers", async () => {
    const stats = await collectWeeklyStats(env.DB, lastFullWeek("2026-10-26"));
    expect(stats.totalSec).toBe(10800);
    expect(stats.prevTotalSec).toBe(999);
    expect(stats.byProject).toEqual([{ key: "API", total_sec: 7200 }, { key: "Website", total_sec: 3600 }]);
    expect(stats.byUser.map((r) => r.key)).toEqual(["admin", "alice"]);
    expect(stats.byDay.map((r) => r.key)).toEqual(["2026-10-19", "2026-10-25"]);
    const text = renderText(stats);
    expect(text).toContain("2026-10-19 – 2026-10-25");
    expect(text).toContain("Razem: 3:00");
    expect(renderHtml(stats)).toContain("<b>3:00</b>");
  });

  it("sends once per week from cron, then skips; manual force resends", async () => {
    const mail = fakeEmail();
    const e = { ...env, EMAIL: mail.binding, REPORT_FROM: "raport@example.com", REPORT_TO: "boss@example.com" };

    const first = await sendWeeklyReport(e, { trigger: "cron", now: MONDAY_0600_UTC });
    expect(first.status).toBe("sent");
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].to).toBe("boss@example.com");
    expect(mail.sent[0].subject).toContain("2026-10-19 – 2026-10-25");
    expect(mail.sent[0].subject).toContain("3:00");

    const second = await sendWeeklyReport(e, { trigger: "cron", now: MONDAY_0600_UTC + 60_000 });
    expect(second.status).toBe("skipped");
    expect(mail.sent).toHaveLength(1);

    const manual = await sendWeeklyReport(e, { trigger: "manual", force: true, now: MONDAY_0600_UTC });
    expect(manual.status).toBe("sent");
    expect(mail.sent).toHaveLength(2);

    const runs = (await env.DB.prepare("SELECT trigger, status, total_sec FROM report_runs ORDER BY id").all()).results;
    expect(runs).toEqual([
      { trigger: "cron", status: "sent", total_sec: 10800 },
      { trigger: "manual", status: "sent", total_sec: 10800 },
    ]);
  });

  it("records send errors and lets cron retry", async () => {
    const mail = fakeEmail();
    mail.fail = { code: "E_SENDER_NOT_VERIFIED" };
    const e = { ...env, EMAIL: mail.binding, REPORT_FROM: "raport@example.com", REPORT_TO: "boss@example.com" };
    const r = await sendWeeklyReport(e, { trigger: "cron", now: MONDAY_0600_UTC });
    expect(r.status).toBe("error");
    expect(r.detail).toContain("E_SENDER_NOT_VERIFIED");

    mail.fail = undefined;
    const retry = await sendWeeklyReport(e, { trigger: "cron", now: MONDAY_0600_UTC });
    expect(retry.status).toBe("sent");
  });

  it("scheduled handler is wired to the weekly report", async () => {
    const mail = fakeEmail();
    const e = { ...env, EMAIL: mail.binding, REPORT_FROM: "raport@example.com" } as unknown as Env;
    await worker.scheduled!(
      { scheduledTime: MONDAY_0600_UTC, cron: "0 6 * * 1", noRetry() {} } as ScheduledController,
      e,
      { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext,
    );
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].to).toBe(env.REPORT_TO);
  });
});
