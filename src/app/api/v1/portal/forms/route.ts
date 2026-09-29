import { clientKey, json, publicRoute, readJson } from "@/server/api";
import { patientFormSchema, sendPatientForm } from "@/server/patient-forms";

export const POST = publicRoute(async (req) => json(await sendPatientForm(await readJson(req, patientFormSchema), clientKey(req)), 201));
