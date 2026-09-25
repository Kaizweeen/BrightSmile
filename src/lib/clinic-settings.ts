import "server-only";
import type { Clock } from "@/lib/onboarding";
import { parseDentist, parseProcedure, parseProfile, parseRules, parseTimeOff } from "@/lib/settings-input";
import type { Saved } from "@/lib/staff-input";
import type { Staff } from "@/lib/supabase/server";
import { formatClock, parseClock } from "@/lib/time";
import { isUuid } from "@/lib/validate";

export type SettingsView = {
  clinic: {
    name: string;
    smsName: string;
    slug: string;
    mobile: string;
    address: string;
    mapsUrl: string;
    slotMinutes: number;
    minNoticeMinutes: number;
    maxDaysAhead: number;
    alertChannel: "push" | "sms";
  };
  dentists: {
    id: string;
    name: string;
    smsName: string;
    active: boolean;
    hours: Clock[][];
    timeOff: { id: string; startsAt: string; endsAt: string; note: string }[];
  }[];
  procedures: { id: string; name: string; minutes: number; active: boolean }[];
};

const GENERIC = "Something went wrong. Please try again.";
const GONE = "That item no longer exists. Reload the page.";

function failure(where: string, e: unknown): Saved {
  console.error(`${where} failed:`, String((e as { message?: unknown } | null)?.message ?? e));
  return { ok: false, error: GENERIC };
}

/** Everything the Settings page edits. Time off lists only entries that are not over yet. */
export async function loadSettings(staff: Staff, now: Date): Promise<SettingsView> {
  const [clinic, dentists, hours, timeOff, procedures] = await Promise.all([
    staff.db
      .from("clinics")
      .select("name, sms_name, slug, mobile, address, maps_url, slot_minutes, min_notice_minutes, max_days_ahead, alert_channel")
      .eq("id", staff.clinicId)
      .single()
      .throwOnError(),
    staff.db.from("dentists").select("id, name, sms_name, active").eq("clinic_id", staff.clinicId).order("created_at").order("name").throwOnError(),
    staff.db.from("working_hours").select("dentist_id, weekday, start_time, end_time").eq("clinic_id", staff.clinicId).throwOnError(),
    staff.db
      .from("time_off")
      .select("id, dentist_id, starts_at, ends_at, note")
      .eq("clinic_id", staff.clinicId)
      .gt("ends_at", now.toISOString())
      .order("starts_at")
      .throwOnError(),
    staff.db.from("procedures").select("id, name, duration_minutes, active").eq("clinic_id", staff.clinicId).order("name").throwOnError(),
  ]);
  const c = clinic.data as {
    name: string;
    sms_name: string;
    slug: string;
    mobile: string;
    address: string;
    maps_url: string | null;
    slot_minutes: number;
    min_notice_minutes: number;
    max_days_ahead: number;
    alert_channel: "push" | "sms";
  };
  const hourRows = hours.data as { dentist_id: string; weekday: number; start_time: string; end_time: string }[];
  const offRows = timeOff.data as { id: string; dentist_id: string; starts_at: string; ends_at: string; note: string }[];
  const clock = (value: string) => formatClock(parseClock(value));

  return {
    clinic: {
      name: c.name,
      smsName: c.sms_name,
      slug: c.slug,
      mobile: c.mobile,
      address: c.address,
      mapsUrl: c.maps_url ?? "",
      slotMinutes: c.slot_minutes,
      minNoticeMinutes: c.min_notice_minutes,
      maxDaysAhead: c.max_days_ahead,
      alertChannel: c.alert_channel,
    },
    dentists: (dentists.data as { id: string; name: string; sms_name: string; active: boolean }[]).map((d) => ({
      id: d.id,
      name: d.name,
      smsName: d.sms_name,
      active: d.active,
      hours: Array.from({ length: 7 }, (_, day) =>
        hourRows
          .filter((h) => h.dentist_id === d.id && h.weekday === day)
          .map((h) => ({ start: clock(h.start_time), end: clock(h.end_time) }))
          .sort((x, y) => x.start.localeCompare(y.start)),
      ),
      timeOff: offRows
        .filter((t) => t.dentist_id === d.id)
        .map((t) => ({ id: t.id, startsAt: t.starts_at, endsAt: t.ends_at, note: t.note })),
    })),
    procedures: (procedures.data as { id: string; name: string; duration_minutes: number; active: boolean }[]).map((p) => ({
      id: p.id,
      name: p.name,
      minutes: p.duration_minutes,
      active: p.active,
    })),
  };
}

/** Clinic profile. RLS lets staff update only their own clinic row. */
export async function saveProfile(staff: Staff, input: unknown): Promise<Saved> {
  const parsed = parseProfile(input);
  if (!parsed.ok) return parsed;
  try {
    const { error } = await staff.db.from("clinics").update(parsed.value).eq("id", staff.clinicId);
    if (error?.code === "23505") return { ok: false, field: "slug", error: "That booking link is taken. Try another." };
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    return failure("saveProfile", e);
  }
}

/** Booking rules and the alert channel. */
export async function saveRules(staff: Staff, input: unknown): Promise<Saved> {
  const parsed = parseRules(input);
  if (!parsed.ok) return parsed;
  try {
    await staff.db.from("clinics").update(parsed.value).eq("id", staff.clinicId).throwOnError();
    return { ok: true };
  } catch (e) {
    return failure("saveRules", e);
  }
}

