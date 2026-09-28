import { json, readJson, staffRoute } from "@/server/api";
import { branchPatchSchema, updateBranch } from "@/server/branches";

export const PATCH = staffRoute<{ code: string }>(async (req, staff, { code }) =>
  json(await updateBranch(staff, code, await readJson(req, branchPatchSchema))),
);
