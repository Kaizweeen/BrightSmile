import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { addStaff, addUser, asService, asUser, freshDb, invite, migrate, MIGRATIONS, newClinic } from "./harness";
import { hashInviteToken } from "@/lib/team";

type Clinic = { userId: string; clinicId: string };

const TEAMS = "20260926000100_teams.sql";

let db: PGlite;
let a: Clinic;
let aStaff: string;
let b: Clinic;

/** The SQLSTATE a statement fails with, so each refusal is told apart by its code (teams spec 5). */
async function sqlstate(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (e) {
    return (e as { code?: string }).code ?? String(e);
  }
  return "no error";
}

const accept = (userId: string, token: string) => asUser<{ clinic: string }>(db, userId, "select public.accept_invite($1) as clinic", [token]);
const remove = (callerId: string | null, memberId: string) => asUser(db, callerId, "select public.remove_member($1)", [memberId]);

beforeAll(async () => {
  db = await freshDb();
  a = await newClinic(db);
  b = await newClinic(db);
  aStaff = await addStaff(db, a);
}, 60_000);

describe("create_clinic", () => {
  it("records the owner's role and login email", async () => {
    expect(await asUser(db, a.userId, "select role, email from public.clinic_members where user_id = $1", [a.userId])).toEqual([
      { role: "owner", email: `${a.userId}@example.com` },
    ]);
  });

  it("is the version before it with only the membership insert changed", async () => {
    const before = await freshDb(MIGRATIONS.indexOf(TEAMS));
    // Line endings follow each file's checkout (CRLF on Windows), so compare the text line by line.
    const definition = async (d: PGlite) =>
      (await d.query<{ def: string }>("select pg_get_functiondef('public.create_clinic(jsonb)'::regprocedure) as def")).rows[0].def.replace(/\r\n/g, "\n");
    const original = await definition(before);
    await before.close();
    const expected = original.replace(
      "insert into public.clinic_members (clinic_id, user_id) values (v_clinic, v_user);",
      () => "insert into public.clinic_members (clinic_id, user_id, email)\n  values (v_clinic, v_user, (select u.email from auth.users u where u.id = v_user));",
    );
    expect(expected).not.toBe(original);
    // Right after the teams migration: later migrations replace create_clinic again.
    const after = await freshDb(MIGRATIONS.indexOf(TEAMS) + 1);
    expect(await definition(after)).toBe(expected);
    await after.close();
  });
});

describe("the migration on an existing database", () => {
  it("keeps every member an owner and copies their emails", async () => {
    const early = await freshDb(MIGRATIONS.indexOf(TEAMS));
    const old = await newClinic(early);
    await migrate(early, TEAMS);
    const { rows } = await early.query("select role, email from public.clinic_members where user_id = $1", [old.userId]);
    expect(rows).toEqual([{ role: "owner", email: `${old.userId}@example.com` }]);
    await early.close();
  });

  it("allows only the owner and staff roles, and keeps the join link free", async () => {
    await expect(db.query("update public.clinic_members set role = 'admin' where user_id = $1", [aStaff])).rejects.toThrow(/clinic_members_role_check/);
    await expect(db.query("update public.clinics set slug = 'join' where id = $1", [a.clinicId])).rejects.toThrow(/clinics_slug_not_reserved/);
  });

  it("refuses to run before the OTP locking migration, so pasting it out of order fails fast", async () => {
    const early = await freshDb(MIGRATIONS.indexOf("20260925000100_otp_issue_lock.sql"));
    await expect(migrate(early, TEAMS)).rejects.toThrow(/issue_otp/);
    await early.close();
  });
});

describe("memberships", () => {
  it("let the owner see every membership of their clinic; a staff member sees only their own row", async () => {
    const clinicA = [
      { user_id: a.userId, role: "owner" },
      { user_id: aStaff, role: "staff" },
    ];
    // Two rows for clinic A when the owner reads them: why ownMembership filters by the signed-in user's id, even
    // for the owner (maybeSingle fails on more than one row).
    expect(await asUser(db, a.userId, "select user_id, role from public.clinic_members order by role")).toEqual(clinicA);
    expect(await asUser(db, b.userId, "select user_id from public.clinic_members")).toEqual([{ user_id: b.userId }]);
  });

  it("keeps a colleague's email from staff (RA 10173 data minimization): a staff member reads only their own row", async () => {
    expect(await asUser(db, aStaff, "select user_id, role, email from public.clinic_members")).toEqual([
      { user_id: aStaff, role: "staff", email: `${aStaff}@example.com` },
    ]);
    expect(await asUser(db, aStaff, "select user_id from public.clinic_members where user_id = $1", [a.userId])).toEqual([]);
  });

  it("cannot be added, changed, or deleted directly, not even by the owner", async () => {
    for (const user of [a.userId, aStaff]) {
      await expect(asUser(db, user, "insert into public.clinic_members (clinic_id, user_id) values ($1, $2)", [a.clinicId, b.userId])).rejects.toThrow(
        /permission denied/,
      );
      await expect(asUser(db, user, "update public.clinic_members set role = 'owner' where user_id = $1", [aStaff])).rejects.toThrow(/permission denied/);
      await expect(asUser(db, user, "delete from public.clinic_members where user_id = $1", [aStaff])).rejects.toThrow(/permission denied/);
    }
  });
});

