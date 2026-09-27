import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { addStaff, asService, asUser, freshDb, migrate, MIGRATIONS, newClinic } from "./harness";

type Clinic = { userId: string; clinicId: string };

const BRANCHES = "20260928000100_branches_booking.sql";
const MOBILE = "+639171112222";

let db: PGlite;
let a: Clinic;
let aStaff: string;
let b: Clinic;
let tokens = 0;

/** The SQLSTATE a statement fails with, so each refusal is told apart by its code. */
async function sqlstate(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (e) {
    return (e as { code?: string }).code ?? String(e);
  }
  return "no error";
}

const one = async (sql: string, params: unknown[] = []) => (await db.query<{ id: string }>(sql, params)).rows[0].id;
const mainBranch = (clinicId: string) => one("select id from public.branches where clinic_id = $1 order by sort, created_at limit 1", [clinicId]);
const firstDentist = (clinicId: string) => one("select id from public.dentists where clinic_id = $1 order by created_at limit 1", [clinicId]);
const token = () => `Tok${String(++tokens).padStart(9, "0")}`;

/** create_booking through the secret key with named arguments, as supabase-js sends them; extra overrides the defaults. */
async function book(clinic: Clinic, startsAt: string, extra: Record<string, unknown> = {}): Promise<string> {
  const args: Record<string, unknown> = {
    p_clinic_id: clinic.clinicId,
    p_dentist_id: await firstDentist(clinic.clinicId),
    p_starts_at: startsAt,
    p_ends_at: new Date(new Date(startsAt).getTime() + 30 * 60_000).toISOString(),
    p_procedure_names: ["Consultation"],
    p_source: "online",
    p_status: "pending",
    p_manage_token: token(),
    p_patient_id: null,
    p_first_name: "Ana",
    p_last_name: "Cruz",
    p_mobile: MOBILE,
    p_birthday: null,
    p_hmo: "",
    p_consent: true,
    p_actor: "patient",
    p_user_id: null,
    ...extra,
  };
  const names = Object.keys(args);
  const casts: Record<string, string> = { p_procedure_names: "::text[]", p_form: "::jsonb", p_birthday: "::date" };
  const call = names.map((n, i) => `${n} => $${i + 1}${casts[n] ?? ""}`).join(", ");
  const values = names.map((n) => (n === "p_form" && args[n] !== null ? JSON.stringify(args[n]) : args[n]));
  const [row] = await asService<{ id: string }>(db, `select public.create_booking(${call}) as id`, values);
  return row.id;
}

/** change_booking through the secret key, as the change service calls it. */
async function change(clinic: Clinic, id: string, startsAt: string, patient: { id: string } | { form: Record<string, unknown> }, mobile = MOBILE) {
  const isNew = "form" in patient;
  const [row] = await asService<{ ok: boolean }>(
    db,
    `select public.change_booking($1, $2, $3, $4, $5, $6, $7::text[], $8, $9, $10, $11, $12, $13::jsonb) as ok`,
    [
      clinic.clinicId,
      id,
      mobile,
      await firstDentist(clinic.clinicId),
      startsAt,
      new Date(new Date(startsAt).getTime() + 60 * 60_000).toISOString(),
      ["Consultation", "Cleaning"],
      isNew ? null : patient.id,
      isNew ? "Leo" : null,
      isNew ? "Cruz" : null,
      null,
      null,
      isNew ? JSON.stringify(patient.form) : null,
    ],
  );
  return row.ok;
}

const FORM = {
  middle_name: "Santos",
  sex: "female",
  address: "12 Rizal St, Makati",
  occupation: null,
  email: "ana@example.com",
  guardian_name: null,
  hmo_number: "MX-1234",
  previous_dentist: null,
  last_visit: "2025-06",
  visit_reason: "Toothache",
  emergency_name: "Ben Cruz",
  emergency_mobile: "+639175550000",
  waiver_name: "Ana Santos Cruz",
  waiver_version: "2026-09-26",
  medical: { goodHealth: true, allergies: ["latex"] },
};

beforeAll(async () => {
  db = await freshDb();
  a = await newClinic(db);
  b = await newClinic(db);
  aStaff = await addStaff(db, a);
}, 60_000);

