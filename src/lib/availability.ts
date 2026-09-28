import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PublicClinic, PublicDentist } from "@/lib/booking-input";
import { openDates, openStarts, type Block, type Busy } from "@/lib/slots";
import { adminClient } from "@/lib/supabase/admin";
import { addDays, manilaDate, manilaInstant, monthDates, parseClock, weekday } from "@/lib/time";

type ClinicRow = {
  id: string;
  slug: string;
  name: string;
  sms_name: string;
  mobile: string;
  address: string;
  maps_url: string | null;
  slot_minutes: number;
  min_notice_minutes: number;
  max_days_ahead: number;
};
type HoursRow = { dentist_id: string; branch_id: string; weekday: number; start_time: string; end_time: string };
type BranchRow = { id: string; name: string; address: string; maps_url: string | null };

/**
 * The public booking page's clinic at one branch (booking flow spec 4): its active branches, the active dentists who
 * work at that branch with their weekly hours there, active procedures, and rules. Without a branch it is the clinic's
 * first active branch (by sort), where every page from before branches books. Null when the clinic does not exist or
 * the branch is not one of its active branches.
 */
export async function loadClinic(by: { slug: string } | { id: string }, branchId?: string): Promise<PublicClinic | null> {
  const db = adminClient();
  const [column, value] = "slug" in by ? ["slug", by.slug] : ["id", by.id];
  const { data, error } = await db
    .from("clinics")
    .select("id, slug, name, sms_name, mobile, address, maps_url, slot_minutes, min_notice_minutes, max_days_ahead")
    .eq(column, value)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const c = data as ClinicRow;

  const [branches, dentists, hours, procedures] = await Promise.all([
    db.from("branches").select("id, name, address, maps_url").eq("clinic_id", c.id).eq("active", true).order("sort").order("created_at").order("id").throwOnError(),
    db.from("dentists").select("id, name, sms_name").eq("clinic_id", c.id).eq("active", true).order("created_at").order("name").throwOnError(),
    db.from("working_hours").select("dentist_id, branch_id, weekday, start_time, end_time").eq("clinic_id", c.id).throwOnError(),
    db.from("procedures").select("id, name, duration_minutes").eq("clinic_id", c.id).eq("active", true).order("name").throwOnError(),
  ]);
  const active = (branches.data as BranchRow[]).map((b) => ({ id: b.id, name: b.name, address: b.address, mapsUrl: b.maps_url }));
  const branch = branchId === undefined ? active[0] : active.find((b) => b.id === branchId);
  if (!branch) return null;
  // Open times for a branch come from the working hours at that branch only (spec 4).
  const hourRows = (hours.data as HoursRow[]).filter((h) => h.branch_id === branch.id);
  const week = (dentistId: string): Block[][] =>
    Array.from({ length: 7 }, (_, day) =>
      hourRows
        .filter((h) => h.dentist_id === dentistId && h.weekday === day)
        .map((h) => ({ start: parseClock(h.start_time), end: parseClock(h.end_time) }))
        .sort((a, b) => a.start - b.start),
    );

  return {
    id: c.id,
    slug: c.slug,
    name: c.name,
    smsName: c.sms_name,
    mobile: c.mobile,
    address: c.address,
    mapsUrl: c.maps_url,
    rules: { slotMinutes: c.slot_minutes, minNoticeMinutes: c.min_notice_minutes, maxDaysAhead: c.max_days_ahead },
    branch,
    branches: active,
    // A dentist appears at the branches where they have hours. Every dentist has hours (onboarding and Settings
    // require a block), so a clinic with one branch lists every active dentist, as before.
    dentists: (dentists.data as { id: string; name: string; sms_name: string }[])
      .map((d) => ({ id: d.id, name: d.name, smsName: d.sms_name, hours: week(d.id) }))
      .filter((d) => d.hours.some((day) => day.length > 0)),
    procedures: (procedures.data as { id: string; name: string; duration_minutes: number }[]).map((p) => ({
      id: p.id,
      name: p.name,
      minutes: p.duration_minutes,
    })),
  };
}

/**
 * Pending and confirmed appointments (with their ids, so a move can ignore its own) plus time off for one
 * dentist, overlapping [from, to). The public flow passes the secret-key client; staff pass their RLS
 * client, which only sees their own clinic. Never leaves the server.
 */
export async function busyBetween(db: SupabaseClient, dentistId: string, from: Date, to: Date): Promise<Busy[]> {
  const [appointments, timeOff] = await Promise.all([
    db
      .from("appointments")
      .select("id, starts_at, ends_at")
      .eq("dentist_id", dentistId)
      .in("status", ["pending", "confirmed"])
      .lt("starts_at", to.toISOString())
      .gt("ends_at", from.toISOString())
      .throwOnError(),
    db
      .from("time_off")
      .select("starts_at, ends_at")
      .eq("dentist_id", dentistId)
      .lt("starts_at", to.toISOString())
      .gt("ends_at", from.toISOString())
      .throwOnError(),
  ]);
  const booked = (appointments.data as { id: string; starts_at: string; ends_at: string }[]).map((r) => ({
    id: r.id,
    start: new Date(r.starts_at),
    end: new Date(r.ends_at),
  }));
  const off = (timeOff.data as { starts_at: string; ends_at: string }[]).map((r) => ({
    start: new Date(r.starts_at),
    end: new Date(r.ends_at),
  }));
  return [...booked, ...off];
}

/**
 * Dates of a "YYYY-MM" month with at least one open start for this dentist and duration (spec 8.3). ignoreId is the
 * appointment being changed, whose own time counts as free (booking flow spec 3.4).
 */
export async function monthOpenDates(
  clinic: PublicClinic,
  dentist: PublicDentist,
  durationMinutes: number,
  month: string,
  now: Date,
  ignoreId?: string,
): Promise<string[]> {
  const dates = monthDates(month);
  const today = manilaDate(now);
  const first = dates[0];
  const last = dates[dates.length - 1];
  if (last < today || first > addDays(today, clinic.rules.maxDaysAhead)) return [];
  const busy = await busyBetween(adminClient(), dentist.id, manilaInstant(first, 0), manilaInstant(addDays(last, 1), 0));
  return openDates({ dates, blocksByWeekday: dentist.hours, busy, durationMinutes, rules: clinic.rules, now, ignoreId });
}

/** Open start instants on one Manila date for this dentist and duration (spec 8), ignoring ignoreId's own time. */
export async function dayOpenStarts(
  clinic: PublicClinic,
  dentist: PublicDentist,
  durationMinutes: number,
  date: string,
  now: Date,
  ignoreId?: string,
): Promise<Date[]> {
  const today = manilaDate(now);
  if (date < today || date > addDays(today, clinic.rules.maxDaysAhead)) return [];
  const busy = await busyBetween(adminClient(), dentist.id, manilaInstant(date, 0), manilaInstant(addDays(date, 1), 0));
  return openStarts({ date, blocks: dentist.hours[weekday(date)], busy, durationMinutes, rules: clinic.rules, now, ignoreId });
}
