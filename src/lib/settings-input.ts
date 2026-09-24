import { clinicProblems, dentistProblems, type Clock, type OnboardingInput } from "@/lib/onboarding";
import { normalizeMobile } from "@/lib/phone";
import { manilaInstant } from "@/lib/time";
import { cleanText, LIMITS } from "@/lib/validate";

export type Parsed<T> = { ok: true; value: T } | { ok: false; field: string; error: string };

export type ProfileRow = { name: string; sms_name: string; slug: string; mobile: string; address: string; maps_url: string | null };
export type RulesRow = { slot_minutes: number; min_notice_minutes: number; max_days_ahead: number; alert_channel: "push" | "sms" };
export type DentistRow = { name: string; sms_name: string; hours: { weekday: number; start_time: string; end_time: string }[] };
export type TimeOffRow = { starts_at: string; ends_at: string; note: string };
export type ProcedureRow = { name: string; duration_minutes: number };

const record = (value: unknown) => (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
const text = (value: unknown) => (typeof value === "string" ? value : "");
const fail = (field: string, error: string) => ({ ok: false as const, field, error });

function mapsUrlOk(url: string): boolean {
  if (url.length > LIMITS.mapsUrl || !url.startsWith("https://")) return false;
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

/** Clinic profile (spec 5.3): the onboarding rules, plus an optional https map link (a Plan 2 deferral). */
export function parseProfile(value: unknown): Parsed<ProfileRow> {
  const v = record(value);
  const input = { name: text(v.name), smsName: text(v.smsName), slug: text(v.slug), mobile: text(v.mobile), address: text(v.address) };
  const problem = Object.entries(clinicProblems(input as OnboardingInput))[0];
  if (problem) return fail(problem[0], problem[1]);
  const mapsUrl = text(v.mapsUrl).trim();
  if (mapsUrl && !mapsUrlOk(mapsUrl)) return fail("mapsUrl", `Paste a map link that starts with https://, up to ${LIMITS.mapsUrl} characters.`);
  return {
    ok: true,
    value: {
      name: input.name.trim(),
      sms_name: input.smsName.trim(),
      slug: input.slug,
      mobile: normalizeMobile(input.mobile)!,
      address: input.address.trim(),
      maps_url: mapsUrl || null,
    },
  };
}

/** Booking rules and the alert channel (spec 5.3 and 7). Form values may arrive as strings. */
export function parseRules(value: unknown): Parsed<RulesRow> {
  const v = record(value);
  const slot = Number(v.slotMinutes);
  const notice = Number(v.minNoticeMinutes);
  const days = Number(v.maxDaysAhead);
  const channel = v.alertChannel;
  if (![15, 30, 60].includes(slot)) return fail("slotMinutes", "Choose 15, 30, or 60 minutes.");
  if (!Number.isInteger(notice) || notice < 0 || notice > 10080) return fail("minNoticeMinutes", "Use no notice up to 7 days.");
  if (!Number.isInteger(days) || days < 1 || days > 365) return fail("maxDaysAhead", "Use 1 to 365 days.");
  if (channel !== "push" && channel !== "sms") return fail("alertChannel", "Choose push or text.");
  return { ok: true, value: { slot_minutes: slot, min_notice_minutes: notice, max_days_ahead: days, alert_channel: channel } };
}

const DENTIST_FIELD = { dentistName: "name", dentistSmsName: "smsName", hours: "hours" } as Record<string, string>;

/** A dentist with weekly hours (several blocks per day), checked by the onboarding rules. */
export function parseDentist(value: unknown): Parsed<DentistRow> {
  const v = record(value);
  const input = { dentistName: text(v.name), dentistSmsName: text(v.smsName), hours: v.hours };
  const problem = Object.entries(dentistProblems(input as OnboardingInput))[0];
  if (problem) return fail(DENTIST_FIELD[problem[0]], problem[1]);
  const hours = (v.hours as Clock[][]).flatMap((blocks, weekday) => blocks.map((b) => ({ weekday, start_time: b.start, end_time: b.end })));
  return { ok: true, value: { name: input.dentistName.trim(), sms_name: input.dentistSmsName.trim(), hours } };
}

const LOCAL = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::00)?$/;

/** A datetime-local value ("2026-10-01T09:00") as a Manila wall-clock instant, or null. */
function manilaLocal(value: unknown): Date | null {
  const m = typeof value === "string" ? LOCAL.exec(value) : null;
  if (!m) return null;
  const day = new Date(`${m[1]}T00:00:00Z`);
  if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== m[1]) return null;
  return manilaInstant(m[1], Number(m[2]) * 60 + Number(m[3]));
}

/** Time off (spec 7): start before end, not already over, a note up to 100 characters. */
export function parseTimeOff(value: unknown, now: Date): Parsed<TimeOffRow> {
  const v = record(value);
  const start = manilaLocal(v.from);
  const end = manilaLocal(v.to);
  if (!start) return fail("from", "Enter when the time off starts.");
  if (!end || end <= start) return fail("to", "The end must be after the start.");
  if (end <= now) return fail("to", "This time off is already over.");
  const note = cleanText(v.note, LIMITS.timeOffNote, true);
  if (note === null) return fail("note", `Keep the note to ${LIMITS.timeOffNote} characters or fewer.`);
  return { ok: true, value: { starts_at: start.toISOString(), ends_at: end.toISOString(), note } };
}

/** A procedure: name up to 60 characters, 5 to 480 minutes. */
export function parseProcedure(value: unknown): Parsed<ProcedureRow> {
  const v = record(value);
  const name = cleanText(v.name, LIMITS.procedureName);
  if (!name) return fail("name", `Enter a name, up to ${LIMITS.procedureName} characters.`);
  const minutes = typeof v.minutes === "string" && v.minutes.trim() === "" ? NaN : Number(v.minutes);
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 480) return fail("minutes", "Use 5 to 480 minutes.");
  return { ok: true, value: { name, duration_minutes: minutes } };
}
