import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { addUser, asService, asUser, freshDb, migrate, MIGRATIONS, newClinic } from "./harness";

type Clinic = { userId: string; clinicId: string };
type Payment = { status: "ok" | "duplicate"; paid_through: string | null };

const BILLING = "20260925000200_billing.sql";

let db: PGlite;
let a: Clinic;
let b: Clinic;
let operator: string;

/** record_payment through the secret key, as the admin page and the webhook call it. */
async function pay(clinicId: string, months: number, sessionId: string | null = null): Promise<Payment> {
  const [row] = await asService<{ r: Payment }>(db, "select public.record_payment($1, $2, $3, $4, $5, $6, $7) as r", [
    clinicId,
    sessionId ? "paymongo" : "gcash",
    39900 * months,
    months,
    sessionId ?? "GCASH-REF-1",
    sessionId,
    sessionId ? null : operator,
  ]);
  return row.r;
}

/** Sets a clinic's dates directly, as the table owner. */
async function setDates(clinicId: string, trialEndsAt: string, paidThrough: string | null) {
  await db.query("update public.clinic_billing set trial_ends_at = $2, paid_through = $3 where clinic_id = $1", [clinicId, trialEndsAt, paidThrough]);
}

beforeAll(async () => {
  db = await freshDb();
  a = await newClinic(db);
  b = await newClinic(db);
  operator = await addUser(db);
}, 60_000);

describe("create_clinic", () => {
  it("starts a 14 day trial with nothing paid", async () => {
    const [row] = await asUser<{ trial: boolean; paid_through: string | null; renewal_notice_for: string | null }>(
      db,
      a.userId,
      `select b.trial_ends_at = c.created_at + interval '14 days' as trial, b.paid_through, b.renewal_notice_for
       from public.clinic_billing b join public.clinics c on c.id = b.clinic_id`,
    );
    expect(row).toEqual({ trial: true, paid_through: null, renewal_notice_for: null });
  });
});

describe("the backfill", () => {
  it("gives clinics from before billing a fresh 14 days from the migration", async () => {
    const early = await freshDb(MIGRATIONS.indexOf(BILLING));
    const [clinic] = (
      await early.query<{ id: string }>(
        "insert into public.clinics (name, sms_name, slug, mobile, created_at) values ('Old', 'Old', 'old-clinic', '+639170000003', '2026-09-01T00:00:00Z') returning id",
      )
    ).rows;
    await migrate(early, BILLING);
    const { rows } = await early.query<{ fresh: boolean }>(
      "select abs(extract(epoch from trial_ends_at - (now() + interval '14 days'))) < 60 as fresh from public.clinic_billing where clinic_id = $1",
      [clinic.id],
    );
    expect(rows).toEqual([{ fresh: true }]);
    await early.close();
  });
});

describe("billing access", () => {
  beforeAll(async () => {
    await pay(a.clinicId, 1);
    await pay(b.clinicId, 3);
  });

  it("lets members read their own billing and payments, and nobody else's", async () => {
    expect(await asUser(db, a.userId, "select clinic_id from public.clinic_billing")).toEqual([{ clinic_id: a.clinicId }]);
    expect(await asUser(db, a.userId, "select clinic_id, months from public.payments")).toEqual([{ clinic_id: a.clinicId, months: 1 }]);
    expect(await asUser(db, b.userId, "select clinic_id, months from public.payments")).toEqual([{ clinic_id: b.clinicId, months: 3 }]);
  });

  it("never lets members write either table, not even their own rows", async () => {
    const writes = [
      "insert into public.clinic_billing (clinic_id, trial_ends_at) values ($1, now())",
      "update public.clinic_billing set paid_through = '2099-01-01' where clinic_id = $1",
      "delete from public.clinic_billing where clinic_id = $1",
      "insert into public.payments (clinic_id, method, amount_centavos, months, reference, paid_through_after) values ($1, 'gcash', 100, 1, 'x', now())",
      "update public.payments set months = 12 where clinic_id = $1",
      "delete from public.payments where clinic_id = $1",
    ];
    for (const sql of writes) {
      await expect(asUser(db, a.userId, sql, [a.clinicId]), sql).rejects.toThrow(/permission denied/);
    }
  });

  it("lets only the secret key record payments, extend trials, or list every clinic", async () => {
    for (const user of [a.userId, null]) {
      await expect(
        asUser(db, user, "select public.record_payment($1, 'gcash', 100, 12, 'x', null, null)", [a.clinicId]),
      ).rejects.toThrow(/permission denied for function record_payment/);
      await expect(asUser(db, user, "select public.extend_trial($1, 365)", [a.clinicId])).rejects.toThrow(
        /permission denied for function extend_trial/,
      );
      await expect(asUser(db, user, "select * from public.admin_overview(now())")).rejects.toThrow(
        /permission denied for function admin_overview/,
      );
    }
  });
});

