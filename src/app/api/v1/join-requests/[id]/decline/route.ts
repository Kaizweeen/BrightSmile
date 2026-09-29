import { json, staffRoute } from "@/server/api";
import { declineRequest } from "@/server/staff";

export const POST = staffRoute<{ id: string }>(async (_req, staff, { id }) => {
  await declineRequest(staff, id);
  return json({ ok: true });
});
