import { json, staffRoute } from "@/server/api";
import { accessLog, auditQuerySchema } from "@/server/audit-log";

export const GET = staffRoute(async (req, staff) =>
  json(await accessLog(staff, auditQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams)))),
);
