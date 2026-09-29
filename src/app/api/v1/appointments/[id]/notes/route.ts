import { json, readJson, staffRoute } from "@/server/api";
import { addNote, noteSchema } from "@/server/clinical";

export const POST = staffRoute<{ id: string }>(async (req, staff, { id }) => json(await addNote(staff, id, await readJson(req, noteSchema)), 201));