describe("the migration on an existing database", () => {
  it("gives each clinic one branch, Main, from its address and map link, holding all its hours and appointments", async () => {
    const early = await freshDb(MIGRATIONS.indexOf(BRANCHES));
    const old = await newClinic(early);
    const q = async (sql: string, params: unknown[] = []) => (await early.query<Record<string, unknown>>(sql, params)).rows;
    await q("update public.clinics set maps_url = 'https://maps.app.goo.gl/abc' where id = $1", [old.clinicId]);
    await q(
      `insert into public.working_hours (clinic_id, dentist_id, weekday, start_time, end_time)
       select clinic_id, id, 3, '09:00', '12:00' from public.dentists where clinic_id = $1`,
      [old.clinicId],
    );
    await q("insert into public.patients (clinic_id, first_name, last_name, mobile) values ($1, 'Ana', 'Cruz', $2)", [old.clinicId, MOBILE]);
    await q(
      `insert into public.appointments (clinic_id, dentist_id, patient_id, starts_at, ends_at, status, procedure_names, source, manage_token)
       select $1, d.id, p.id, '2030-03-04T09:00:00+08:00', '2030-03-04T09:30:00+08:00', 'confirmed', '{Consultation}', 'online', 'OldVisit0001'
       from public.dentists d join public.patients p on p.clinic_id = d.clinic_id where d.clinic_id = $1`,
      [old.clinicId],
    );
    await migrate(early, BRANCHES);

    const branches = await q("select id, name, sms_name, address, maps_url, active from public.branches where clinic_id = $1", [old.clinicId]);
    expect(branches).toEqual([
      { id: expect.any(String), name: "Main", sms_name: "Main", address: "Makati", maps_url: "https://maps.app.goo.gl/abc", active: true },
    ]);
    const main = branches[0].id;
    expect(await q("select distinct branch_id from public.working_hours where clinic_id = $1", [old.clinicId])).toEqual([{ branch_id: main }]);
    expect(await q("select count(*)::int as n from public.working_hours where clinic_id = $1", [old.clinicId])).toEqual([{ n: 2 }]);
    expect(await q("select branch_id from public.appointments where clinic_id = $1", [old.clinicId])).toEqual([{ branch_id: main }]);
    await early.close();
  });
});

describe("create_clinic", () => {
  it("is the teams migration's version with only the first branch added", async () => {
    // Line endings follow each file's checkout (CRLF on Windows), so compare the text line by line.
    const definition = async (d: PGlite) =>
      (await d.query<{ def: string }>("select pg_get_functiondef('public.create_clinic(jsonb)'::regprocedure) as def")).rows[0].def.replace(/\r\n/g, "\n");
    const before = await freshDb(MIGRATIONS.indexOf(BRANCHES));
    const teams = await definition(before);
    await before.close();
    const expected = teams
      .replace("  v_dentist uuid;\n", () => "  v_dentist uuid;\n  v_branch uuid;\n")
      .replace(
        "  insert into public.working_hours (clinic_id, dentist_id, weekday, start_time, end_time)\n  select v_clinic, v_dentist, (h->>'weekday')",
        () =>
          "  insert into public.branches (clinic_id, name, sms_name, address)\n  values (v_clinic, 'Main', 'Main', coalesce(p->>'address', ''))\n  returning id into v_branch;\n\n" +
          "  insert into public.working_hours (clinic_id, dentist_id, branch_id, weekday, start_time, end_time)\n  select v_clinic, v_dentist, v_branch, (h->>'weekday')",
      );
    expect(expected).not.toBe(teams);
    const after = await freshDb(MIGRATIONS.indexOf(BRANCHES) + 1);
    expect(await definition(after)).toBe(expected);
    await after.close();
  });

  it("creates the first branch, Main, from the clinic's address, and puts the hours on it", async () => {
    const [branch] = await asUser<{ id: string; name: string; address: string }>(db, a.userId, "select id, name, address from public.branches");
    expect(branch).toEqual({ id: expect.any(String), name: "Main", address: "Makati" });
    expect(await asUser(db, a.userId, "select distinct branch_id from public.working_hours")).toEqual([{ branch_id: branch.id }]);
  });
});

