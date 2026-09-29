import { json, readJson, staffRoute } from "@/server/api";
import { procedurePatchSchema, updateProcedure } from "@/server/procedures";

export const PATCH = staffRoute<{ id: string }>(async (req, staff, { id }) =>
  json(await updateProcedure(staff, id, await readJson(req, procedurePatchSchema))),
);
