import { json, readJson, staffRoute } from "@/server/api";
import { dayQuery, dayReport, issueBill, issueSchema } from "@/server/billing";
import { manilaDate } from "@/lib/time";

export const GET = staffRoute(async (req, staff) => {
  const q = req.nextUrl.searchParams;
  return json(await dayReport(staff, dayQuery.parse({ branch: q.get("branch"), day: q.get("day") ?? manilaDate(new Date()) })));
});

export const POST = staffRoute(async (req, staff) => json(await issueBill(staff, await readJson(req, issueSchema)), 201));
