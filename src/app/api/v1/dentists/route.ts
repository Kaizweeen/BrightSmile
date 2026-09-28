import { json, staffRoute } from "@/server/api";
import { listDentists } from "@/server/schedules";

export const GET = staffRoute(async (_req, staff) => json(await listDentists(staff)));
