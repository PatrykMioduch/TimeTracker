import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "../src/index";
import { localDate, monthRange } from "../src/lib/time";

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
    const today = localDate(Date.now(), "Europe/Warsaw");
    const cur = monthRange(today, 0);
    const prev = monthRange(today, -1);
    await add(alice, cur.from, "1");
    await add(alice, cur.to, "2");
    await add(alice, prev.to, "3");
    await add(admin, cur.from.slice(0, 8) + "15", "4");

    const thisMonth = await (await req("/reports?period=this", {}, alice)).text();
    expect(thisMonth).toContain("Razem: <b>3:00</b>");
    const lastMonth = await (await req("/reports?period=last", {}, alice)).text();
    expect(lastMonth).toContain("Razem: <b>3:00</b>");
    const custom = await (await req(`/reports?period=custom&from=${prev.to}&to=${cur.from}`, {}, alice)).text();
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

describe("edit entries and new views", () => {
  let alice: Session;
  let admin: Session;
  let projectId: number;
  beforeEach(async () => {
    admin = await login("admin", "admin-secret");
    ({ projectId } = await seedUserAndProject(admin));
    alice = await login("alice", "alice-pass-1");
  });

  it("adds entry from the main bar (od–do or duration chosen automatically)", async () => {
    const r1 = await req("/entries", form({ project: String(projectId), date: "2026-10-05", start: "09:00", end: "10:30", note: "a" }), alice);
    expect(location(r1)).toContain("msg=");
    const r2 = await req("/entries", form({ project: String(projectId), date: "2026-10-05", duration: "2:00", note: "b" }), alice);
    expect(location(r2)).toContain("msg=");
    const rows = (await env.DB.prepare("SELECT duration_sec, started_at FROM time_entries ORDER BY id").all<any>()).results;
    expect(rows[0]).toMatchObject({ duration_sec: 5400 });
    expect(rows[0].started_at).not.toBeNull();
    expect(rows[1]).toMatchObject({ duration_sec: 7200, started_at: null });
  });

  it("owner can edit entry; other user cannot", async () => {
    await req("/entries", form({ project: String(projectId), date: "2026-10-05", duration: "1" }), alice);
    const { id } = (await env.DB.prepare("SELECT id FROM time_entries").first<any>())!;
    expect((await req(`/entries/${id}/edit`, {}, alice)).status).toBe(200);

    const res = await req(`/entries/${id}`, form({ project: String(projectId), date: "2026-10-06", start: "08:00", end: "12:00", note: "zmiana", back: "/" }), alice);
    expect(location(res)).toContain("Zapisano zmiany");
    const row = await env.DB.prepare("SELECT * FROM time_entries WHERE id = ?").bind(id).first<any>();
    expect(row).toMatchObject({ entry_date: "2026-10-06", duration_sec: 14400, note: "zmiana" });

    const bob = await login("bob", "bob-pass-12");
    expect((await req(`/entries/${id}`, form({ date: "2026-10-06", duration: "1" }), bob)).status).toBe(403);
  });

  it("main page groups own entries by day; reports support week and year", async () => {
    const today = localDate(Date.now(), "Europe/Warsaw");
    await req("/entries", form({ project: String(projectId), date: today, duration: "1:15", note: "dzis" }), alice);
    const home = await (await req("/", {}, alice)).text();
    expect(home).toContain("Dziś");
    expect(home).toContain("dzis");
    expect(await (await req("/reports?period=week", {}, alice)).text()).toContain("Razem: <b>1:15</b>");
    expect(await (await req("/reports?period=year", {}, alice)).text()).toContain("Razem: <b>1:15</b>");
  });

  it("anyone can add a project from the projects page", async () => {
    const res = await req("/projects", form({ name: "Nowy" }), admin);
    expect(location(res)).toContain("msg=");
    const r2 = await req("/projects", form({ name: "Moj", color: "#123456" }), alice);
    expect(location(r2)).toContain("msg=");
    const mine = await env.DB.prepare("SELECT p.id, p.color FROM projects p JOIN project_members m ON m.project_id=p.id JOIN users u ON u.id=m.user_id WHERE u.login='alice' AND p.name='Moj'").first<any>();
    expect(mine.color).toBe("#123456");
  });

  it("member can edit, recolor and delete a project (with its entries)", async () => {
    await req("/entries", form({ project: String(projectId), date: "2026-10-05", duration: "1" }), alice);
    const e = await req(`/projects/${projectId}/edit`, form({ name: "Strona", color: "#ff0000", active: "1" }), alice);
    expect(location(e)).toContain("msg=");
    expect(await env.DB.prepare("SELECT name, color, active FROM projects WHERE id=?").bind(projectId).first<any>()).toMatchObject({ name: "Strona", color: "#ff0000", active: 1 });
    await req(`/projects/${projectId}/color`, form({ color: "#00ff00" }), alice);
    expect((await env.DB.prepare("SELECT color FROM projects WHERE id=?").bind(projectId).first<any>()).color).toBe("#00ff00");
    const bob = await login("bob", "bob-pass-12");
    expect((await req(`/projects/${projectId}/delete`, form({}), bob)).status).toBe(404);
    await req(`/projects/${projectId}/delete`, form({}), alice);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM time_entries").first<any>()).n).toBe(0);
    expect(await env.DB.prepare("SELECT id FROM projects WHERE id=?").bind(projectId).first()).toBeNull();
  });

  it("member assigns coworkers to a project but cannot remove herself", async () => {
    const bob = (await env.DB.prepare("SELECT id FROM users WHERE login='bob'").first<any>())!.id;
    const aliceId = (await env.DB.prepare("SELECT id FROM users WHERE login='alice'").first<any>())!.id;
    const res = await req(`/projects/${projectId}/members`, form({ user: [String(bob)] }), alice);
    expect(location(res)).toContain("msg=");
    const ids = (await env.DB.prepare("SELECT user_id FROM project_members WHERE project_id=? ORDER BY user_id").bind(projectId).all<any>()).results.map((r: any) => r.user_id);
    expect(ids.sort()).toEqual([aliceId, bob].sort());
    const page = await (await req(`/projects/${projectId}/edit`, {}, alice)).text();
    expect(page).toContain("Osoby w projekcie");
  });
});
