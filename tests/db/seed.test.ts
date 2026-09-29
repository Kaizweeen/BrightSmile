import { count, eq } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { appointments, branches, chairs, chartEntries, dentistSchedules, exams, patients, procedures, treatmentNotes, users } from "@/db/schema";
import { STATUSES } from "@/lib/lifecycle";
import { seed } from "@/server/seed";

const total = async (table: PgTable) => (await db.select({ n: count() }).from(table))[0].n;

describe("development data", () => {
  it("fills the practice with visits in every status, within the database rules", async () => {
    const { password, accounts } = await seed(new Date("2026-10-07T10:20:00+08:00"));
    expect(password.length).toBeGreaterThanOrEqual(10);
    expect(accounts).toHaveLength(9);
    expect(await total(branches)).toBe(3);
    expect(await total(chairs)).toBe(10);
    expect(await total(procedures)).toBe(7);
    expect(await total(users)).toBe(9);
    expect(await total(patients)).toBe(40);
    expect(await total(dentistSchedules)).toBeGreaterThan(0);
    const statuses = await db.selectDistinct({ status: appointments.status }).from(appointments);
    expect(statuses.map((s) => s.status).sort()).toEqual([...STATUSES].sort());
    expect(await total(chartEntries)).toBeGreaterThan(0);
    expect(await total(exams)).toBeGreaterThan(0);
    expect(await total(treatmentNotes)).toBeGreaterThan(0);
    // Each clinical record belongs to a completed visit, written by that visit's dentist when it ended.
    type Row = { author: string; at: Date; dentist: string; end: Date; status: string };
    const fits = (rows: Row[]) => rows.length > 0 && rows.every((r) => r.status === "completed" && r.author === r.dentist && r.at.getTime() === r.end.getTime());
    const visit = { dentist: appointments.dentistId, end: appointments.endTime, status: appointments.status };
    expect(fits(await db.select({ author: chartEntries.authorId, at: chartEntries.createdAt, ...visit }).from(chartEntries).innerJoin(appointments, eq(appointments.id, chartEntries.appointmentId)))).toBe(true);
    expect(fits(await db.select({ author: exams.authorId, at: exams.createdAt, ...visit }).from(exams).innerJoin(appointments, eq(appointments.id, exams.appointmentId)))).toBe(true);
    expect(fits(await db.select({ author: treatmentNotes.authorId, at: treatmentNotes.createdAt, ...visit }).from(treatmentNotes).innerJoin(appointments, eq(appointments.id, treatmentNotes.appointmentId)))).toBe(true);
  });

  it("refuses a database that already has data", async () => {
    await expect(seed()).rejects.toThrow("already has data");
  });
});
