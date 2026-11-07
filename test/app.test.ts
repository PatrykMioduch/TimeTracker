import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "../src/index";

type Session = { cookie: string };

function form(data: Record<string, string | string[]>): RequestInit {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(data)) for (const x of Array.isArray(v) ? v : [v]) body.append(k, x);
  return { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body };
}

async function req(path: string, init: RequestInit = {}, s?: Session) {
  const headers = new Headers(init.headers);
  if (s) headers.set("cookie", s.cookie);
  return app.request(path, { ...init, headers, redirect: "manual" }, env);
}

async function login(login: string, password: string): Promise<Session> {
  const res = await req("/login", form({ login, password }));
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("/");
  const cookie = res.headers.get("set-cookie")!.split(";")[0];
  return { cookie };
}

function location(res: Response) {
  return decodeURIComponent(res.headers.get("location") ?? "");
}

beforeEach(async () => {
  await env.DB.batch(
    ["time_entries", "project_members", "sessions", "projects", "users", "report_runs"].map((t) => env.DB.prepare(`DELETE FROM ${t}`)),
  );
});

async function seedUserAndProject(admin: Session) {
  await req("/admin/users", form({ login: "alice", password: "alice-pass-1" }), admin);
  await req("/admin/users", form({ login: "bob", password: "bob-pass-12" }), admin);
  const created = await req("/admin/projects", form({ name: "Website", description: "Relaunch" }), admin);
  const projectId = Number(location(created).match(/\/admin\/projects\/(\d+)/)![1]);
  const alice = (await env.DB.prepare("SELECT id FROM users WHERE login='alice'").first<{ id: number }>())!;
  await req(`/admin/projects/${projectId}/members`, form({ user: [String(alice.id)] }), admin);
  return { projectId, aliceId: alice.id };
}

describe("auth", () => {
  it("admin from ENV can log in and gets a users row", async () => {
    await login("admin", "admin-secret");
    const row = await env.DB.prepare("SELECT is_admin FROM users WHERE login='admin'").first<{ is_admin: number }>();
    expect(row?.is_admin).toBe(1);
  });

  it("rejects wrong admin password and unknown user", async () => {
    const r1 = await req("/login", form({ login: "admin", password: "nope" }));
    expect(location(r1)).toContain("err=");
    const r2 = await req("/login", form({ login: "ghost", password: "whatever" }));
    expect(location(r2)).toContain("err=");
  });

  it("redirects anonymous users to /login", async () => {
    const res = await req("/reports");
    expect(res.status).toBe(302);
    expect(location(res)).toBe("/login?next=/reports");
  });

  it("non-admin cannot open admin panel", async () => {
    const admin = await login("admin", "admin-secret");
    await seedUserAndProject(admin);
    const alice = await login("alice", "alice-pass-1");
    expect((await req("/admin/users", {}, alice)).status).toBe(403);
  });
});

describe("projects and membership", () => {
  it("member sees only assigned projects; non-member gets 404", async () => {
    const admin = await login("admin", "admin-secret");
    const { projectId } = await seedUserAndProject(admin);
    await req("/admin/projects", form({ name: "Secret" }), admin);

    const alice = await login("alice", "alice-pass-1");
    const home = await (await req("/", {}, alice)).text();
    expect(home).toContain("Website");
    expect(home).not.toContain("Secret");
    expect((await req(`/projects/${projectId}`, {}, alice)).status).toBe(200);

    const bob = await login("bob", "bob-pass-12");
    expect((await req(`/projects/${projectId}`, {}, bob)).status).toBe(404);
  });

  it("deactivated user cannot log in", async () => {
    const admin = await login("admin", "admin-secret");
    const { aliceId } = await seedUserAndProject(admin);
    await req(`/admin/users/${aliceId}/toggle`, form({}), admin);
    const res = await req("/login", form({ login: "alice", password: "alice-pass-1" }));
    expect(location(res)).toContain("err=");
  });
});

