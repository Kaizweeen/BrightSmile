import { json, readJson, staffRoute } from "@/server/api";
import { addChartEntry, chartEntrySchema } from "@/server/clinical";

export const POST = staffRoute<{ id: string }>(async (req, staff, { id }) =>
  json(await addChartEntry(staff, id, await readJson(req, chartEntrySchema)), 201),
);
