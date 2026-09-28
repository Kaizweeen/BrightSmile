import { json, staffRoute } from "@/server/api";
import { patientVisits } from "@/server/patients";

export const GET = staffRoute<{ id: string }>(async (_req, staff, { id }) => json(await patientVisits(staff, id)));
