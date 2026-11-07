import { Hono } from "hono";
import type { AppEnv } from "../types";
import { page, redirectErr } from "../views/layout";
import { constantTimeEqual, verifyPassword } from "../auth/password";
import { createSession, destroySession } from "../auth/session";
import { ensureAdminUser, findByLogin } from "../db/users";

export const authRoutes = new Hono<AppEnv>();

function safeNext(next: string | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

authRoutes.get("/login", async (c) => {
  if (c.get("user")) return c.redirect("/");
  const next = c.req.query("next") ?? "/";
  return page(c, { title: "Logowanie" }, (
    <div class="card" style="max-width:380px">
      <form method="post" action="/login">
        <input type="hidden" name="next" value={next} />
        <div class="field">
          <label>Login</label>
          <input type="text" name="login" required autofocus autocomplete="username" />
        </div>
        <div class="field">
          <label>Hasło</label>
          <input type="password" name="password" required autocomplete="current-password" />
        </div>
        <button type="submit">Zaloguj</button>
      </form>
    </div>
  ));
});

authRoutes.post("/login", async (c) => {
  const form = await c.req.parseBody();
  const login = String(form.login ?? "").trim();
  const password = String(form.password ?? "");
  const next = safeNext(String(form.next ?? "/"));
  const fail = () => redirectErr(c, `/login?next=${encodeURIComponent(next)}`, "Nieprawidłowy login lub hasło");

  if (!login || !password) return fail();

  const env = c.env;
  if (env.ADMIN_LOGIN && env.ADMIN_PASSWORD && login === env.ADMIN_LOGIN) {
    if (!constantTimeEqual(password, env.ADMIN_PASSWORD)) return fail();
    const admin = await ensureAdminUser(env.DB, login);
    await createSession(c, admin.id);
    return c.redirect(next);
  }

  const row = await findByLogin(env.DB, login);
  if (!row || !row.active || !row.password_hash || !row.salt) return fail();
  if (!(await verifyPassword(password, row.password_hash, row.salt))) return fail();
  await createSession(c, row.id);
  return c.redirect(next);
});

authRoutes.post("/logout", async (c) => {
  await destroySession(c);
  return c.redirect("/login");
});
