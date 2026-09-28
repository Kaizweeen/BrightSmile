import { json, readJson, staffRoute } from "@/server/api";
import { updateStaff, updateStaffSchema } from "@/server/staff";

export const PATCH = staffRoute<{ id: string }>(async (req, staff, { id }) => {
  await updateStaff(staff, id, await readJson(req, updateStaffSchema));
  return json({ ok: true });
});
