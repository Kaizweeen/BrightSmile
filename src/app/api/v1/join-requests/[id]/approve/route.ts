import { json, readJson, staffRoute } from "@/server/api";
import { approveRequest, approveSchema } from "@/server/staff";

export const POST = staffRoute<{ id: string }>(async (req, staff, { id }) => {
  await approveRequest(staff, id, await readJson(req, approveSchema));
  return json({ ok: true });
});
