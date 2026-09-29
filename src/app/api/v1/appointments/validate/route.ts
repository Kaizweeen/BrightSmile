import { json, readJson, staffRoute } from "@/server/api";
import { validateBooking, validateSchema } from "@/server/appointments";

export const POST = staffRoute(async (req, staff) => json(await validateBooking(staff, await readJson(req, validateSchema))));
