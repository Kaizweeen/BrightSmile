import { json, readJson, staffRoute } from "@/server/api";
import { examSchema, saveExam, visitExam } from "@/server/clinical";

export const GET = staffRoute<{ id: string }>(async (_req, staff, { id }) => json(await visitExam(staff, id)));

export const PUT = staffRoute<{ id: string }>(async (req, staff, { id }) => {
  await saveExam(staff, id, (await readJson(req, examSchema)).findings);
  return json({ ok: true });
});
