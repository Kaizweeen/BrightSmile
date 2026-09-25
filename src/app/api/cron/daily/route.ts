import { isCronAuthorized } from "@/lib/daily";
import { runDailyJob } from "@/lib/daily-job";

// Room for a day's reminders, one text at a time (see sendReminders).
export const maxDuration = 300;

/** Spec 11: Vercel Cron at 01:00 UTC (9:00 AM Manila) with Authorization: Bearer {CRON_SECRET}. */
export async function GET(request: Request) {
  if (!isCronAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const summary = await runDailyJob(new Date());
  return Response.json(summary, { status: summary.ok ? 200 : 500 });
}
