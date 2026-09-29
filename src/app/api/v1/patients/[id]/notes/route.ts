import { json, staffRoute } from "@/server/api";
import { patientNotes } from "@/server/clinical";

export const GET = staffRoute<{ id: string }>(async (_req, staff, { id }) => json(await patientNotes(staff, id)));
