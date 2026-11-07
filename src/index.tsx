import { Hono } from "hono";
import type { AppEnv } from "./types";
import { loadUser } from "./auth/middleware";
import { authRoutes } from "./routes/auth";
import { projectRoutes } from "./routes/projects";
import { reportRoutes } from "./routes/reports";
import { adminRoutes } from "./routes/admin";
import { sendWeeklyReport } from "./report/weekly";

const app = new Hono<AppEnv>();

app.use("*", loadUser);
app.route("/", authRoutes);
app.route("/", projectRoutes);
app.route("/", reportRoutes);
app.route("/", adminRoutes);

app.notFound((c) => c.text("Nie znaleziono", 404));
app.onError((err, c) => {
  console.error(err);
  return c.text("Błąd serwera", 500);
});

export default {
  fetch: app.fetch,
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    const result = await sendWeeklyReport(env, { trigger: "cron", now: controller.scheduledTime });
    console.log(`[weekly-report] ${result.status}: ${result.range.from} – ${result.range.to}: ${result.detail}`);
  },
} satisfies ExportedHandler<Env>;

export { app };
