import { json, staffRoute } from "@/server/api";
import { createResetLink } from "@/server/staff";

export const POST = staffRoute<{ id: string }>(async (_req, staff, { id }) => json(await createResetLink(staff, id)));
