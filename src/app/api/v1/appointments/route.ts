import { json, readJson, staffRoute } from "@/server/api";
import { bookingSchema, createAppointment, listAppointments, listSchema } from "@/server/appointments";

export const GET = staffRoute(async (req, staff) =>
  json(await listAppointments(staff, listSchema.parse(Object.fromEntries(req.nextUrl.searchParams)))),
);

export const POST = staffRoute(async (req, staff) => json(await createAppointment(staff, await readJson(req, bookingSchema)), 201));
