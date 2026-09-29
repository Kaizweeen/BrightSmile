import { json, staffRoute } from "@/server/api";
import { replaceJoinCode } from "@/server/branches";

export const POST = staffRoute<{ code: string }>(async (_req, staff, { code }) => {
  await replaceJoinCode(staff, code);
  return json({ ok: true });
});
