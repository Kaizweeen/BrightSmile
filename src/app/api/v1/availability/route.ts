import { json, staffRoute } from "@/server/api";
import { availability, availabilitySchema } from "@/server/availability";

export const GET = staffRoute(async (req, staff) =>
  json(await availability(staff, availabilitySchema.parse(Object.fromEntries(req.nextUrl.searchParams)))),
);
