import { json, readJson, staffRoute } from "@/server/api";
import { addTimeOff, listTimeOff, timeOffSchema } from "@/server/schedules";

export const GET = staffRoute<{ id: string }>(async (_req, staff, { id }) => json(await listTimeOff(staff, id)));

export const POST = staffRoute<{ id: string }>(async (req, staff, { id }) =>
  json(await addTimeOff(staff, id, await readJson(req, timeOffSchema)), 201),
);
