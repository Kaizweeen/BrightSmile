import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { ALLERGIES, appointmentProcedures, appointments, branches, chairs, patients, users } from "@/db/schema";
import { ACTIVE, type Status } from "@/lib/lifecycle";
import { can } from "@/lib/permissions";
import { manilaDate } from "@/lib/time";
import { mobileSchema, normalizeMobile } from "@/lib/validation";
import { audit } from "./audit";
import { branchByCode } from "./branches";
import { ApiError, forbidden, notFound } from "./errors";
import { requireCan } from "./guard";
import type { Staff } from "./session";

/** Form fields arrive as strings; an empty one means "nothing". */
const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const optional = <T extends z.ZodType>(schema: T) => z.preprocess(blankToNull, schema.nullable()).optional();
const text = (max: number) => optional(z.string().trim().max(max, `Use at most ${max} characters`));
const isoDate = z.iso.date("Use a date like 1990-04-02");

export const patientSchema = z.object({
  lastName: z.string().trim().min(1, "Enter the last name").max(50, "Use at most 50 characters"),
  firstName: z.string().trim().min(1, "Enter the first name").max(50, "Use at most 50 characters"),
  middleName: text(50),
  birthday: optional(isoDate.refine((d) => d >= "1900-01-01" && d <= manilaDate(new Date()), "Use a real birthday")),
  sex: optional(z.enum(["female", "male"])),
  mobile: optional(mobileSchema),
  email: optional(z.string().trim().max(254, "Use at most 254 characters").pipe(z.email("Use an email like name@example.com"))),
  address: text(200),
  occupation: text(60),
  guardianName: text(100),
  emergencyName: text(100),
  emergencyMobile: optional(mobileSchema),
  hmoProvider: text(60),
  hmoMemberNo: text(40),
  insuranceEffective: optional(isoDate),
  allergies: z.array(z.enum(ALLERGIES)).max(ALLERGIES.length).optional(),
  allergiesOther: text(100),
  medicalAlerts: z.string().trim().max(500, "Use at most 500 characters").optional(),
  consent: z.boolean().optional(),
});

export const createPatientSchema = patientSchema.extend({
  allowDuplicate: z.boolean().optional(),
  homeBranch: z.string().optional(),
});

export const updatePatientSchema = patientSchema.partial();

export type PatientSummary = {
  id: string;
  chartNo: number;
  lastName: string;
  firstName: string;
  birthday: string | null;
  mobile: string | null;
  hasAlerts: boolean;
};

const hasAlerts = sql<boolean>`(cardinality(${patients.allergies}) > 0 or ${patients.allergiesOther} is not null or ${patients.medicalAlerts} <> '')`;
const summary = {
  id: patients.id,
  chartNo: patients.chartNo,
  lastName: patients.lastName,
  firstName: patients.firstName,
  birthday: patients.birthday,
  mobile: patients.mobile,
  hasAlerts,
};

