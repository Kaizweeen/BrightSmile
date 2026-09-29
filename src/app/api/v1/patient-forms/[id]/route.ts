import { json, staffRoute } from "@/server/api";
import { discardPatientForm } from "@/server/patient-forms";

export const DELETE = staffRoute<{ id: string }>(async (_req, staff, { id }) => {
  await discardPatientForm(staff, id);
  return json({ ok: true });
});
