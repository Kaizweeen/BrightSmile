import { json, publicRoute, readJson } from "@/server/api";
import { recoverOwner, recoverSchema } from "@/server/setup";

export const POST = publicRoute(async (req) => json(await recoverOwner(await readJson(req, recoverSchema))));
