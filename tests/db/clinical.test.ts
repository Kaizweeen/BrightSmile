import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as examRoute from "@/app/api/v1/appointments/[id]/exam/route";
import * as visitNotesRoute from "@/app/api/v1/appointments/[id]/notes/route";
import * as voidRoute from "@/app/api/v1/chart-entries/[id]/void/route";
import * as chartEntriesRoute from "@/app/api/v1/patients/[id]/chart-entries/route";
import * as chartRoute from "@/app/api/v1/patients/[id]/chart/route";
import * as notesRoute from "@/app/api/v1/patients/[id]/notes/route";
import * as visitsRoute from "@/app/api/v1/patients/[id]/visits/route";
import { db } from "@/db";
import { appointments, auditLog, chairs, patients } from "@/db/schema";
import type { Status } from "@/lib/lifecycle";
import { call, makeBranch, makeUser, request, signIn } from "../helpers";

/** The next quarter hour plus whole hours, so visits sit on the grid. */
const inHours = (n: number) => new Date(Math.ceil(Date.now() / 900_000) * 900_000 + n * 3_600_000);

// The status changes that take a new visit to each status, through the lifecycle trigger.
const PATH: Partial<Record<Status, Status[]>> = {
  in_treatment: ["checked_in", "in_treatment"],
  completed: ["checked_in", "in_treatment", "completed"],
};

async function build() {
  const dt = await makeBranch({ code: "downtown", name: "Downtown" });
  await db.insert(chairs).values({ branchId: dt.id, number: 1, label: "General" });
  const reyes = await makeUser({ role: "dentist", name: "Dr. Reyes", branchIds: [dt.id] });
  const lim = await makeUser({ role: "dentist", name: "Dr. Lim", branchIds: [dt.id] });
  const desk = await makeUser({ role: "manager", branchIds: [dt.id] });
  const owner = await makeUser({ role: "owner", seesPatients: true });
  const [ana] = await db.insert(patients).values({ lastName: "Santos", firstName: "Ana" }).returning();
  const visit = async (status: Status, hours: number) => {
    const start = inHours(hours);
    const end = new Date(start.getTime() + 1_800_000);
    const [row] = await db
      .insert(appointments)
      .values({ patientId: ana.id, dentistId: reyes.id, branchId: dt.id, chairNumber: 1, startTime: start, endTime: end, chairFreeAt: end, status: status === "requested" ? "requested" : "confirmed", source: "staff" })
      .returning();
    for (const to of PATH[status] ?? []) await db.update(appointments).set({ status: to }).where(eq(appointments.id, row.id));
    return row.id;
  };
  return {
    ana,
    today: await visit("in_treatment", 0),
    earlier: await visit("completed", -48),
    later: await visit("requested", 48),
    reyes: await signIn(reyes.username),
    lim: await signIn(lim.username),
    desk: await signIn(desk.username),
    owner: await signIn(owner.username),
  };
}
let worldPromise: ReturnType<typeof build> | undefined;
const world = () => (worldPromise ??= build());

const chart = (cookie: string, id: string) => call(chartRoute.GET, request(`/api/v1/patients/${id}/chart`, { cookie }), { id });
const addEntry = (cookie: string, id: string, body: object) =>
  call(chartEntriesRoute.POST, request(`/api/v1/patients/${id}/chart-entries`, { method: "POST", cookie, body }), { id });
const voidEntry = (cookie: string, id: string) =>
  call(voidRoute.POST, request(`/api/v1/chart-entries/${id}/void`, { method: "POST", cookie, body: { reason: "Wrong tooth" } }), { id });
const putExam = (cookie: string, id: string, findings: object) =>
  call(examRoute.PUT, request(`/api/v1/appointments/${id}/exam`, { method: "PUT", cookie, body: { findings } }), { id });
const addNote = (cookie: string, id: string, body: object) =>
  call(visitNotesRoute.POST, request(`/api/v1/appointments/${id}/notes`, { method: "POST", cookie, body }), { id });

