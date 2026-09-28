import { json, readJson, staffRoute } from "@/server/api";
import { addChair, chairSchema, listChairs, requireBranch } from "@/server/branches";

export const GET = staffRoute<{ code: string }>(async (_req, _staff, { code }) => json(await listChairs((await requireBranch(code)).id)));

export const POST = staffRoute<{ code: string }>(async (req, staff, { code }) => {
  const branch = await requireBranch(code);
  return json(await addChair(staff, branch.id, await readJson(req, chairSchema)), 201);
});