describe("the clinic's setup", () => {
  it("is readable by staff", async () => {
    for (const table of ["clinics", "dentists", "working_hours", "procedures"]) {
      expect((await asUser(db, aStaff, `select 1 from public.${table}`)).length, table).toBeGreaterThan(0);
    }
  });

  it("does not change when staff update or delete it", async () => {
    for (const sql of [
      "update public.clinics set name = 'Renamed by staff' returning id",
      "update public.dentists set name = 'Dr. Renamed' returning id",
      "delete from public.dentists returning id",
      "update public.working_hours set end_time = '23:00' returning id",
      "delete from public.working_hours returning id",
      "update public.procedures set duration_minutes = 5 returning id",
      "delete from public.procedures returning id",
    ]) {
      expect(await asUser(db, aStaff, sql), sql).toEqual([]);
    }
  });

  it("refuses dentists, hours, and procedures that staff add", async () => {
    const [dentist] = await asUser<{ id: string }>(db, aStaff, "select id from public.dentists limit 1");
    const inserts: [string, unknown[]][] = [
      ["insert into public.dentists (clinic_id, name, sms_name) values ($1, 'Dr. Sneak', 'Dr. Sneak')", [a.clinicId]],
      ["insert into public.working_hours (clinic_id, dentist_id, weekday, start_time, end_time) values ($1, $2, 0, '09:00', '10:00')", [a.clinicId, dentist.id]],
      ["insert into public.procedures (clinic_id, name, duration_minutes) values ($1, 'Sneaky', 30)", [a.clinicId]],
    ];
    for (const [sql, params] of inserts) {
      await expect(asUser(db, aStaff, sql, params), sql).rejects.toThrow(/row-level security/);
    }
  });

  it("refuses clinics that staff insert or delete", async () => {
    // Hardening revokes insert and delete on clinics for authenticated outright, so this fails on the grant, not RLS.
    await expect(
      asUser(db, aStaff, "insert into public.clinics (name, sms_name, slug, mobile) values ('Sneaky', 'Sneaky', 'sneaky-clinic', '+639170000009')"),
    ).rejects.toThrow(/permission denied/);
    await expect(asUser(db, aStaff, "delete from public.clinics where id = $1", [a.clinicId])).rejects.toThrow(/permission denied/);
  });

  it("changes when the owner changes it", async () => {
    expect(await asUser(db, a.userId, "update public.clinics set address = 'Pasig' where id = $1 returning address", [a.clinicId])).toEqual([{ address: "Pasig" }]);
    const [dentist] = await asUser<{ id: string }>(db, a.userId, "insert into public.dentists (clinic_id, name, sms_name) values ($1, 'Dr. Two', 'Dr. Two') returning id", [
      a.clinicId,
    ]);
    expect(
      await asUser(db, a.userId, "insert into public.working_hours (clinic_id, dentist_id, branch_id, weekday, start_time, end_time) select $1, $2, id, 2, '09:00', '12:00' from public.branches where clinic_id = $1 returning weekday", [
        a.clinicId,
        dentist.id,
      ]),
    ).toEqual([{ weekday: 2 }]);
    expect(await asUser(db, a.userId, "update public.procedures set duration_minutes = 45 where clinic_id = $1 returning duration_minutes", [a.clinicId])).toEqual([
      { duration_minutes: 45 },
    ]);
  });
});

