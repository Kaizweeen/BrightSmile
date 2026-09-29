import { clientKey, json, publicRoute, readJson } from "@/server/api";
import { bookOnline, onlineBookingSchema } from "@/server/portal";

export const POST = publicRoute(async (req) => json(await bookOnline(await readJson(req, onlineBookingSchema), clientKey(req)), 201));
