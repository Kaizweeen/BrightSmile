import { json, publicRoute, readJson } from "@/server/api";
import { createOwner, setupSchema } from "@/server/setup";

export const POST = publicRoute(async (req) => json(await createOwner(await readJson(req, setupSchema)), 201));