describe("the day's work", () => {
  it("is open to staff: patients, appointments, attendance, and time off", async () => {
    const [dentist] = await asUser<{ id: string }>(db, aStaff, "select id from public.dentists where clinic_id = $1 order by created_at limit 1", [a.clinicId]);
    const [patient] = await asUser<{ id: string }>(db, aStaff, "insert into public.patients (clinic_id, first_name, last_name) values ($1, 'Lara', 'Santos') returning id", [
      a.clinicId,
    ]);
    const [visit] = await asUser<{ id: string }>(
      db,
      aStaff,
      `insert into public.appointments (clinic_id, branch_id, dentist_id, patient_id, starts_at, ends_at, status, procedure_names, source, manage_token)
       select $1, id, $2, $3, '2030-03-04T09:00:00+08:00', '2030-03-04T09:30:00+08:00', 'confirmed', '{Consultation}', 'manual', 'StaffVisit01'
       from public.branches where clinic_id = $1 returning id`,
      [a.clinicId, dentist.id, patient.id],
    );
    expect(await asUser(db, aStaff, "update public.appointments set status = 'completed' where id = $1 returning status", [visit.id])).toEqual([{ status: "completed" }]);
    const [off] = await asUser<{ id: string }>(
      db,
      aStaff,
      "insert into public.time_off (clinic_id, dentist_id, starts_at, ends_at) values ($1, $2, '2030-03-05T09:00:00+08:00', '2030-03-05T12:00:00+08:00') returning id",
      [a.clinicId, dentist.id],
    );
    expect(await asUser(db, aStaff, "delete from public.time_off where id = $1 returning id", [off.id])).toEqual([off]);
  });
});

describe("join links", () => {
  it("belong to the owner alone", async () => {
    const hash = hashInviteToken(await invite(db, a));
    expect(await asUser(db, a.userId, "select clinic_id from public.clinic_invites where token_hash = $1", [hash])).toEqual([{ clinic_id: a.clinicId }]);
    expect(await asUser(db, aStaff, "select id from public.clinic_invites")).toEqual([]);
    expect(await asUser(db, b.userId, "select id from public.clinic_invites where clinic_id = $1", [a.clinicId])).toEqual([]);
    expect(await asUser(db, aStaff, "update public.clinic_invites set revoked_at = now() returning id")).toEqual([]);
    for (const user of [aStaff, b.userId]) {
      await expect(
        asUser(db, user, "insert into public.clinic_invites (clinic_id, token_hash) values ($1, $2)", [a.clinicId, hashInviteToken(`Sneaky${user.slice(0, 6)}`)]),
      ).rejects.toThrow(/row-level security/);
    }
    await expect(asUser(db, null, "select id from public.clinic_invites")).rejects.toThrow(/permission denied/);
  });

  it("last 7 days from their making, and the owner can only revoke them, for good", async () => {
    const hash = hashInviteToken(await invite(db, a));
    expect(
      await asUser(db, a.userId, "select expires_at = created_at + interval '7 days' as week, created_by from public.clinic_invites where token_hash = $1", [hash]),
    ).toEqual([{ week: true, created_by: a.userId }]);
    await expect(
      asUser(db, a.userId, "insert into public.clinic_invites (clinic_id, token_hash, expires_at) values ($1, $2, '2099-01-01')", [
        a.clinicId,
        hashInviteToken("LongLived001"),
      ]),
    ).rejects.toThrow(/permission denied/);
    await expect(asUser(db, a.userId, "update public.clinic_invites set expires_at = '2099-01-01' where token_hash = $1", [hash])).rejects.toThrow(/permission denied/);
    expect(
      await asUser(db, a.userId, "update public.clinic_invites set revoked_at = now() where token_hash = $1 returning revoked_at is not null as revoked", [hash]),
    ).toEqual([{ revoked: true }]);
    await expect(asUser(db, a.userId, "update public.clinic_invites set revoked_at = null where token_hash = $1", [hash])).rejects.toThrow(/row-level security/);
  });
});