describe("the dental chart", () => {
  it("records an entry on the dentist's visit in treatment, for everyone to read", async () => {
    const w = await world();
    expect((await addEntry(w.reyes, w.ana.id, { tooth: 16, code: "Co", surfaces: ["O", "M"], note: "Small" })).status).toBe(201);
    const res = await chart(w.desk, w.ana.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject([
      { tooth: 16, code: "Co", surfaces: ["O", "M"], note: "Small", authorName: "Dr. Reyes", branchName: "Downtown", appointmentId: w.today, voidedAt: null },
    ]);
  });

  it("refuses the front desk, codes on the wrong surfaces, and teeth not on the chart", async () => {
    const w = await world();
    expect((await addEntry(w.desk, w.ana.id, { tooth: 16, code: "D", surfaces: ["O"] })).status).toBe(403);
    const bare = await addEntry(w.reyes, w.ana.id, { tooth: 16, code: "D" });
    expect(bare.status).toBe(400);
    expect((await bare.json()).error.fields).toEqual({ surfaces: "Pick at least one surface" });
    expect((await addEntry(w.reyes, w.ana.id, { tooth: 16, code: "X", surfaces: ["O"] })).status).toBe(400);
    expect((await addEntry(w.reyes, w.ana.id, { tooth: 19, code: "X" })).status).toBe(400);
    expect((await chart(w.desk, "not-a-uuid")).status).toBe(404);
  });

  it("lets the author or the owner who sees patients void an entry once, with a reason", async () => {
    const w = await world();
    const { id } = await (await addEntry(w.reyes, w.ana.id, { tooth: 21, code: "present" })).json();
    expect((await voidEntry(w.lim, id)).status).toBe(403);
    expect((await voidEntry(w.reyes, id)).status).toBe(200);
    expect((await voidEntry(w.owner, id)).status).toBe(422);
    const entries = await (await chart(w.desk, w.ana.id)).json();
    expect(entries.find((e: { id: string }) => e.id === id)).toMatchObject({ voidReason: "Wrong tooth", voidedByName: "Dr. Reyes" });
  });
});

describe("the exam", () => {
  it("saves the findings of the dentist's open visit and reads them back", async () => {
    const w = await world();
    const findings = { periodontal: { gingivitis: "" }, xrays: { periapical: "16, 26" } };
    expect((await putExam(w.reyes, w.today, findings)).status).toBe(200);
    const res = await call(examRoute.GET, request(`/api/v1/appointments/${w.today}/exam`, { cookie: w.desk }), { id: w.today });
    expect(await res.json()).toMatchObject({ findings, editable: true, authorName: "Dr. Reyes" });
  });

  it("refuses unknown findings, other dentists, and closed visits", async () => {
    const w = await world();
    expect((await putExam(w.reyes, w.today, { tmd: { snoring: "" } })).status).toBe(400);
    expect((await putExam(w.lim, w.today, {})).status).toBe(403);
    expect((await putExam(w.reyes, w.earlier, {})).status).toBe(422);
  });
});

describe("treatment notes", () => {
  it("adds a note and an amendment, newest first, with the visit's branch and chair", async () => {
    const w = await world();
    const first = await addNote(w.reyes, w.earlier, { body: "Scaling done." });
    expect(first.status).toBe(201);
    const { id } = await first.json();
    expect((await addNote(w.reyes, w.earlier, { body: "Correction: upper arch only.", amendsId: id })).status).toBe(201);
    const notes = await (await call(notesRoute.GET, request(`/api/v1/patients/${w.ana.id}/notes`, { cookie: w.desk }), { id: w.ana.id })).json();
    expect(notes.map((n: Record<string, unknown>) => [n.body, n.amendsId, n.authorName, n.branchName, n.chairNumber])).toEqual([
      ["Correction: upper arch only.", id, "Dr. Reyes", "Downtown", 1],
      ["Scaling done.", null, "Dr. Reyes", "Downtown", 1],
    ]);
  });

  it("refuses the front desk, other dentists, and visits not seen yet", async () => {
    const w = await world();
    expect((await addNote(w.desk, w.earlier, { body: "x" })).status).toBe(403);
    expect((await addNote(w.lim, w.earlier, { body: "x" })).status).toBe(403);
    expect((await addNote(w.reyes, w.later, { body: "x" })).status).toBe(422);
  });
});

describe("the record", () => {
  it("lists the teeth charted during each visit, leaving out voided entries", async () => {
    const w = await world();
    const res = await (await call(visitsRoute.GET, request(`/api/v1/patients/${w.ana.id}/visits`, { cookie: w.desk }), { id: w.ana.id })).json();
    expect(res.visits.find((v: { id: string }) => v.id === w.today)).toMatchObject({ teeth: [16], dentistName: "Dr. Reyes" });
    expect(res.visits.every((v: { dentistId: string }) => typeof v.dentistId === "string")).toBe(true);
  });

  it("audits every view and change by patient, with ids and never the clinical content", async () => {
    const w = await world();
    const rows = await db.select().from(auditLog).where(eq(auditLog.entityId, w.ana.id));
    expect(new Set(rows.map((r) => r.action))).toEqual(new Set(["patient.view", "chart.added", "chart.voided", "exam.saved", "note.added"]));
    expect(rows.filter((r) => r.action === "patient.view").map((r) => r.details.part)).toEqual(
      expect.arrayContaining(["chart", "exam", "notes", "visits"]),
    );
    expect(JSON.stringify(rows)).not.toMatch(/Scaling|gingivitis|Small|"Co"/);
  });
});
