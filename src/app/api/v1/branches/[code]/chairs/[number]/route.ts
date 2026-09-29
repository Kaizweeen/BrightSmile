import { json, readJson, staffRoute } from "@/server/api";
import { chairPatchSchema, requireBranch, updateChair } from "@/server/branches";

export const PATCH = staffRoute<{ code: string; number: string }>(async (req, staff, { code, number }) => {
  const branch = await requireBranch(code);
  return json(await updateChair(staff, branch.id, Number(number), await readJson(req, chairPatchSchema)));
});
