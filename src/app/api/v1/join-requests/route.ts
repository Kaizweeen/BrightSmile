import { json, staffRoute } from "@/server/api";
import { listJoinRequests } from "@/server/staff";

export const GET = staffRoute(async (_req, staff) => json(await listJoinRequests(staff)));
