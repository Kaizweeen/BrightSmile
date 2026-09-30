import { json, readJson, staffRoute } from "@/server/api";
import { supplyPatchSchema, updateSupply } from "@/server/supplies";

export const PATCH = staffRoute<{ id: string }>(async (req, staff, { id }) =>
  json(await updateSupply(staff, id, await readJson(req, supplyPatchSchema))),
);
