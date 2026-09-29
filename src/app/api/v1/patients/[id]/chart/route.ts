import { json, staffRoute } from "@/server/api";
import { patientChart } from "@/server/clinical";

export const GET = staffRoute<{ id: string }>(async (_req, staff, { id }) => json(await patientChart(staff, id)));
