import { z } from "zod";
import { json, staffRoute } from "@/server/api";
import { overview } from "@/server/overview";

export const GET = staffRoute(async (req, staff) => json(await overview(staff, z.iso.date().parse(req.nextUrl.searchParams.get("date")))));
