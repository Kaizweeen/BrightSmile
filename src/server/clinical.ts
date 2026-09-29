import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { db } from "@/db";
import { appointments, branches, CHART_CODES, chairs, chartEntries, exams, patients, treatmentNotes, users, type ExamFindings } from "@/db/schema";
import { isTooth, needsSurfaces, SURFACES } from "@/lib/chart";
import { examFindingsSchema } from "@/lib/exam";
import { ACTIVE, type Status } from "@/lib/lifecycle";
import { audit } from "./audit";
import { ApiError, notFound } from "./errors";
import { requireCan } from "./guard";
import type { Staff } from "./session";

export const chartEntrySchema = z
  .object({
    tooth: z.number().int().refine(isTooth, "Pick a tooth on the chart"),
    code: z.enum(CHART_CODES),
    surfaces: z
      .array(z.enum(SURFACES))
      .max(5)
      .default([])
      .transform((list) => [...new Set(list)]),
    note: z.string().trim().max(300, "Use at most 300 characters").default(""),
  })
  .superRefine((entry, ctx) => {
    if (needsSurfaces(entry.code) && entry.surfaces.length === 0) {
      ctx.addIssue({ code: "custom", path: ["surfaces"], message: "Pick at least one surface" });
    }
    if (!needsSurfaces(entry.code) && entry.surfaces.length > 0) {
      ctx.addIssue({ code: "custom", path: ["surfaces"], message: "This code covers the whole tooth" });
    }
  });

export const voidSchema = z.object({ reason: z.string().trim().min(1, "Give a reason").max(200, "Use at most 200 characters") });

export const examSchema = z.object({ findings: examFindingsSchema });

export const noteSchema = z.object({
  body: z.string().trim().min(1, "Write the note").max(4000, "Use at most 4000 characters"),
  amendsId: z.uuid().nullable().optional(),
});

/** Visits a note can go on: the patient was seen or is being seen. */
const SEEN: readonly Status[] = ["checked_in", "in_treatment", "completed"];

async function requirePatient(id: string): Promise<void> {
  const [row] = await db.select({ id: patients.id }).from(patients).where(eq(patients.id, id));
  if (!row) throw notFound("That patient");
}

async function requireVisit(id: string) {
  const [visit] = await db
    .select({ id: appointments.id, patientId: appointments.patientId, dentistId: appointments.dentistId, branchId: appointments.branchId, status: appointments.status })
    .from(appointments)
    .where(eq(appointments.id, id));
  if (!visit) throw notFound("That visit");
  return { ...visit, status: visit.status as Status };
}

const voider = alias(users, "voider");

/** Spec 9.1: every chart entry of a patient, voided ones too, with who made it, where, and during which visit. */
export async function patientChart(actor: Staff, patientId: string) {
  requireCan(actor, "clinical.read");
  await requirePatient(patientId);
  const rows = await db
    .select({
      id: chartEntries.id,
      tooth: chartEntries.tooth,
      surfaces: chartEntries.surfaces,
      code: chartEntries.code,
      note: chartEntries.note,
      createdAt: chartEntries.createdAt,
      authorId: chartEntries.authorId,
      authorName: users.name,
      appointmentId: chartEntries.appointmentId,
      visitStart: appointments.startTime,
      branchName: branches.name,
      voidedAt: chartEntries.voidedAt,
      voidedByName: voider.name,
      voidReason: chartEntries.voidReason,
    })
    .from(chartEntries)
    .innerJoin(users, eq(users.id, chartEntries.authorId))
    .leftJoin(voider, eq(voider.id, chartEntries.voidedBy))
    .leftJoin(appointments, eq(appointments.id, chartEntries.appointmentId))
    .leftJoin(branches, eq(branches.id, chartEntries.branchId))
    .where(eq(chartEntries.patientId, patientId))
    .orderBy(asc(chartEntries.createdAt));
  await audit({ userId: actor.id, action: "patient.view", entity: "patient", entityId: patientId, details: { part: "chart" } });
  return rows;
}

/** Spec 9.1: the entry joins the author's visit with this patient that is checked in or in treatment, when there is one. */
export async function addChartEntry(actor: Staff, patientId: string, input: z.infer<typeof chartEntrySchema>): Promise<{ id: string }> {
  requireCan(actor, "clinical.write");
  await requirePatient(patientId);
  const [visit] = await db
    .select({ id: appointments.id, branchId: appointments.branchId })
    .from(appointments)
    .where(and(eq(appointments.patientId, patientId), eq(appointments.dentistId, actor.id), inArray(appointments.status, ["checked_in", "in_treatment"])))
    .orderBy(desc(appointments.startTime))
    .limit(1);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(chartEntries)
      .values({ ...input, patientId, appointmentId: visit?.id ?? null, branchId: visit?.branchId ?? null, authorId: actor.id })
      .returning({ id: chartEntries.id });
    await audit(
      { userId: actor.id, action: "chart.added", entity: "patient", entityId: patientId, branchId: visit?.branchId ?? null, details: { entryId: row.id } },
      tx,
    );
    return row;
  });
}

