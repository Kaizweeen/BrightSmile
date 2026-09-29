import { json, readJson, staffRoute } from "@/server/api";
import { appointmentDetail, moveAppointment, moveSchema } from "@/server/appointments";

export const GET = staffRoute<{ id: string }>(async (_req, staff, { id }) => json(await appointmentDetail(staff, id)));

export const PATCH = staffRoute<{ id: string }>(async (req, staff, { id }) => {
  await moveAppointment(staff, id, await readJson(req, moveSchema));
  return json({ ok: true });
});
