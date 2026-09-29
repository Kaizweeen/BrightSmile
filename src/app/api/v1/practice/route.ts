import { json, readJson, staffRoute } from "@/server/api";
import { practiceSchema, practiceSettings, updatePractice } from "@/server/practice";

/** Every signed-in staff member reads the settings: the booking panel needs the standard length. */
export const GET = staffRoute(async () => json(await practiceSettings()));

export const PATCH = staffRoute(async (req, staff) => json(await updatePractice(staff, await readJson(req, practiceSchema))));
