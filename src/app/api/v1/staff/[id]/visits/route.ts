import { json, staffRoute } from "@/server/api";
import { upcomingVisits } from "@/server/appointments";

export const GET = staffRoute<{ id: string }>(async (_req, staff, { id }) => json(await upcomingVisits(staff, id)));
