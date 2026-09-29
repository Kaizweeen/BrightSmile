import { json, staffRoute } from "@/server/api";
import { onlineRequests, onlineRequestsSchema } from "@/server/portal";

export const GET = staffRoute(async (req, staff) => json(await onlineRequests(staff, onlineRequestsSchema.parse(Object.fromEntries(req.nextUrl.searchParams)))));
