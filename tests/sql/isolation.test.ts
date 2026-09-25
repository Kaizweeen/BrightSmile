import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, freshDb, newClinic } from "./harness";

type Clinic = { userId: string; clinicId: string };

// Every table with a clinic_id that seed() fills. Tables added later are still checked for leaks below.
const SEEDED = [
  "appointment_events",
  "appointments",
  "clinic_members",
  "dentists",
  "patients",
  "procedures",
  "push_subscriptions",
  "sms_log",
  "time_off",
  "working_hours",
];

let db: PGlite;
let a: Clinic;
let b: Clinic;

/** One row in every clinic-owned table create_clinic does not fill, written as the table owner (no RLS). */
async function seed({ userId, clinicId }: Clinic) {
  const one = async (sql: string, params: unknown[]) => (await db.query<{ id: string }>(sql, params)).rows[0]?.id;
  const dentist = await one("select id from public.dentists where clinic_id = $1", [clinicId]);
  const patient = await one("insert into public.patients (clinic_id, first_name, last_name, mobile) values ($1, 'Ana', 'Cruz', '+639171112222') returning id", [clinicId]);
  const appointment = await one(
    `insert into public.appointments (clinic_id, dentist_id, patient_id, starts_at, ends_at, status, procedure_names, source, manage_token)
     values ($1, $2, $3, '2030-01-07T09:00:00+08:00', '2030-01-07T09:30:00+08:00', 'confirmed', '{Consultation}', 'online', $4) returning id`,
    [clinicId, dentist, patient, `T${clinicId.replace(/-/g, "").slice(0, 11)}`],
  );
  await db.query("insert into public.appointment_events (clinic_id, appointment_id, to_status, actor) values ($1, $2, 'confirmed', 'staff')", [clinicId, appointment]);
  await db.query("insert into public.time_off (clinic_id, dentist_id, starts_at, ends_at) values ($1, $2, '2030-01-08T09:00:00+08:00', '2030-01-08T12:00:00+08:00')", [clinicId, dentist]);
  await db.query("insert into public.sms_log (clinic_id, to_mobile, kind, body, credits, status) values ($1, '+639171112222', 'confirmed', 'x', 1, 'logged')", [clinicId]);
  await db.query("insert into public.push_subscriptions (clinic_id, user_id, endpoint, p256dh, auth) values ($1, $2, $3, 'k', 'a')", [clinicId, userId, `https://fcm.googleapis.com/fcm/send/${clinicId}`]);
}

beforeAll(async () => {
  db = await freshDb();
  a = await newClinic(db);
  b = await newClinic(db);
  await seed(a);
  await seed(b);
  // A text to the operator belongs to no clinic: no member may see it.
  await db.query("insert into public.sms_log (clinic_id, to_mobile, kind, body, credits, status) values (null, '+639170000009', 'low_credit', 'x', 1, 'logged')");
}, 60_000);

describe("clinic isolation", () => {
  it("shows members only their own clinic, and only its rows in every table with a clinic_id", async () => {
    expect(await asUser(db, a.userId, "select id from public.clinics")).toEqual([{ id: a.clinicId }]);
    const tables = (
      await db.query<{ table_name: string }>(
        "select table_name from information_schema.columns where table_schema = 'public' and column_name = 'clinic_id' order by table_name",
      )
    ).rows.map((r) => r.table_name);
    expect(tables).toEqual(expect.arrayContaining(SEEDED));
    for (const table of tables) {
      const rows = await asUser<{ clinic_id: string | null }>(db, a.userId, `select clinic_id from public.${table}`);
      expect(rows.every((r) => r.clinic_id === a.clinicId), table).toBe(true);
      if (SEEDED.includes(table)) expect(rows.length, table).toBeGreaterThan(0);
    }
  });

  it("changes nothing in another clinic", async () => {
    expect(await asUser(db, a.userId, "update public.clinics set name = 'Hacked' where id = $1 returning id", [b.clinicId])).toEqual([]);
    expect(await asUser(db, a.userId, "delete from public.patients where clinic_id = $1 returning id", [b.clinicId])).toEqual([]);
    await expect(
      asUser(db, a.userId, "insert into public.patients (clinic_id, first_name, last_name) values ($1, 'Sneaky', 'Insert')", [b.clinicId]),
    ).rejects.toThrow(/row-level security/);
  });

  it("keeps verification codes away from signed-in users", async () => {
    await expect(asUser(db, a.userId, "select id from public.otp_requests")).rejects.toThrow(/permission denied/);
  });
});

describe("visitors without a session", () => {
  it("can read no table", async () => {
    const tables = (
      await db.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'")
    ).rows.map((r) => r.table_name);
    expect(tables.length).toBeGreaterThan(10);
    for (const table of tables) {
      await expect(asUser(db, null, `select 1 from public.${table} limit 1`), table).rejects.toThrow(/permission denied/);
    }
  });

  it("can run no function", async () => {
    const runnable = await db.query<{ proname: string }>(
      "select proname from pg_proc where pronamespace = 'public'::regnamespace and has_function_privilege('anon', oid, 'execute')",
    );
    expect(runnable.rows).toEqual([]);
  });
});

describe("double booking guard", () => {
  const insert = (clinic: Clinic, start: string, end: string, status: string) =>
    db.query(
      `insert into public.appointments (clinic_id, dentist_id, patient_id, starts_at, ends_at, status, procedure_names, source, manage_token)
       select $1, d.id, p.id, $2, $3, $4, '{Consultation}', 'manual', substr(md5(random()::text), 1, 12)
       from public.dentists d join public.patients p on p.clinic_id = d.clinic_id where d.clinic_id = $1 limit 1`,
      [clinic.clinicId, start, end, status],
    );

  it("rejects overlapping pending or confirmed visits for one dentist", async () => {
    await insert(a, "2030-02-04T09:00:00+08:00", "2030-02-04T10:00:00+08:00", "confirmed");
    await expect(insert(a, "2030-02-04T09:30:00+08:00", "2030-02-04T10:30:00+08:00", "pending")).rejects.toThrow(/no_overlap/);
  });

  it("allows back-to-back visits and ignores cancelled ones", async () => {
    await insert(a, "2030-02-04T10:00:00+08:00", "2030-02-04T10:30:00+08:00", "confirmed");
    await insert(a, "2030-02-04T11:00:00+08:00", "2030-02-04T12:00:00+08:00", "cancelled");
    await insert(a, "2030-02-04T11:00:00+08:00", "2030-02-04T12:00:00+08:00", "pending");
  });
});
