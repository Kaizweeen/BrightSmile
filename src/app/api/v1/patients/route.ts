import { json, readJson, staffRoute } from "@/server/api";
import { createPatient, createPatientSchema, searchPatients } from "@/server/patients";

export const GET = staffRoute(async (req, staff) => json(await searchPatients(staff, req.nextUrl.searchParams.get("q") ?? "")));

export const POST = staffRoute(async (req, staff) => json(await createPatient(staff, await readJson(req, createPatientSchema)), 201));
