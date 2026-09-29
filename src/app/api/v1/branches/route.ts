import { json, readJson, staffRoute } from "@/server/api";
import { branchSchema, createBranch, listBranches } from "@/server/branches";

export const GET = staffRoute(async () => json(await listBranches()));

export const POST = staffRoute(async (req, staff) => json(await createBranch(staff, await readJson(req, branchSchema)), 201));
