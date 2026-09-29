import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import * as s from "@/db/schema";

const OPEN = { open: "09:00", close: "18:00" };
const HOURS = { "0": null, "1": OPEN, "2": OPEN, "3": OPEN, "4": OPEN, "5": OPEN, "6": OPEN };

function sqlState(error: unknown): string | undefined {
  for (let e = error as { code?: unknown; cause?: unknown } | undefined; e; e = e.cause as typeof e) {
    if (typeof e.code === "string") return e.code;
  }
  return undefined;
}

async function refusal(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return sqlState(error);
  }
  return undefined;
}

let n = 0;
async function world() {
  n += 1;
  const [a] = await db
    .insert(s.branches)
    .values({ code: `a${n}`, name: "Downtown", operatingHours: HOURS, joinCode: `ja${n}` })
    .returning();
  const [b] = await db
    .insert(s.branches)
    .values({ code: `b${n}`, name: "Westside", operatingHours: HOURS, joinCode: `jb${n}` })
    .returning();
  await db.insert(s.chairs).values([
    { branchId: a.id, number: 1 },
    { branchId: a.id, number: 2 },
    { branchId: b.id, number: 1 },
  ]);
  const dentist = async (name: string) =>
    (
      await db
        .insert(s.users)
        .values({
          name: `Dr ${name}`,
          email: `${name}${n}@users.invalid`,
          username: `${name}${n}`,
          role: "dentist",
          status: "active",
          seesPatients: true,
        })
        .returning()
    )[0];
  const patient = async (firstName: string) =>
    (await db.insert(s.patients).values({ lastName: "Santos", firstName }).returning())[0];
  return { a, b, reyes: await dentist("reyes"), lim: await dentist("lim"), ana: await patient("Ana"), ben: await patient("Ben") };
}

const at = (hhmm: string) => new Date(`2026-10-05T${hhmm}:00+08:00`);

function visit(v: {
  patientId: string;
  dentistId: string;
  branchId: string;
  chair?: number;
  start: string;
  end: string;
  free?: string;
  status?: string;
}) {
  return {
    patientId: v.patientId,
    dentistId: v.dentistId,
    branchId: v.branchId,
    chairNumber: v.chair ?? 1,
    startTime: at(v.start),
    endTime: at(v.end),
    chairFreeAt: at(v.free ?? v.end),
    status: v.status ?? "confirmed",
    source: "staff",
  };
}

describe("overlaps", () => {
  it("refuses one dentist at two branches at once", async () => {
    const w = await world();
    await db.insert(s.appointments).values(visit({ patientId: w.ana.id, dentistId: w.reyes.id, branchId: w.a.id, start: "09:00", end: "10:00" }));
    const code = await refusal(
      db.insert(s.appointments).values(visit({ patientId: w.ben.id, dentistId: w.reyes.id, branchId: w.b.id, start: "09:30", end: "10:30" })),
    );
    expect(code).toBe("23P01");
  });

  it("refuses a chair during turnover and frees it when turnover ends", async () => {
    const w = await world();
    await db.insert(s.appointments).values(visit({ patientId: w.ana.id, dentistId: w.reyes.id, branchId: w.a.id, start: "09:00", end: "09:45", free: "10:00" }));
    const code = await refusal(
      db.insert(s.appointments).values(visit({ patientId: w.ben.id, dentistId: w.lim.id, branchId: w.a.id, start: "09:50", end: "10:20" })),
    );
    expect(code).toBe("23P01");
    await db.insert(s.appointments).values(visit({ patientId: w.ben.id, dentistId: w.lim.id, branchId: w.a.id, start: "10:00", end: "10:30" }));
  });

  it("lets the dentist start at another chair during turnover", async () => {
    const w = await world();
    await db.insert(s.appointments).values(visit({ patientId: w.ana.id, dentistId: w.reyes.id, branchId: w.a.id, start: "09:00", end: "09:45", free: "10:00" }));
    await db.insert(s.appointments).values(visit({ patientId: w.ben.id, dentistId: w.reyes.id, branchId: w.a.id, chair: 2, start: "09:45", end: "10:15" }));
  });

  it("refuses one patient in two visits at once", async () => {
    const w = await world();
    await db.insert(s.appointments).values(visit({ patientId: w.ana.id, dentistId: w.reyes.id, branchId: w.a.id, start: "09:00", end: "10:00" }));
    const code = await refusal(
      db.insert(s.appointments).values(visit({ patientId: w.ana.id, dentistId: w.lim.id, branchId: w.b.id, start: "09:30", end: "10:00" })),
    );
    expect(code).toBe("23P01");
  });

  it("frees the time of cancelled and no-show visits", async () => {
    const w = await world();
    const [first] = await db
      .insert(s.appointments)
      .values(visit({ patientId: w.ana.id, dentistId: w.reyes.id, branchId: w.a.id, start: "09:00", end: "10:00" }))
      .returning();
    await db.update(s.appointments).set({ status: "cancelled", cancelReason: "Patient called" }).where(eq(s.appointments.id, first.id));
    const [second] = await db
      .insert(s.appointments)
      .values(visit({ patientId: w.ben.id, dentistId: w.reyes.id, branchId: w.a.id, start: "09:00", end: "10:00" }))
      .returning();
    await db.update(s.appointments).set({ status: "no_show" }).where(eq(s.appointments.id, second.id));
    await db.insert(s.appointments).values(visit({ patientId: w.ana.id, dentistId: w.reyes.id, branchId: w.a.id, start: "09:00", end: "10:00" }));
  });
});

