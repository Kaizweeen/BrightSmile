import { json, readJson, staffRoute } from "@/server/api";
import { transitionAppointment, transitionSchema } from "@/server/appointments";

export const POST = staffRoute<{ id: string }>(async (req, staff, { id }) => {
  await transitionAppointment(staff, id, await readJson(req, transitionSchema));
  return json({ ok: true });
});
