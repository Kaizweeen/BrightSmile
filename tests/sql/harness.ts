import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import type { CreateClinicPayload } from "@/lib/onboarding";

const DIR = new URL("../../supabase/migrations/", import.meta.url);

/** Every migration file, in the order Supabase (and Kai, pasting) applies them. */
export const MIGRATIONS = readdirSync(DIR)
  .filter((file) => file.endsWith(".sql"))
  .sort();

/**
 * What a Supabase project has before our first migration: the three API roles, auth.users, auth.uid()
 * reading the JWT claims the way PostgREST sets them, and Supabase's default privileges, which grant
 * every new table, sequence, and function in public to anon, authenticated, and service_role. Keeping
 * those defaults means a migration that forgets a revoke fails a test here instead of leaking in production.
 */
const SUPABASE = `
  set timezone to 'UTC';
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema extensions;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$
    select coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    )::uuid
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

/** Applies one migration file, naming it when it fails. */
export async function migrate(db: PGlite, file: string): Promise<void> {
  try {
    await db.exec(readFileSync(new URL(file, DIR), "utf8"));
  } catch (e) {
    throw new Error(`${file}: ${(e as Error).message}`);
  }
}

/** An in-process Postgres with the Supabase stand-in and the first `count` migrations (all by default). */
export async function freshDb(count = MIGRATIONS.length): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { btree_gist } });
  await db.exec(SUPABASE);
  for (const file of MIGRATIONS.slice(0, count)) await migrate(db, file);
  return db;
}

/**
 * Runs one statement the way PostgREST runs a request: inside a transaction, as role authenticated with
 * the user's claims, or as anon when userId is null. The role ends with the transaction.
 */
export async function asUser<T>(db: PGlite, userId: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('role', $1, true), set_config('request.jwt.claims', $2, true)", [
      userId ? "authenticated" : "anon",
      JSON.stringify(userId ? { sub: userId, role: "authenticated" } : { role: "anon" }),
    ]);
    return (await tx.query<T>(sql, params)).rows;
  });
}

/** Runs one statement as the server's secret key does (service_role, which bypasses RLS). */
export async function asService<T>(db: PGlite, sql: string, params: unknown[] = []): Promise<T[]> {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('role', 'service_role', true)");
    return (await tx.query<T>(sql, params)).rows;
  });
}

/** A signed-up user (a row in auth.users). Returns the user id. */
export async function addUser(db: PGlite): Promise<string> {
  const id = randomUUID();
  await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${id}@example.com`]);
  return id;
}

/** A new user and the clinic they create through public.create_clinic, as onboarding does. */
export async function newClinic(db: PGlite): Promise<{ userId: string; clinicId: string }> {
  const userId = await addUser(db);
  const payload: CreateClinicPayload = {
    name: "Sample Clinic",
    sms_name: "Sample Clinic",
    slug: `c-${randomUUID().slice(0, 8)}`,
    mobile: "+639170000001",
    address: "Makati",
    dentist: { name: "Dr. Ana Reyes", sms_name: "Dr. Reyes" },
    hours: [{ weekday: 1, start: "09:00", end: "17:00" }],
    procedures: [{ name: "Consultation", minutes: 30 }],
  };
  const [row] = await asUser<{ id: string }>(db, userId, "select public.create_clinic($1::jsonb) as id", [JSON.stringify(payload)]);
  return { userId, clinicId: row.id };
}
