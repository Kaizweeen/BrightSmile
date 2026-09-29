import { json, publicRoute } from "@/server/api";
import { portalTimes, timesSchema } from "@/server/portal";

// Public and read from the database on every request.
export const dynamic = "force-dynamic";

export const GET = publicRoute(async (req) => json(await portalTimes(timesSchema.parse(Object.fromEntries(req.nextUrl.searchParams)))));
