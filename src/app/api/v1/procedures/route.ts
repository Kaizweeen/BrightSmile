import { json, readJson, staffRoute } from "@/server/api";
import { createProcedure, listProcedures, procedureSchema } from "@/server/procedures";

export const GET = staffRoute(async (req) =>
  json(await listProcedures({ activeOnly: req.nextUrl.searchParams.get("active") === "1" })),
);

export const POST = staffRoute(async (req, staff) => json(await createProcedure(staff, await readJson(req, procedureSchema)), 201));
