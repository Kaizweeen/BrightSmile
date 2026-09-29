import { json, staffRoute } from "@/server/api";
import { listPatientForms, patientFormsQuerySchema } from "@/server/patient-forms";

export const GET = staffRoute(async (req, staff) => json(await listPatientForms(staff, patientFormsQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams)))));