describe("record_payment", () => {
  it("extends from paid_through when the plan is paid ahead", async () => {
    const c = await newClinic(db);
    await setDates(c.clinicId, "2030-01-01T00:00:00Z", "2030-01-15T00:00:00Z");
    await db.query("update public.clinic_billing set renewal_notice_for = paid_through where clinic_id = $1", [c.clinicId]);
    expect(await pay(c.clinicId, 3)).toEqual({ status: "ok", paid_through: "2030-04-15T00:00:00+00:00" });
    const [row] = await db.query<{ renewal_notice_for: Date | null; paid_through_after: Date; reference: string; recorded_by: string }>(
      `select b.renewal_notice_for, p.paid_through_after, p.reference, p.recorded_by
       from public.clinic_billing b join public.payments p on p.clinic_id = b.clinic_id where b.clinic_id = $1`,
      [c.clinicId],
    ).then((r) => r.rows);
    expect(row).toEqual({
      renewal_notice_for: null,
      paid_through_after: new Date("2030-04-15T00:00:00Z"),
      reference: "GCASH-REF-1",
      recorded_by: operator,
    });
  });

  it("keeps the trial days when paid during the trial", async () => {
    const c = await newClinic(db);
    await pay(c.clinicId, 1);
    const [row] = await db.query<{ exact: boolean }>(
      "select paid_through = ((trial_ends_at at time zone 'Asia/Manila') + interval '1 month') at time zone 'Asia/Manila' as exact from public.clinic_billing where clinic_id = $1",
      [c.clinicId],
    ).then((r) => r.rows);
    expect(row.exact).toBe(true);
  });

  it("starts from now after a lapse", async () => {
    const c = await newClinic(db);
    await setDates(c.clinicId, "2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z");
    // One statement, so the function's now() and this now() are the same instant.
    const [row] = await asService<{ exact: boolean }>(
      db,
      "select (public.record_payment($1, 'gcash', 39900, 1, 'GCASH-REF-2', null, null) ->> 'paid_through')::timestamptz = ((now() at time zone 'Asia/Manila') + interval '1 month') at time zone 'Asia/Manila' as exact",
      [c.clinicId],
    );
    expect(row.exact).toBe(true);
  });

  it("adds months on the Manila calendar, clamping at month ends", async () => {
    const c = await newClinic(db);
    // Jan 31, 4:00 AM Manila plus one month is Feb 28, 4:00 AM Manila (the UTC calendar would give Feb 28, 8:00 PM UTC).
    await setDates(c.clinicId, "2029-01-01T00:00:00Z", "2030-01-30T20:00:00Z");
    expect(await pay(c.clinicId, 1)).toEqual({ status: "ok", paid_through: "2030-02-27T20:00:00+00:00" });
  });

  it("creates a missing billing row as a trial that ended at signup", async () => {
    const c = await newClinic(db);
    await db.query("delete from public.clinic_billing where clinic_id = $1", [c.clinicId]);
    expect((await pay(c.clinicId, 1)).status).toBe("ok");
    const [row] = await db
      .query<{ signup: boolean }>(
        "select b.trial_ends_at = c.created_at as signup from public.clinic_billing b join public.clinics c on c.id = b.clinic_id where b.clinic_id = $1",
        [c.clinicId],
      )
      .then((r) => r.rows);
    expect(row.signup).toBe(true);
  });

  it("refuses an unknown clinic", async () => {
    await expect(pay("00000000-0000-0000-0000-000000000000", 1)).rejects.toThrow(/clinic not found/);
  });

  it("requires a session id for PayMongo and none for GCash", async () => {
    const c = await newClinic(db);
    const call = (method: string, session: string | null) =>
      asService(db, "select public.record_payment($1, $2, 39900, 1, 'ref', $3, null)", [c.clinicId, method, session]);
    await expect(call("paymongo", null)).rejects.toThrow(/payments_check/);
    await expect(call("gcash", "cs_test_x")).rejects.toThrow(/payments_check/);
  });

  it("records a PayMongo session once, however often the webhook comes", async () => {
    const c = await newClinic(db);
    const first = await pay(c.clinicId, 6, "cs_test_once");
    expect(first.status).toBe("ok");
    expect(await pay(c.clinicId, 6, "cs_test_once")).toEqual({ status: "duplicate", paid_through: first.paid_through });
    const { rows } = await db.query("select id from public.payments where provider_session_id = 'cs_test_once'");
    expect(rows).toHaveLength(1);
  });

  it("changes nothing when the payment itself is invalid", async () => {
    const c = await newClinic(db);
    await expect(pay(c.clinicId, 13)).rejects.toThrow(/payments_months_check/);
    const { rows } = await db.query<{ paid_through: Date | null }>("select paid_through from public.clinic_billing where clinic_id = $1", [c.clinicId]);
    expect(rows).toEqual([{ paid_through: null }]);
  });
});

