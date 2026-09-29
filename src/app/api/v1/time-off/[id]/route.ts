import { json, staffRoute } from "@/server/api";
import { removeTimeOff } from "@/server/schedules";

export const DELETE = staffRoute<{ id: string }>(async (_req, staff, { id }) => {
  await removeTimeOff(staff, id);
  return json({ ok: true });
});
