import { json, readJson, staffRoute } from "@/server/api";
import { transitionAppointment, transitionSchema } from "@/server/appointments";

export const POST = staffRoute<{ id: string }>(async (req, staff, { id }) =>
  json({ ok: true, ...(await transitionAppointment(staff, id, await readJson(req, transitionSchema))) }),
);