/** Adds a dentist (id null) or edits one, and replaces their weekly hours. */
export async function saveDentist(staff: Staff, id: string | null, input: unknown): Promise<Saved> {
  if (id !== null && !isUuid(id)) return { ok: false, error: GONE };
  const parsed = parseDentist(input);
  if (!parsed.ok) return parsed;
  const { name, sms_name, hours } = parsed.value;
  try {
    let dentistId: string;
    if (id === null) {
      const { data } = await staff.db
        .from("dentists")
        .insert({ clinic_id: staff.clinicId, name, sms_name })
        .select("id")
        .single()
        .throwOnError();
      dentistId = (data as { id: string }).id;
    } else {
      const { data } = await staff.db
        .from("dentists")
        .update({ name, sms_name })
        .eq("id", id)
        .eq("clinic_id", staff.clinicId)
        .select("id")
        .throwOnError();
      if (data.length === 0) return { ok: false, error: GONE };
      dentistId = id;
    }
    // ponytail: two statements, not one transaction. The new hours go in before the old rows go, so a
    // failure never leaves a dentist with no hours, and saving again removes any leftover rows.
    const { data: old } = await staff.db
      .from("working_hours")
      .select("id")
      .eq("clinic_id", staff.clinicId)
      .eq("dentist_id", dentistId)
      .throwOnError();
    await staff.db
      .from("working_hours")
      .insert(hours.map((h) => ({ clinic_id: staff.clinicId, dentist_id: dentistId, ...h })))
      .throwOnError();
    const oldIds = (old as { id: string }[]).map((o) => o.id);
    if (oldIds.length > 0) await staff.db.from("working_hours").delete().in("id", oldIds).throwOnError();
    return { ok: true };
  } catch (e) {
    return failure("saveDentist", e);
  }
}

/** Deactivates or reactivates a dentist. The clinic keeps at least one active dentist. */
export async function setDentistActive(staff: Staff, id: string, active: boolean): Promise<Saved> {
  if (!isUuid(id)) return { ok: false, error: GONE };
  try {
    if (!active) {
      const { count } = await staff.db
        .from("dentists")
        .select("id", { count: "exact", head: true })
        .eq("clinic_id", staff.clinicId)
        .eq("active", true)
        .neq("id", id)
        .throwOnError();
      if ((count ?? 0) === 0) return { ok: false, error: "Keep at least one active dentist, or patients can't book." };
    }
    const { data } = await staff.db.from("dentists").update({ active }).eq("id", id).eq("clinic_id", staff.clinicId).select("id").throwOnError();
    return data.length > 0 ? { ok: true } : { ok: false, error: GONE };
  } catch (e) {
    return failure("setDentistActive", e);
  }
}

/** Time off for one of this clinic's dentists. Existing visits stay and show "Outside hours" (spec 13). */
export async function addTimeOff(staff: Staff, dentistId: string, input: unknown, now: Date): Promise<Saved> {
  if (!isUuid(dentistId)) return { ok: false, error: GONE };
  const parsed = parseTimeOff(input, now);
  if (!parsed.ok) return parsed;
  try {
    const { data: dentist } = await staff.db
      .from("dentists")
      .select("id")
      .eq("id", dentistId)
      .eq("clinic_id", staff.clinicId)
      .maybeSingle()
      .throwOnError();
    if (!dentist) return { ok: false, error: GONE };
    await staff.db.from("time_off").insert({ clinic_id: staff.clinicId, dentist_id: dentistId, ...parsed.value }).throwOnError();
    return { ok: true };
  } catch (e) {
    return failure("addTimeOff", e);
  }
}

export async function removeTimeOff(staff: Staff, id: string): Promise<Saved> {
  if (!isUuid(id)) return { ok: false, error: GONE };
  try {
    const { data } = await staff.db.from("time_off").delete().eq("id", id).eq("clinic_id", staff.clinicId).select("id").throwOnError();
    return data.length > 0 ? { ok: true } : { ok: false, error: GONE };
  } catch (e) {
    return failure("removeTimeOff", e);
  }
}

/** Adds a procedure (id null) or edits one. Past appointments keep the names they were booked with. */
export async function saveProcedure(staff: Staff, id: string | null, input: unknown): Promise<Saved> {
  if (id !== null && !isUuid(id)) return { ok: false, error: GONE };
  const parsed = parseProcedure(input);
  if (!parsed.ok) return parsed;
  try {
    if (id === null) {
      await staff.db.from("procedures").insert({ clinic_id: staff.clinicId, ...parsed.value }).throwOnError();
      return { ok: true };
    }
    const { data } = await staff.db.from("procedures").update(parsed.value).eq("id", id).eq("clinic_id", staff.clinicId).select("id").throwOnError();
    return data.length > 0 ? { ok: true } : { ok: false, error: GONE };
  } catch (e) {
    return failure("saveProcedure", e);
  }
}

/** Archives or restores a procedure (spec 13: removed means archived). The clinic keeps at least one active. */
export async function setProcedureActive(staff: Staff, id: string, active: boolean): Promise<Saved> {
  if (!isUuid(id)) return { ok: false, error: GONE };
  try {
    if (!active) {
      const { count } = await staff.db
        .from("procedures")
        .select("id", { count: "exact", head: true })
        .eq("clinic_id", staff.clinicId)
        .eq("active", true)
        .neq("id", id)
        .throwOnError();
      if ((count ?? 0) === 0) return { ok: false, error: "Keep at least one active procedure, or patients can't book." };
    }
    const { data } = await staff.db.from("procedures").update({ active }).eq("id", id).eq("clinic_id", staff.clinicId).select("id").throwOnError();
    return data.length > 0 ? { ok: true } : { ok: false, error: GONE };
  } catch (e) {
    return failure("setProcedureActive", e);
  }
}
