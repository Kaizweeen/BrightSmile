import { json, readJson, staffRoute } from "@/server/api";
import { getPatient, updatePatient, updatePatientSchema } from "@/server/patients";

export const GET = staffRoute<{ id: string }>(async (_req, staff, { id }) => json(await getPatient(staff, id)));

export const PATCH = staffRoute<{ id: string }>(async (req, staff, { id }) => {
  await updatePatient(staff, id, await readJson(req, updatePatientSchema));
  return json({ ok: true });
});
