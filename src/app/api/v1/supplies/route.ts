import { json, readJson, staffRoute } from "@/server/api";
import { createSupply, listSupplies, suppliesQuerySchema, supplySchema } from "@/server/supplies";

export const GET = staffRoute(async (req, staff) =>
  json(await listSupplies(staff, suppliesQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams)).branch)),
);

export const POST = staffRoute(async (req, staff) => json(await createSupply(staff, await readJson(req, supplySchema)), 201));