describe("accept_invite", () => {
  it("adds the caller as staff with their email, once", async () => {
    const c = await newClinic(db);
    const token = await invite(db, c);
    const user = await addUser(db);
    expect(await accept(user, token)).toEqual([{ clinic: c.clinicId }]);
    expect(await asUser(db, user, "select clinic_id, role, email from public.clinic_members where user_id = $1", [user])).toEqual([
      { clinic_id: c.clinicId, role: "staff", email: `${user}@example.com` },
    ]);
    expect(
      await asUser(db, c.userId, "select accepted_by, accepted_at is not null as accepted from public.clinic_invites where token_hash = $1", [hashInviteToken(token)]),
    ).toEqual([{ accepted_by: user, accepted: true }]);
    expect(await sqlstate(accept(await addUser(db), token))).toBe("BSUSD");
  });

  it("refuses revoked, expired, and unknown links, and adds nobody", async () => {
    const c = await newClinic(db);
    const revoked = await invite(db, c);
    await asUser(db, c.userId, "update public.clinic_invites set revoked_at = now() where token_hash = $1", [hashInviteToken(revoked)]);
    const expired = await invite(db, c);
    await db.query("update public.clinic_invites set expires_at = now() - interval '1 second' where token_hash = $1", [hashInviteToken(expired)]);
    const user = await addUser(db);
    expect(await sqlstate(accept(user, revoked))).toBe("BSREV");
    expect(await sqlstate(accept(user, expired))).toBe("BSEXP");
    expect(await sqlstate(accept(user, "NoSuchLink01"))).toBe("BSUNK");
    const { rows } = await db.query("select 1 from public.clinic_members where user_id = $1", [user]);
    expect(rows).toEqual([]);
  });

  it("refuses an account that already belongs to a clinic, and leaves the link open", async () => {
    const token = await invite(db, a);
    expect(await sqlstate(accept(b.userId, token))).toBe("23505");
    expect(await sqlstate(accept(aStaff, token))).toBe("23505");
    expect(await asUser(db, a.userId, "select accepted_at from public.clinic_invites where token_hash = $1", [hashInviteToken(token)])).toEqual([{ accepted_at: null }]);
  });

  it("is only for signed-in accounts", async () => {
    await expect(asUser(db, null, "select public.accept_invite('AbCdEfGhIjKl')")).rejects.toThrow(/permission denied/);
  });
});

describe("remove_member", () => {
  it("lets the owner remove staff, with their push subscriptions for the clinic", async () => {
    const c = await newClinic(db);
    const staff = await addStaff(db, c);
    const subscribe = (userId: string, n: number) =>
      db.query("insert into public.push_subscriptions (clinic_id, user_id, endpoint, p256dh, auth) values ($1, $2, $3, 'k', 'a')", [
        c.clinicId,
        userId,
        `https://fcm.googleapis.com/fcm/send/${c.clinicId}-${n}`,
      ]);
    await subscribe(staff, 1);
    await subscribe(staff, 2);
    await subscribe(c.userId, 3);
    await remove(c.userId, staff);
    expect(await asUser(db, c.userId, "select user_id from public.clinic_members")).toEqual([{ user_id: c.userId }]);
    const { rows } = await db.query("select user_id from public.push_subscriptions where clinic_id = $1", [c.clinicId]);
    expect(rows).toEqual([{ user_id: c.userId }]);
    // Their next request finds no clinic, and they are free to join another one.
    expect(await asUser(db, staff, "select id from public.clinics")).toEqual([]);
    const other = await newClinic(db);
    expect(await accept(staff, await invite(db, other))).toEqual([{ clinic: other.clinicId }]);
  });

  it("never removes an owner, and no one but the member's own clinic owner removes anyone", async () => {
    const c = await newClinic(db);
    const staff = await addStaff(db, c);
    const colleague = await addStaff(db, c);
    expect(await sqlstate(remove(c.userId, c.userId))).toBe("BSNOS");
    expect(await sqlstate(remove(staff, colleague))).toBe("BSNOS");
    expect(await sqlstate(remove(staff, c.userId))).toBe("BSNOS");
    expect(await sqlstate(remove(b.userId, staff))).toBe("BSNOS");
    await expect(remove(null, staff)).rejects.toThrow(/permission denied/);
    expect(await asUser(db, c.userId, "select user_id from public.clinic_members")).toHaveLength(3);
  });

  it("takes a person's push subscriptions with their membership through the foreign key alone", async () => {
    const c = await newClinic(db);
    const staff = await addStaff(db, c);
    await db.query("insert into public.push_subscriptions (clinic_id, user_id, endpoint, p256dh, auth) values ($1, $2, $3, 'k', 'a')", [
      c.clinicId,
      staff,
      `https://fcm.googleapis.com/fcm/send/${c.clinicId}-fk`,
    ]);
    // Deleting the membership directly (not through remove_member) still takes the subscription with it.
    await db.query("delete from public.clinic_members where clinic_id = $1 and user_id = $2", [c.clinicId, staff]);
    const { rows } = await db.query("select user_id from public.push_subscriptions where clinic_id = $1", [c.clinicId]);
    expect(rows).toEqual([]);
  });
});