describe("time entries", () => {
  let alice: Session;
  let projectId: number;
  beforeEach(async () => {
    const admin = await login("admin", "admin-secret");
    ({ projectId } = await seedUserAndProject(admin));
    alice = await login("alice", "alice-pass-1");
  });

  it("adds date + duration entry", async () => {
    const res = await req(`/projects/${projectId}/entries`, form({ kind: "duration", date: "2026-10-05", duration: "1:30", note: "docs" }), alice);
    expect(location(res)).toContain("msg=");
    const row = await env.DB.prepare("SELECT entry_date, duration_sec, started_at, note FROM time_entries").first<any>();
    expect(row).toMatchObject({ entry_date: "2026-10-05", duration_sec: 5400, started_at: null, note: "docs" });
  });

  it("adds start–end entry in Europe/Warsaw", async () => {
    const res = await req(`/projects/${projectId}/entries`, form({ kind: "range", date: "2026-10-05", start: "09:00", end: "11:15" }), alice);
    expect(location(res)).toContain("msg=");
    const row = await env.DB.prepare("SELECT * FROM time_entries").first<any>();
    expect(row.duration_sec).toBe(8100);
    expect(row.started_at).toBe("2026-10-05T07:00:00.000Z");
    expect(row.ended_at).toBe("2026-10-05T09:15:00.000Z");
  });

  it("rejects end before start and bad duration", async () => {
    const r1 = await req(`/projects/${projectId}/entries`, form({ kind: "range", date: "2026-10-05", start: "11:00", end: "09:00" }), alice);
    expect(location(r1)).toContain("err=");
    const r2 = await req(`/projects/${projectId}/entries`, form({ kind: "duration", date: "2026-10-05", duration: "abc" }), alice);
    expect(location(r2)).toContain("err=");
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM time_entries").first<any>()).n).toBe(0);
  });

  it("start/stop timer, only one running at a time", async () => {
    const start = await req(`/projects/${projectId}/timer/start`, form({ note: "pairing" }), alice);
    expect(location(start)).toContain("Timer wystartował");

    const again = await req(`/projects/${projectId}/timer/start`, form({}), alice);
    expect(location(again)).toContain("Masz już biegnący timer");

    const page = await (await req(`/projects/${projectId}`, {}, alice)).text();
    expect(page).toContain("data-started-at");

    const stop = await req("/timer/stop", form({}), alice);
    expect(location(stop)).toContain("Zatrzymano");
    const row = await env.DB.prepare("SELECT ended_at, duration_sec FROM time_entries").first<any>();
    expect(row.ended_at).not.toBeNull();
    expect(row.duration_sec).toBeGreaterThanOrEqual(1);

    const none = await req("/timer/stop", form({}), alice);
    expect(location(none)).toContain("Brak biegnącego timera");
  });

  it("user can delete own entry but not someone else's", async () => {
    await req(`/projects/${projectId}/entries`, form({ kind: "duration", date: "2026-10-05", duration: "1" }), alice);
    const admin = await login("admin", "admin-secret");
    await req(`/projects/${projectId}/entries`, form({ kind: "duration", date: "2026-10-05", duration: "2" }), admin);
    const rows = (await env.DB.prepare("SELECT id, user_id FROM time_entries ORDER BY id").all<any>()).results;
    expect((await req(`/entries/${rows[1].id}/delete`, form({}), alice)).status).toBe(403);
    expect((await req(`/entries/${rows[0].id}/delete`, form({}), alice)).status).toBe(302);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM time_entries").first<any>()).n).toBe(1);
  });
});

describe("reports", () => {
  it("filters by this/last month and custom range; user sees only own entries", async () => {
    const admin = await login("admin", "admin-secret");
    const { projectId } = await seedUserAndProject(admin);
    const alice = await login("alice", "alice-pass-1");

    const add = (s: Session, date: string, duration: string) =>
      req(`/projects/${projectId}/entries`, form({ kind: "duration", date, duration }), s);
    await add(alice, "2026-10-01", "1");
    await add(alice, "2026-10-31", "2");
    await add(alice, "2026-09-30", "3");
    await add(admin, "2026-10-15", "4");

    const thisMonth = await (await req("/reports?period=this", {}, alice)).text();
    expect(thisMonth).toContain("Razem: <b>3:00</b>");
    const lastMonth = await (await req("/reports?period=last", {}, alice)).text();
    expect(lastMonth).toContain("Razem: <b>3:00</b>");
    const custom = await (await req("/reports?period=custom&from=2026-09-30&to=2026-10-01", {}, alice)).text();
    expect(custom).toContain("Razem: <b>4:00</b>");

    const adminView = await (await req("/reports?period=this", {}, admin)).text();
    expect(adminView).toContain("Razem: <b>7:00</b>");
    expect(adminView).toContain("Wg użytkownika");

    const csv = await req("/reports.csv?period=this", {}, alice);
    expect(csv.headers.get("content-type")).toContain("text/csv");
    const lines = (await csv.text()).split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('"alice"');
  });

  it("excludes a running timer from totals", async () => {
    const admin = await login("admin", "admin-secret");
    const { projectId } = await seedUserAndProject(admin);
    const alice = await login("alice", "alice-pass-1");
    await req(`/projects/${projectId}/timer/start`, form({}), alice);
    const html = await (await req("/reports?period=custom&from=2000-01-01&to=2100-01-01", {}, alice)).text();
    expect(html).toContain("Razem: <b>0:00</b>");
  });
});
