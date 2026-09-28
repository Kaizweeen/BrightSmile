import { json, staffRoute } from "@/server/api";
import { chairConflicts, conflictsSchema } from "@/server/appointments";

export const GET = staffRoute(async (req, staff) =>
  json(await chairConflicts(staff, conflictsSchema.parse(Object.fromEntries(req.nextUrl.searchParams)))),
);