/** Spec 9.1: the author, or the owner when they see patients, voids an entry with a reason. The database allows it once. */
export async function voidChartEntry(actor: Staff, entryId: string, input: z.infer<typeof voidSchema>): Promise<void> {
  const [entry] = await db.select().from(chartEntries).where(eq(chartEntries.id, entryId));
  if (!entry) throw notFound("That chart entry");
  requireCan(actor, "clinical.write", { dentistId: entry.authorId });
  if (entry.voidedAt) throw new ApiError(422, "already_voided", "This entry is already voided.");
  await db.transaction(async (tx) => {
    await tx.update(chartEntries).set({ voidedAt: new Date(), voidedBy: actor.id, voidReason: input.reason }).where(eq(chartEntries.id, entryId));
    await audit(
      { userId: actor.id, action: "chart.voided", entity: "patient", entityId: entry.patientId, branchId: entry.branchId, details: { entryId } },
      tx,
    );
  });
}

/** Spec 9.2: a visit's exam (empty findings when none is saved), and whether it can still change. */
export async function visitExam(actor: Staff, appointmentId: string) {
  requireCan(actor, "clinical.read");
  const visit = await requireVisit(appointmentId);
  const [exam] = await db
    .select({ findings: exams.findings, updatedAt: exams.updatedAt, authorName: users.name })
    .from(exams)
    .innerJoin(users, eq(users.id, exams.authorId))
    .where(eq(exams.appointmentId, appointmentId));
  await audit({ userId: actor.id, action: "patient.view", entity: "patient", entityId: visit.patientId, details: { part: "exam", appointmentId } });
  return {
    findings: exam?.findings ?? {},
    updatedAt: exam?.updatedAt ?? null,
    authorName: exam?.authorName ?? null,
    dentistId: visit.dentistId,
    editable: ACTIVE.includes(visit.status),
  };
}

export async function saveExam(actor: Staff, appointmentId: string, findings: z.infer<typeof examFindingsSchema>): Promise<void> {
  const visit = await requireVisit(appointmentId);
  requireCan(actor, "clinical.write", { dentistId: visit.dentistId });
  if (!ACTIVE.includes(visit.status)) throw new ApiError(422, "exam_closed", "This visit is closed, so its exam can no longer change.");
  const saved = findings as ExamFindings;
  await db.transaction(async (tx) => {
    await tx
      .insert(exams)
      .values({ appointmentId, patientId: visit.patientId, authorId: actor.id, findings: saved })
      .onConflictDoUpdate({ target: exams.appointmentId, set: { findings: saved, authorId: actor.id, updatedAt: new Date() } });
    await audit(
      { userId: actor.id, action: "exam.saved", entity: "patient", entityId: visit.patientId, branchId: visit.branchId, details: { appointmentId } },
      tx,
    );
  });
}

/** Spec 9.3: a patient's treatment notes, newest first, with the dentist, branch, and chair of each visit. */
export async function patientNotes(actor: Staff, patientId: string) {
  requireCan(actor, "clinical.read");
  await requirePatient(patientId);
  const rows = await db
    .select({
      id: treatmentNotes.id,
      body: treatmentNotes.body,
      amendsId: treatmentNotes.amendsId,
      createdAt: treatmentNotes.createdAt,
      authorId: treatmentNotes.authorId,
      authorName: users.name,
      appointmentId: treatmentNotes.appointmentId,
      visitStart: appointments.startTime,
      branchName: branches.name,
      chairNumber: appointments.chairNumber,
      chairLabel: chairs.label,
    })
    .from(treatmentNotes)
    .innerJoin(users, eq(users.id, treatmentNotes.authorId))
    .innerJoin(appointments, eq(appointments.id, treatmentNotes.appointmentId))
    .innerJoin(branches, eq(branches.id, appointments.branchId))
    .leftJoin(chairs, and(eq(chairs.branchId, appointments.branchId), eq(chairs.number, appointments.chairNumber)))
    .where(eq(treatmentNotes.patientId, patientId))
    .orderBy(desc(treatmentNotes.createdAt));
  await audit({ userId: actor.id, action: "patient.view", entity: "patient", entityId: patientId, details: { part: "notes" } });
  return rows.map((r) => ({ ...r, chairLabel: r.chairLabel ?? "" }));
}

/** Spec 9.3: a note on a visit the patient came to. A correction names the note it amends, which must be this patient's. */
export async function addNote(actor: Staff, appointmentId: string, input: z.infer<typeof noteSchema>): Promise<{ id: string }> {
  const visit = await requireVisit(appointmentId);
  requireCan(actor, "clinical.write", { dentistId: visit.dentistId });
  if (input.amendsId) {
    // A correction goes on the visit of the note it corrects, so only that visit's dentist (or the owner who sees
    // patients) writes it; it needs no new check of the visit, since the note was valid when written.
    const [original] = await db.select({ appointmentId: treatmentNotes.appointmentId }).from(treatmentNotes).where(eq(treatmentNotes.id, input.amendsId));
    if (original?.appointmentId !== appointmentId) {
      throw new ApiError(400, "invalid", "Correct a note on its own visit.", { fields: { amendsId: "Correct a note on its own visit." } });
    }
  } else if (!SEEN.includes(visit.status)) {
    throw new ApiError(422, "not_seen", "Notes go on visits that are checked in, in treatment, or completed.");
  }
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(treatmentNotes)
      .values({ appointmentId, patientId: visit.patientId, authorId: actor.id, body: input.body, amendsId: input.amendsId ?? null })
      .returning({ id: treatmentNotes.id });
    await audit(
      { userId: actor.id, action: "note.added", entity: "patient", entityId: visit.patientId, branchId: visit.branchId, details: { noteId: row.id, appointmentId } },
      tx,
    );
    return row;
  });
}