describe("extend_trial", () => {
  it("adds days to a running trial, and counts from now once it ended", async () => {
    const c = await newClinic(db);
    await setDates(c.clinicId, "2030-01-01T00:00:00Z", null);
    const [running] = await asService<{ t: Date }>(db, "select public.extend_trial($1, 10) as t", [c.clinicId]);
    expect(running.t).toEqual(new Date("2030-01-11T00:00:00Z"));
    await setDates(c.clinicId, "2026-01-01T00:00:00Z", null);
    const [ended] = await asService<{ exact: boolean }>(db, "select public.extend_trial($1, 7) = now() + interval '7 days' as exact", [c.clinicId]);
    expect(ended.exact).toBe(true);
  });

  it("creates a missing billing row, and refuses unknown clinics and odd day counts", async () => {
    const c = await newClinic(db);
    await db.query("delete from public.clinic_billing where clinic_id = $1", [c.clinicId]);
    const [created] = await asService<{ exact: boolean }>(db, "select public.extend_trial($1, 5) = now() + interval '5 days' as exact", [c.clinicId]);
    expect(created.exact).toBe(true);
    await expect(asService(db, "select public.extend_trial('00000000-0000-0000-0000-000000000000', 5)")).rejects.toThrow(/clinic not found/);
    for (const days of [0, 366]) {
      await expect(asService(db, "select public.extend_trial($1, $2)", [c.clinicId, days])).rejects.toThrow(/between 1 and 365/);
    }
  });
});

describe("admin_overview", () => {
  it("lists each clinic with its dates, active dentists, credits sent this month, and last payment", async () => {
    const c = await newClinic(db);
    const quiet = await newClinic(db);
    await db.query(
      "insert into public.dentists (clinic_id, name, sms_name, active) values ($1, 'Dr. Two', 'Dr. Two', true), ($1, 'Dr. Gone', 'Dr. Gone', false)",
      [c.clinicId],
    );
    const text = (createdAt: string, status: string, credits: number) =>
      db.query(
        "insert into public.sms_log (clinic_id, to_mobile, kind, body, credits, status, created_at) values ($1, '+639171112222', 'confirmed', 'x', $2, $3, $4)",
        [c.clinicId, credits, status, createdAt],
      );
    await text("2026-09-10T02:00:00Z", "sent", 1);
    await text("2026-09-11T02:00:00Z", "sent", 2);
    await text("2026-08-31T15:59:59Z", "sent", 1); // Aug 31, 11:59 PM Manila: last month
    await text("2026-09-12T02:00:00Z", "logged", 1);
    await text("2026-09-13T02:00:00Z", "failed", 0);
    await pay(c.clinicId, 1);
    await pay(c.clinicId, 3);
    // PGlite can give consecutive statements the same now(); make the 1 month payment clearly older.
    await db.query("update public.payments set paid_at = paid_at - interval '1 minute' where clinic_id = $1 and months = 1", [c.clinicId]);

    const rows = await asService<{ id: string; [key: string]: unknown }>(db, "select * from public.admin_overview($1)", [
      "2026-08-31T16:00:00Z", // Sep 1, 00:00 Manila
    ]);
    expect(rows.find((r) => r.id === c.clinicId)).toMatchObject({
      name: "Sample Clinic",
      active_dentists: 2,
      credits: 3,
      last_months: 3,
      last_amount_centavos: 119_700,
      last_method: "gcash",
    });
    expect(rows.find((r) => r.id === quiet.clinicId)).toMatchObject({ active_dentists: 1, credits: 0, last_paid_at: null, last_months: null });
  });
});