describe("clinic_week_stats", () => {
  const zero = { completed: 0, no_show: 0, cancelled: 0, declined: 0, expired: 0, unmarked: 0, upcoming: 0, online: 0, manual: 0 };
  const COLUMNS = "week_start::text as week, dentist_id, completed, no_show, cancelled, declined, expired, unmarked, upcoming, online, manual";
  let c: Clinic;
  let cStaff: string;
  let first: string;
  let second: string;

  /** One appointment at a Manila time, straight into the table (no slot checks). */
  async function visit(dentistId: string, startsAt: string, status: string, source = "online") {
    await db.query(
      `insert into public.appointments (clinic_id, branch_id, dentist_id, patient_id, starts_at, ends_at, status, procedure_names, source, manage_token)
       select $1, b.id, $2, p.id, $3::timestamptz, $3::timestamptz + interval '30 minutes', $4, '{Consultation}', $5, substr(md5(random()::text), 1, 12)
       from public.patients p join public.branches b on b.clinic_id = p.clinic_id where p.clinic_id = $1 limit 1`,
      [c.clinicId, dentistId, startsAt, status, source],
    );
  }

  beforeAll(async () => {
    c = await newClinic(db);
    cStaff = await addStaff(db, c);
    await db.query("insert into public.patients (clinic_id, first_name, last_name) values ($1, 'Ana', 'Cruz')", [c.clinicId]);
    first = (await db.query<{ id: string }>("select id from public.dentists where clinic_id = $1", [c.clinicId])).rows[0].id;
    second = (await db.query<{ id: string }>("insert into public.dentists (clinic_id, name, sms_name) values ($1, 'Dr. Two', 'Dr. Two') returning id", [c.clinicId]))
      .rows[0].id;
    // The week of Mon Aug 31 to Sun Sep 6, 2026 (Manila), all before today.
    await visit(first, "2026-08-31T09:00:00+08:00", "completed");
    await visit(first, "2026-09-01T09:00:00+08:00", "completed", "manual");
    await visit(first, "2026-09-02T09:00:00+08:00", "no_show");
    await visit(first, "2026-09-03T09:00:00+08:00", "cancelled");
    await visit(first, "2026-09-04T09:00:00+08:00", "declined");
    await visit(first, "2026-09-05T09:00:00+08:00", "expired");
    await visit(first, "2026-09-05T10:00:00+08:00", "confirmed", "manual"); // started, and nobody marked it
    await visit(first, "2026-09-06T23:30:00+08:00", "completed"); // Sunday 11:30 PM Manila (15:30 UTC): still this week
    await visit(second, "2026-09-02T10:00:00+08:00", "no_show");
    await visit(second, "2026-08-31T00:30:00+08:00", "completed"); // Monday 12:30 AM Manila: the window's lower edge
    await visit(second, "2026-09-14T00:30:00+08:00", "completed"); // the week after next: outside a 2-week request from Aug 31
    await visit(first, "2026-09-07T00:30:00+08:00", "completed"); // Monday 12:30 AM Manila (Sunday in UTC): the next week
    await visit(first, "2099-01-08T09:00:00+08:00", "confirmed"); // still ahead (far enough out to outlive this test suite)
  }, 60_000);

  it("counts each status in its Manila week, per dentist", async () => {
    const rows = await asUser(db, c.userId, `select ${COLUMNS} from public.clinic_week_stats($1, '2026-08-31', 2)`, [c.clinicId]);
    expect(rows).toHaveLength(3);
    expect(rows).toEqual(
      expect.arrayContaining([
        { ...zero, week: "2026-08-31", dentist_id: first, completed: 3, no_show: 1, cancelled: 1, declined: 1, expired: 1, unmarked: 1, online: 6, manual: 2 },
        { ...zero, week: "2026-08-31", dentist_id: second, completed: 1, no_show: 1, online: 2 },
        { ...zero, week: "2026-09-07", dentist_id: first, completed: 1, online: 1 },
      ]),
    );
  });

  it("starts at the Monday of p_from's week and counts confirmed visits still ahead", async () => {
    // Jan 8, 2099 is a Thursday; Jan 5 is that week's Monday (unlike 2030, where Jan 7 was the Monday).
    expect(await asService(db, `select ${COLUMNS} from public.clinic_week_stats($1, '2099-01-10', 1)`, [c.clinicId])).toEqual([
      { ...zero, week: "2099-01-05", dentist_id: first, upcoming: 1, online: 1 },
    ]);
  });

  it("shows members only their own clinic's counts", async () => {
    expect(await asUser(db, cStaff, "select dentist_id from public.clinic_week_stats($1, '2026-08-31', 2)", [c.clinicId])).toHaveLength(3);
    expect(await asUser(db, b.userId, "select dentist_id from public.clinic_week_stats($1, '2026-08-31', 2)", [c.clinicId])).toEqual([]);
    await expect(asUser(db, null, "select * from public.clinic_week_stats($1, '2026-08-31', 2)", [c.clinicId])).rejects.toThrow(/permission denied/);
  });
});