describe("branches", () => {
  it("are read by every member of the clinic and nobody else", async () => {
    for (const user of [a.userId, aStaff]) {
      expect(await asUser(db, user, "select clinic_id from public.branches"), user).toEqual([{ clinic_id: a.clinicId }]);
    }
    expect(await asUser(db, b.userId, "select id from public.branches where clinic_id = $1", [a.clinicId])).toEqual([]);
  });

  it("change only when the owner changes them", async () => {
    const main = await mainBranch(a.clinicId);
    await expect(
      asUser(db, aStaff, "insert into public.branches (clinic_id, name, sms_name) values ($1, 'Sneaky', 'Sneaky')", [a.clinicId]),
    ).rejects.toThrow(/row-level security/);
    expect(await asUser(db, aStaff, "update public.branches set name = 'Renamed' returning id")).toEqual([]);
    expect(await asUser(db, aStaff, "delete from public.branches returning id")).toEqual([]);
    expect(await asUser(db, b.userId, "update public.branches set name = 'Renamed' where id = $1 returning id", [main])).toEqual([]);

    const [added] = await asUser<{ id: string }>(
      db,
      a.userId,
      "insert into public.branches (clinic_id, name, sms_name, address, sort) values ($1, 'Pasig', 'Pasig', 'Kapitolyo, Pasig', 1) returning id",
      [a.clinicId],
    );
    expect(await asUser(db, a.userId, "update public.branches set name = 'Makati', sort = 0 where id = $1 returning name", [main])).toEqual([{ name: "Makati" }]);
    expect(await asUser(db, a.userId, "delete from public.branches where id = $1 returning id", [added.id])).toEqual([added]);
  });

  it("never move to another clinic", async () => {
    await expect(asUser(db, a.userId, "update public.branches set clinic_id = $1", [b.clinicId])).rejects.toThrow(/permission denied/);
  });

  it("keep a short name for texts that fits beside the clinic's (at most 18 characters)", async () => {
    await expect(db.query("update public.branches set sms_name = $2 where clinic_id = $1", [a.clinicId, "x".repeat(19)])).rejects.toThrow(/branches_sms_name_check/);
  });
});

describe("the last active branch", () => {
  let c: Clinic;
  let main: string;

  beforeAll(async () => {
    c = await newClinic(db);
    main = await mainBranch(c.clinicId);
  });

  it("cannot be deactivated or deleted, by the owner or the secret key", async () => {
    expect(await sqlstate(asUser(db, c.userId, "update public.branches set active = false where id = $1", [main]))).toBe("BSLAB");
    expect(await sqlstate(asUser(db, c.userId, "delete from public.branches where id = $1", [main]))).toBe("BSLAB");
    expect(await sqlstate(asService(db, "update public.branches set active = false where id = $1", [main]))).toBe("BSLAB");
  });

  it("can be deactivated once another branch is active", async () => {
    const [other] = await asUser<{ id: string }>(db, c.userId, "insert into public.branches (clinic_id, name, sms_name) values ($1, 'Pasig', 'Pasig') returning id", [
      c.clinicId,
    ]);
    expect(await asUser(db, c.userId, "update public.branches set active = false where id = $1 returning active", [main])).toEqual([{ active: false }]);
    expect(await sqlstate(asUser(db, c.userId, "update public.branches set active = false where id = $1", [other.id]))).toBe("BSLAB");
  });

  it("goes with its clinic when the operator deletes the clinic", async () => {
    await db.query("delete from public.clinics where id = $1", [c.clinicId]);
    expect((await db.query("select id from public.branches where clinic_id = $1", [c.clinicId])).rows).toEqual([]);
  });
});

describe("hours and appointments", () => {
  it("refuse a branch of another clinic", async () => {
    const other = await mainBranch(b.clinicId);
    const dentist = await firstDentist(a.clinicId);
    await expect(
      db.query("insert into public.working_hours (clinic_id, dentist_id, branch_id, weekday, start_time, end_time) values ($1, $2, $3, 2, '09:00', '12:00')", [
        a.clinicId,
        dentist,
        other,
      ]),
    ).rejects.toThrow(/foreign key/);
    await expect(book(a, "2030-03-05T09:00:00+08:00", { p_branch_id: other })).rejects.toThrow(/branch not found/);
  });

  it("never book one dentist at two branches at once", async () => {
    const [pasig] = await asUser<{ id: string }>(db, a.userId, "insert into public.branches (clinic_id, name, sms_name, sort) values ($1, 'Pasig', 'Pasig', 5) returning id", [
      a.clinicId,
    ]);
    await book(a, "2030-03-06T09:00:00+08:00");
    expect(await sqlstate(book(a, "2030-03-06T09:15:00+08:00", { p_branch_id: pasig.id, p_first_name: "Leo" }))).toBe("23P01");
  });
});

