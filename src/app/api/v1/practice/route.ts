import { json, readJson, staffRoute } from "@/server/api";
import { practiceSchema, renamePractice } from "@/server/practice";

export const PATCH = staffRoute(async (req, staff) => {
  await renamePractice(staff, await readJson(req, practiceSchema));
  return json({ ok: true });
});