describe("lifecycle", () => {
  it("walks every allowed change and stamps each time", async () => {
    const w = await world();
    const [v] = await db
      .insert(s.appointments)
      .values(visit({ patientId: w.ana.id, dentistId: w.reyes.id, branchId: w.a.id, start: "09:00", end: "10:00", status: "requested" }))
      .returning();
    expect(v.confirmedAt).toBeNull();
    const move = async (status: string) =>
      (await db.update(s.appointments).set({ status }).where(eq(s.appointments.id, v.id)).returning())[0];
    expect((await move("confirmed")).confirmedAt).not.toBeNull();
    expect((await move("checked_in")).checkedInAt).not.toBeNull();
    expect((await move("confirmed")).checkedInAt).toBeNull();
    await move("no_show");
    await move("checked_in");
    expect((await move("in_treatment")).treatmentStartedAt).not.toBeNull();
    expect((await move("completed")).completedAt).not.toBeNull();
  });

  it("refuses every other change", async () => {
    const w = await world();
    const [v] = await db
      .insert(s.appointments)
      .values(visit({ patientId: w.ana.id, dentistId: w.reyes.id, branchId: w.a.id, start: "09:00", end: "10:00" }))
      .returning();
    for (const status of ["completed", "in_treatment", "requested"]) {
      expect(await refusal(db.update(s.appointments).set({ status }).where(eq(s.appointments.id, v.id)))).toBe("DS001");
    }
    await db.update(s.appointments).set({ status: "cancelled", cancelReason: "Moved away" }).where(eq(s.appointments.id, v.id));
    expect(await refusal(db.update(s.appointments).set({ status: "confirmed" }).where(eq(s.appointments.id, v.id)))).toBe("DS001");
  });

  it("starts a visit only as requested, confirmed, or checked in", async () => {
    const w = await world();
    for (const status of ["completed", "in_treatment", "no_show"]) {
      const code = await refusal(
        db.insert(s.appointments).values(visit({ patientId: w.ana.id, dentistId: w.reyes.id, branchId: w.a.id, start: "11:00", end: "11:30", status })),
      );
      expect(code).toBe("DS001");
    }
    const [walkIn] = await db
      .insert(s.appointments)
      .values(visit({ patientId: w.ana.id, dentistId: w.reyes.id, branchId: w.a.id, start: "11:00", end: "11:30", status: "checked_in" }))
      .returning();
    expect(walkIn.checkedInAt).not.toBeNull();
  });

  it("needs a reason to cancel", async () => {
    const w = await world();
    const [v] = await db
      .insert(s.appointments)
      .values(visit({ patientId: w.ana.id, dentistId: w.reyes.id, branchId: w.a.id, start: "09:00", end: "10:00" }))
      .returning();
    expect(await refusal(db.update(s.appointments).set({ status: "cancelled" }).where(eq(s.appointments.id, v.id)))).toBe("23514");
  });

  it("keeps a chair inside its branch", async () => {
    const w = await world();
    const code = await refusal(
      db.insert(s.appointments).values(visit({ patientId: w.ana.id, dentistId: w.reyes.id, branchId: w.b.id, chair: 2, start: "09:00", end: "10:00" })),
    );
    expect(code).toBe("23503");
  });
});

