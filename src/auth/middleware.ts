import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../types";
import { getSessionUser } from "./session";

export const loadUser = createMiddleware<AppEnv>(async (c, next) => {
  const user = await getSessionUser(c);
  if (user) c.set("user", user);
  await next();
});

export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get("user")) {
    const next_ = encodeURIComponent(c.req.path);
    return c.redirect(`/login?next=${next_}`);
  }
  await next();
});

export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const user = c.get("user");
  if (!user) return c.redirect("/login");
  if (!user.is_admin) return c.text("Brak uprawnień", 403);
  await next();
});