const likeTerm = (term: string) => `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** Search by name, chart number, mobile, or birthday (YYYY-MM-DD). An empty search lists the latest updated patients. */
export async function searchPatients(actor: Staff, q: string): Promise<PatientSummary[]> {
  requireCan(actor, "patient.view");
  const term = q.trim().slice(0, 80);
  const query = db.select(summary).from(patients);
  if (!term) return query.orderBy(desc(patients.updatedAt)).limit(20);
  const pattern = likeTerm(term);
  const matches: (SQL | undefined)[] = [
    ilike(sql`${patients.lastName} || ', ' || ${patients.firstName}`, pattern),
    ilike(sql`${patients.firstName} || ' ' || ${patients.lastName}`, pattern),
  ];
  if (/^\d{1,9}$/.test(term)) matches.push(eq(patients.chartNo, Number(term)));
  const mobile = normalizeMobile(term);
  if (mobile) matches.push(eq(patients.mobile, mobile));
  if (/^\d{4}-\d{2}-\d{2}$/.test(term)) matches.push(eq(patients.birthday, term));
  return query.where(or(...matches)).orderBy(asc(patients.lastName), asc(patients.firstName)).limit(20);
}

async function duplicates(p: { lastName: string; firstName: string; birthday?: string | null; mobile?: string | null }): Promise<PatientSummary[]> {
  const sameName = and(sql`lower(${patients.lastName}) = lower(${p.lastName})`, sql`lower(${patients.firstName}) = lower(${p.firstName})`);
  const checks: SQL[] = [];
  if (p.birthday) checks.push(and(sameName, eq(patients.birthday, p.birthday)) as SQL);
  if (p.mobile) checks.push(and(eq(patients.mobile, p.mobile), sql`lower(${patients.firstName}) = lower(${p.firstName})`) as SQL);
  if (checks.length === 0) return [];
  return db.select(summary).from(patients).where(or(...checks)).limit(5);
}

/** Spec 10: a patient with the same name and birthday, or the same mobile and first name, is probably already on file. */
export async function createPatient(actor: Staff, input: z.infer<typeof createPatientSchema>): Promise<{ id: string; chartNo: number }> {
  requireCan(actor, "patient.edit");
  const { allowDuplicate, homeBranch, consent, ...fields } = input;
  if (!allowDuplicate) {
    const candidates = await duplicates(fields);
    if (candidates.length > 0) {
      throw new ApiError(409, "possible_duplicate", "This patient may already be on file.", { candidates });
    }
  }
  const home = homeBranch ? await branchByCode(homeBranch) : null;
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(patients)
      .values({
        ...fields,
        allergies: fields.allergies ?? [],
        medicalAlerts: fields.medicalAlerts ?? "",
        consentAt: consent ? new Date() : null,
        consentBy: consent ? actor.id : null,
        homeBranchId: home?.id ?? null,
        createdBy: actor.id,
        updatedBy: actor.id,
      })
      .returning({ id: patients.id, chartNo: patients.chartNo });
    await audit({ userId: actor.id, action: "patient.created", entity: "patient", entityId: row.id, branchId: home?.id ?? null }, tx);
    return row;
  });
}

/** One patient record. Every view is written to the audit log (spec 13). */
export async function getPatient(actor: Staff, id: string) {
  requireCan(actor, "patient.view");
  const [row] = await db
    .select({ patient: patients, consentByName: users.name, homeBranchName: branches.name })
    .from(patients)
    .leftJoin(users, eq(users.id, patients.consentBy))
    .leftJoin(branches, eq(branches.id, patients.homeBranchId))
    .where(eq(patients.id, id));
  if (!row) throw notFound("That patient");
  await audit({ userId: actor.id, action: "patient.view", entity: "patient", entityId: id, details: { part: "details" } });
  return { ...row.patient, consentByName: row.consentByName, homeBranchName: row.homeBranchName };
}

const ALERT_FIELDS = new Set(["allergies", "allergiesOther", "medicalAlerts"]);

/** Owner and front desk change everything; a dentist changes allergies and medical alerts only (spec 5). */
export async function updatePatient(actor: Staff, id: string, patch: z.infer<typeof updatePatientSchema>): Promise<void> {
  const changed = Object.entries(patch)
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key);
  if (changed.length === 0) throw new ApiError(400, "invalid", "Nothing to change.");
  if (!can(actor, "patient.edit")) {
    if (changed.some((key) => !ALERT_FIELDS.has(key))) throw forbidden("You can change allergies and medical alerts only.");
    requireCan(actor, "patient.editAlerts");
  }
  const { consent, ...fields } = patch;
  await db.transaction(async (tx) => {
    const [current] = await tx.select({ consentAt: patients.consentAt }).from(patients).where(eq(patients.id, id)).for("update");
    if (!current) throw notFound("That patient");
    await tx
      .update(patients)
      .set({
        ...fields,
        ...(consent && !current.consentAt ? { consentAt: new Date(), consentBy: actor.id } : {}),
        updatedAt: new Date(),
        updatedBy: actor.id,
      })
      .where(eq(patients.id, id));
    await audit({ userId: actor.id, action: "patient.updated", entity: "patient", entityId: id, details: { fields: changed } }, tx);
  });
}

export type PatientVisit = {
  id: string;
  start: Date;
  end: Date;
  status: Status;
  branchCode: string;
  branchName: string;
  chairNumber: number;
  chairLabel: string;
  dentistName: string;
  procedures: string[];
};

/** Every visit of a patient, newest first, at every branch (spec 9.3), and their next active visit. */
export async function patientVisits(actor: Staff, id: string): Promise<{ visits: PatientVisit[]; next: PatientVisit | null }> {
  requireCan(actor, "patient.view");
  const rows = await db
    .select({
      id: appointments.id,
      start: appointments.startTime,
      end: appointments.endTime,
      status: appointments.status,
      branchCode: branches.code,
      branchName: branches.name,
      chairNumber: appointments.chairNumber,
      chairLabel: chairs.label,
      dentistName: users.name,
    })
    .from(appointments)
    .innerJoin(branches, eq(branches.id, appointments.branchId))
    .innerJoin(users, eq(users.id, appointments.dentistId))
    .leftJoin(chairs, and(eq(chairs.branchId, appointments.branchId), eq(chairs.number, appointments.chairNumber)))
    .where(eq(appointments.patientId, id))
    .orderBy(desc(appointments.startTime));
  const ids = rows.map((r) => r.id);
  const procs = ids.length
    ? await db.select().from(appointmentProcedures).where(inArray(appointmentProcedures.appointmentId, ids)).orderBy(asc(appointmentProcedures.position))
    : [];
  const visits = rows.map((r) => ({
    ...r,
    status: r.status as Status,
    chairLabel: r.chairLabel ?? "",
    procedures: procs.filter((p) => p.appointmentId === r.id).map((p) => p.name),
  }));
  await audit({ userId: actor.id, action: "patient.view", entity: "patient", entityId: id, details: { part: "visits" } });
  const now = Date.now();
  const upcoming = visits
    .filter((v) => ACTIVE.includes(v.status) && v.start.getTime() > now)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  return { visits, next: upcoming[0] ?? null };
}
