import { json, staffRoute } from "@/server/api";
import { listStaff } from "@/server/staff";

export const GET = staffRoute(async (_req, staff) => json(await listStaff(staff)));
