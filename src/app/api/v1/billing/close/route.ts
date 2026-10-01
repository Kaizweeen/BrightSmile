import { json, readJson, staffRoute } from "@/server/api";
import { closeDay, closeSchema } from "@/server/billing";

export const POST = staffRoute(async (req, staff) => json(await closeDay(staff, await readJson(req, closeSchema))));
