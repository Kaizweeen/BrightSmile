import { json, readJson, staffRoute } from "@/server/api";
import { attachPatientForm, attachSchema } from "@/server/patient-forms";

export const POST = staffRoute<{ id: string }>(async (req, staff, { id }) => {
  await attachPatientForm(staff, id, await readJson(req, attachSchema));
  return json({ ok: true });
});