describe("create_booking", () => {
  it("books at the clinic's first active branch when the caller names none, as today's pages do", async () => {
    const id = await book(a, "2030-03-11T09:00:00+08:00");
    // The staff New appointment's call, unchanged: 17 arguments through RLS, matching the patient booked above.
    const [staff] = await asUser<{ id: string }>(
      db,
      aStaff,
      "select public.create_booking($1, $2, $3, $4, '{Consultation}', 'manual', 'confirmed', $5, null, 'ana', 'CRUZ', $6, null, '', false, 'staff', $7) as id",
      [a.clinicId, await firstDentist(a.clinicId), "2030-03-11T11:00:00+08:00", "2030-03-11T11:30:00+08:00", token(), MOBILE, aStaff],
    );
    const { rows } = await db.query("select branch_id, patient_id from public.appointments where id in ($1, $2) order by starts_at", [id, staff.id]);
    const main = await mainBranch(a.clinicId);
    expect(rows).toEqual([
      { branch_id: main, patient_id: expect.any(String) },
      { branch_id: main, patient_id: (rows[0] as { patient_id: string }).patient_id },
    ]);
  });

  it("stores the branch it is given, and refuses one that is inactive", async () => {
    const [second] = await asUser<{ id: string }>(db, a.userId, "insert into public.branches (clinic_id, name, sms_name, sort) values ($1, 'Taguig', 'Taguig', 9) returning id", [
      a.clinicId,
    ]);
    const id = await book(a, "2030-03-12T09:00:00+08:00", { p_branch_id: second.id });
    expect((await db.query("select branch_id from public.appointments where id = $1", [id])).rows).toEqual([{ branch_id: second.id }]);
    await asUser(db, a.userId, "update public.branches set active = false where id = $1", [second.id]);
    expect(await sqlstate(book(a, "2030-03-13T09:00:00+08:00", { p_branch_id: second.id }))).toBe("BSBRA");
  });

  it("stores a new patient's form with the time of the waiver", async () => {
    const id = await book(b, "2030-03-11T10:00:00+08:00", { p_first_name: "Mia", p_form: FORM });
    const { rows } = await db.query<Record<string, unknown>>(
      `select p.sex, p.email, p.hmo_number, p.last_visit, p.emergency_mobile, p.waiver_name, p.waiver_version, p.medical,
              p.waiver_at is not null as signed, p.consent_at is not null as consented
       from public.appointments a join public.patients p on p.id = a.patient_id where a.id = $1`,
      [id],
    );
    expect(rows).toEqual([
      {
        sex: "female",
        email: "ana@example.com",
        hmo_number: "MX-1234",
        last_visit: "2025-06",
        emergency_mobile: "+639175550000",
        waiver_name: "Ana Santos Cruz",
        waiver_version: "2026-09-26",
        medical: { goodHealth: true, allergies: ["latex"] },
        signed: true,
        consented: true,
      },
    ]);
  });

  it("keeps the form of a patient it matches and fills only what is missing", async () => {
    await book(b, "2030-03-12T10:00:00+08:00", { p_first_name: "Joy" });
    const id = await book(b, "2030-03-13T10:00:00+08:00", { p_first_name: "JOY", p_form: FORM });
    await book(b, "2030-03-14T10:00:00+08:00", { p_first_name: "joy", p_form: { ...FORM, email: "other@example.com", waiver_name: "Someone Else" } });
    const { rows } = await db.query<Record<string, unknown>>(
      "select p.first_name, p.email, p.waiver_name, (select count(*)::int from public.appointments x where x.patient_id = p.id) as visits from public.appointments a join public.patients p on p.id = a.patient_id where a.id = $1",
      [id],
    );
    expect(rows).toEqual([{ first_name: "Joy", email: "ana@example.com", waiver_name: "Ana Santos Cruz", visits: 3 }]);
  });
});