describe("schedules", () => {
  it("refuses overlapping blocks at two branches but allows split days", async () => {
    const w = await world();
    await db.insert(s.dentistSchedules).values({ dentistId: w.reyes.id, branchId: w.a.id, dayOfWeek: 1, startTime: "09:00", endTime: "12:00" });
    const code = await refusal(
      db.insert(s.dentistSchedules).values({ dentistId: w.reyes.id, branchId: w.b.id, dayOfWeek: 1, startTime: "11:00", endTime: "15:00" }),
    );
    expect(code).toBe("23P01");
    await db.insert(s.dentistSchedules).values({ dentistId: w.reyes.id, branchId: w.b.id, dayOfWeek: 1, startTime: "13:00", endTime: "17:00" });
  });

  it("keeps blocks on the 15-minute grid", async () => {
    const w = await world();
    const code = await refusal(
      db.insert(s.dentistSchedules).values({ dentistId: w.reyes.id, branchId: w.a.id, dayOfWeek: 2, startTime: "09:10", endTime: "12:00" }),
    );
    expect(code).toBe("23514");
  });
});

describe("records that are never edited", () => {
  it("refuses changing or deleting the audit log and treatment notes", async () => {
    const w = await world();
    const [log] = await db.insert(s.auditLog).values({ action: "test", entity: "test" }).returning();
    expect(await refusal(db.delete(s.auditLog).where(eq(s.auditLog.id, log.id)))).toBe("DS002");
    const [v] = await db
      .insert(s.appointments)
      .values(visit({ patientId: w.ana.id, dentistId: w.reyes.id, branchId: w.a.id, start: "09:00", end: "10:00" }))
      .returning();
    const [note] = await db
      .insert(s.treatmentNotes)
      .values({ appointmentId: v.id, patientId: w.ana.id, authorId: w.reyes.id, body: "Cleaning done." })
      .returning();
    expect(await refusal(db.update(s.treatmentNotes).set({ body: "Changed" }).where(eq(s.treatmentNotes.id, note.id)))).toBe("DS002");
  });

  it("voids a chart entry once and changes nothing else", async () => {
    const w = await world();
    const [entry] = await db
      .insert(s.chartEntries)
      .values({ patientId: w.ana.id, tooth: 16, surfaces: ["O"], code: "Co", authorId: w.reyes.id })
      .returning();
    expect(await refusal(db.update(s.chartEntries).set({ code: "Am" }).where(eq(s.chartEntries.id, entry.id)))).toBe("DS002");
    await db
      .update(s.chartEntries)
      .set({ voidedAt: new Date(), voidedBy: w.reyes.id, voidReason: "Wrong tooth" })
      .where(eq(s.chartEntries.id, entry.id));
    expect(await refusal(db.update(s.chartEntries).set({ voidReason: "Again" }).where(eq(s.chartEntries.id, entry.id)))).toBe("DS002");
    expect(await refusal(db.insert(s.chartEntries).values({ patientId: w.ana.id, tooth: 19, code: "Co", authorId: w.reyes.id }))).toBe("23514");
  });
});

describe("people", () => {
  it("allows one owner", async () => {
    await db.insert(s.users).values({ name: "First Owner", email: "o1@users.invalid", username: "owner.one", role: "owner", status: "active" });
    const code = await refusal(
      db.insert(s.users).values({ name: "Second Owner", email: "o2@users.invalid", username: "owner.two", role: "owner", status: "active" }),
    );
    expect(code).toBe("23505");
  });

  it("checks mobiles and allergies", async () => {
    expect(await refusal(db.insert(s.patients).values({ lastName: "Cruz", firstName: "Carlo", mobile: "09171234567" }))).toBe("23514");
    expect(await refusal(db.insert(s.patients).values({ lastName: "Cruz", firstName: "Carlo", allergies: ["peanuts"] }))).toBe("23514");
    const [p] = await db
      .insert(s.patients)
      .values({ lastName: "Cruz", firstName: "Carlo", mobile: "+639171234567", allergies: ["latex"] })
      .returning();
    expect(p.chartNo).toBeGreaterThan(0);
  });
});

describe("row level security", () => {
  it("covers every table, so Supabase's Data API could never read one even if it were turned on", async () => {
    // Both drivers answer raw SQL with { rows }; the shared Db type cannot say so.
    const { rows } = (await db.execute(
      sql`select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'`,
    )) as unknown as { rows: { relname: string; relrowsecurity: boolean }[] };
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((table) => !table.relrowsecurity).map((table) => table.relname)).toEqual([]);
  });
});
