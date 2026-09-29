import { json, readJson, staffRoute } from "@/server/api";
import { dentistWeek, replaceWeek, weekSchema } from "@/server/schedules";

export const GET = staffRoute<{ id: string }>(async (_req, staff, { id }) => json(await dentistWeek(staff, id)));

export const PUT = staffRoute<{ id: string }>(async (req, staff, { id }) => json(await replaceWeek(staff, id, await readJson(req, weekSchema))));