describe("change_booking", () => {
  let c: Clinic;
  let visit: string;

  const row = async (id: string) =>
    (
      await db.query<Record<string, unknown>>(
        "select status, starts_at, confirmed_at, reminder_sent_at, procedure_names, patient_id from public.appointments where id = $1",
        [id],
      )
    ).rows[0];

  beforeAll(async () => {
    c = await newClinic(db);
    visit = await book(c, "2030-04-01T09:00:00+08:00", { p_status: "confirmed", p_source: "manual", p_actor: "staff" });
    await db.query("update public.appointments set reminder_sent_at = now() where id = $1", [visit]);
  });

  it("moves a future visit and sends it back to the clinic for approval", async () => {
    const before = await row(visit);
    expect(await change(c, visit, "2030-04-02T10:00:00+08:00", { id: before.patient_id as string })).toBe(true);
    expect(await row(visit)).toEqual({
      status: "pending",
      starts_at: new Date("2030-04-02T02:00:00Z"),
      confirmed_at: null,
      reminder_sent_at: null,
      procedure_names: ["Consultation", "Cleaning"],
      patient_id: before.patient_id,
    });
    const { rows } = await db.query("select from_status, to_status, actor, reason from public.appointment_events where appointment_id = $1 order by id desc limit 1", [visit]);
    expect(rows).toEqual([{ from_status: "confirmed", to_status: "pending", actor: "patient", reason: "Changed by patient" }]);
  });

  it("moves it to someone new on the same number, with their form", async () => {
    expect(await change(c, visit, "2030-04-03T10:00:00+08:00", { form: FORM })).toBe(true);
    const { rows } = await db.query<Record<string, unknown>>(
      "select p.first_name, p.mobile, p.waiver_name from public.appointments a join public.patients p on p.id = a.patient_id where a.id = $1",
      [visit],
    );
    expect(rows).toEqual([{ first_name: "Leo", mobile: MOBILE, waiver_name: "Ana Santos Cruz" }]);
  });

  it("refuses another number, a patient of another number, and a clash with another visit", async () => {
    const patient = (await row(visit)).patient_id as string;
    expect(await change(c, visit, "2030-04-04T10:00:00+08:00", { id: patient }, "+639179999999")).toBe(false);
    const stranger = await one("insert into public.patients (clinic_id, first_name, last_name, mobile) values ($1, 'Zed', 'Uy', '+639178888888') returning id", [c.clinicId]);
    expect(await sqlstate(change(c, visit, "2030-04-04T10:00:00+08:00", { id: stranger }))).toBe("P0002");
    await book(c, "2030-04-05T10:30:00+08:00", { p_first_name: "Other", p_mobile: "+639177777777" });
    expect(await sqlstate(change(c, visit, "2030-04-05T10:00:00+08:00", { id: patient }))).toBe("23P01");
  });

  it("refuses a visit that is not pending or confirmed, has started, or starts within the minimum notice", async () => {
    const patient = (await row(visit)).patient_id as string;
    const soon = await book(c, new Date(Date.now() + 60 * 60_000).toISOString(), { p_first_name: "Soon" });
    expect(await change(c, soon, "2030-04-06T10:00:00+08:00", { id: patient })).toBe(false);
    const past = await book(c, "2030-04-07T10:00:00+08:00", { p_first_name: "Past" });
    await db.query("update public.appointments set starts_at = now() - interval '1 day', ends_at = now() - interval '23 hours' where id = $1", [past]);
    expect(await change(c, past, "2030-04-08T10:00:00+08:00", { id: patient })).toBe(false);
    await db.query("update public.appointments set status = 'cancelled' where id = $1", [visit]);
    expect(await change(c, visit, "2030-04-09T10:00:00+08:00", { id: patient })).toBe(false);
  });

  it("is only for the server's secret key", async () => {
    await expect(
      asUser(db, c.userId, "select public.change_booking($1, $2, $3, null, null, null, null, null, null, null, null, null, null)", [c.clinicId, visit, MOBILE]),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("the patient form", () => {
  let patient: string;

  beforeAll(async () => {
    patient = await one("insert into public.patients (clinic_id, first_name, last_name, mobile) values ($1, 'Form', 'Test', $2) returning id", [b.clinicId, MOBILE]);
  });

  it("refuses values outside its rules", async () => {
    for (const [column, value] of [
      ["sex", "other"],
      ["email", "not-an-email"],
      ["emergency_mobile", "09171112222"],
      ["last_visit", "2025-13"],
      ["medical", "[]"],
    ]) {
      await expect(db.query(`update public.patients set ${column} = $2 where id = $1`, [patient, value]), column).rejects.toThrow(/check constraint/);
    }
    await expect(db.query("update public.patients set waiver_name = 'Form Test' where id = $1", [patient])).rejects.toThrow(/patients_waiver_complete/);
  });

  it("is cleared when the patient is anonymized, or the patient is not anonymized", async () => {
    await db.query("update public.patients set sex = 'male', medical = '{\"tobacco\": true}' where id = $1", [patient]);
    const anonymize = "update public.patients set first_name = 'Deleted', last_name = 'patient', mobile = null, anonymized_at = now()";
    await expect(db.query(`${anonymize} where id = $1`, [patient])).rejects.toThrow(/patients_anonymized_clean/);
    await db.query(`${anonymize}, sex = null, medical = null where id = $1`, [patient]);
  });
});
