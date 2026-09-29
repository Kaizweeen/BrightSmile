import { json, readJson, staffRoute } from "@/server/api";
import { voidChartEntry, voidSchema } from "@/server/clinical";

export const POST = staffRoute<{ id: string }>(async (req, staff, { id }) => {
  await voidChartEntry(staff, id, await readJson(req, voidSchema));
  return json({ ok: true });
});
