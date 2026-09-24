import "server-only";
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
type HoursRow = { dentist_id: string; weekday: number; start_time: string; end_time: string };

/** The public booking page's clinic: active dentists with their weekly hours, active procedures, and rules. */
export async function loadClinic(by: { slug: string } | { id: string }): Promise<PublicClinic | null> {
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

  const [dentists, hours, procedures] = await Promise.all([
    db.from("dentists").select("id, name, sms_name").eq("clinic_id", c.id).eq("active", true).order("created_at").order("name").throwOnError(),
    db.from("working_hours").select("dentist_id, weekday, start_time, end_time").eq("clinic_id", c.id).throwOnError(),
    db.from("procedures").select("id, name, duration_minutes").eq("clinic_id", c.id).eq("active", true).order("name").throwOnError(),
  ]);
  const hourRows = hours.data as HoursRow[];
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
    dentists: (dentists.data as { id: string; name: string; sms_name: string }[]).map((d) => ({
      id: d.id,
      name: d.name,
      smsName: d.sms_name,
      hours: week(d.id),
    })),
    procedures: (procedures.data as { id: string; name: string; duration_minutes: number }[]).map((p) => ({
      id: p.id,
      name: p.name,
      minutes: p.duration_minutes,
    })),
  };
}

/** Pending and confirmed appointments plus time off for one dentist, overlapping [from, to). Never leaves the server. */
async function busyBetween(dentistId: string, from: Date, to: Date): Promise<Busy[]> {
  const db = adminClient();
  const [appointments, timeOff] = await Promise.all([
    db
      .from("appointments")
      .select("starts_at, ends_at")
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
  const rows = [...appointments.data, ...timeOff.data] as { starts_at: string; ends_at: string }[];
  return rows.map((r) => ({ start: new Date(r.starts_at), end: new Date(r.ends_at) }));
}

/** Dates of a "YYYY-MM" month with at least one open start for this dentist and duration (spec 8.3). */
export async function monthOpenDates(
  clinic: PublicClinic,
  dentist: PublicDentist,
  durationMinutes: number,
  month: string,
  now: Date,
): Promise<string[]> {
  const dates = monthDates(month);
  const today = manilaDate(now);
  const first = dates[0];
  const last = dates[dates.length - 1];
  if (last < today || first > addDays(today, clinic.rules.maxDaysAhead)) return [];
  const busy = await busyBetween(dentist.id, manilaInstant(first, 0), manilaInstant(addDays(last, 1), 0));
  return openDates({ dates, blocksByWeekday: dentist.hours, busy, durationMinutes, rules: clinic.rules, now });
}

/** Open start instants on one Manila date for this dentist and duration (spec 8). */
export async function dayOpenStarts(
  clinic: PublicClinic,
  dentist: PublicDentist,
  durationMinutes: number,
  date: string,
  now: Date,
): Promise<Date[]> {
  const today = manilaDate(now);
  if (date < today || date > addDays(today, clinic.rules.maxDaysAhead)) return [];
  const busy = await busyBetween(dentist.id, manilaInstant(date, 0), manilaInstant(addDays(date, 1), 0));
  return openStarts({ date, blocks: dentist.hours[weekday(date)], busy, durationMinutes, rules: clinic.rules, now });
}
