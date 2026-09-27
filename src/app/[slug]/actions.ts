"use server";

import { cookies, headers } from "next/headers";
import { dayOpenStarts, loadClinic, monthOpenDates } from "@/lib/availability";
import * as booking from "@/lib/booking";
import { resolveSelection } from "@/lib/booking-input";
import { DEVICE_COOKIE, readDevice, signDevice } from "@/lib/codes";
import * as numbers from "@/lib/number-booking";
import { clientIp } from "@/lib/request";
import { isUuid } from "@/lib/validate";

// Server Actions are public POST endpoints: every argument is checked here before use.
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const DEVICE_MAX_AGE = 180 * 86_400;

/** The numbers this phone verified (the signed bs_verified cookie, spec 10.3), as of now. */
async function device(now: Date): Promise<numbers.Device> {
  const store = await cookies();
  return { verifiedMobiles: readDevice(store.get(DEVICE_COOKIE)?.value, now), now };
}

/** Spec 10.3: remember up to 5 verified mobiles on this device for 180 days. */
async function remember(mobile: string, now: Date): Promise<void> {
  const store = await cookies();
  const known = readDevice(store.get(DEVICE_COOKIE)?.value, now).filter((m) => m !== mobile);
  store.set(DEVICE_COOKIE, signDevice([...known, mobile], now), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: DEVICE_MAX_AGE,
  });
}

/**
 * The branch, dentist, and procedures the client picked, checked against the clinic. No branch: the first active one.
 * While a patient changes an appointment (booking flow spec 3.4), selection.changing names it and selection.mobile its
 * number: the times are then at the appointment's own branch, and its own time counts as free. Only for a number this
 * phone verified, and only that number's own appointment.
 */
async function chosen(slug: unknown, selection: unknown) {
  if (typeof slug !== "string") return null;
  const v = (typeof selection === "object" && selection !== null ? selection : {}) as Record<string, unknown>;
  let branchId = isUuid(v.branchId) ? v.branchId : undefined;
  let ignoreId: string | undefined;
  if (v.changing !== undefined) {
    const scope = await numbers.changeScope(slug, v.mobile, v.changing, await device(new Date()));
    if (!scope) return null;
    ({ branchId, ignoreId } = scope);
  }
  const clinic = await loadClinic({ slug }, branchId);
  const picked = clinic ? resolveSelection(clinic, selection) : null;
  return clinic && picked ? { clinic, picked, ignoreId } : null;
}

/** Enabled days of a month: dates only, never busy times (spec 6). */
export async function getOpenDates(slug: string, selection: unknown, month: string): Promise<string[]> {
  if (typeof month !== "string" || !MONTH.test(month)) return [];
  const found = await chosen(slug, selection);
  if (!found) return [];
  return monthOpenDates(found.clinic, found.picked.dentist, found.picked.duration, month, new Date(), found.ignoreId);
}

/** Open start times of one day as ISO instants. */
export async function getOpenStarts(slug: string, selection: unknown, date: string): Promise<string[]> {
  if (typeof date !== "string" || !DATE.test(date)) return [];
  const found = await chosen(slug, selection);
  if (!found) return [];
  const starts = await dayOpenStarts(found.clinic, found.picked.dentist, found.picked.duration, date, new Date(), found.ignoreId);
  return starts.map((s) => s.toISOString());
}

export async function requestBooking(slug: string, input: unknown): Promise<booking.BookingOutcome> {
  const now = new Date();
  const ip = clientIp((await headers()).get("x-forwarded-for"));
  const { verifiedMobiles } = await device(now);
  return booking.requestBooking(String(slug), input, { ip, now, verifiedMobiles });
}

export async function verifyBookingCode(requestId: string, code: string): Promise<booking.VerifyOutcome> {
  const now = new Date();
  const { outcome, verifiedMobile } = await booking.verifyCode(String(requestId), String(code), now);
  if (verifiedMobile) await remember(verifiedMobile, now);
  return outcome;
}

/** Booking flow spec 3.2: straight on for a number this phone verified before, otherwise a code by text. */
export async function startVerification(slug: string, mobile: string): Promise<numbers.StartOutcome> {
  const now = new Date();
  const ip = clientIp((await headers()).get("x-forwarded-for"));
  return numbers.startVerification(String(slug), mobile, { ...(await device(now)), ip });
}

/** Spec 3.2 step 3: a right code remembers the number on this phone. A new code is resendBookingCode. */
export async function checkVerification(requestId: string, code: string): Promise<numbers.CheckOutcome> {
  const now = new Date();
  const outcome = await numbers.checkVerification(String(requestId), String(code), now);
  if (outcome.status === "verified") await remember(outcome.mobile, now);
  return outcome;
}

/** Spec 3.3 step 3: the verified number's patients at this clinic. */
export async function numberPatients(slug: string, mobile: string): Promise<numbers.PatientsOutcome> {
  return numbers.numberPatients(String(slug), mobile, await device(new Date()));
}

/** Spec 3.4 and 3.5 step 2: the verified number's upcoming appointments at this clinic. */
export async function numberAppointments(slug: string, mobile: string): Promise<numbers.AppointmentsOutcome> {
  return numbers.numberAppointments(String(slug), mobile, await device(new Date()));
}

export async function resendBookingCode(requestId: string): Promise<booking.ResendOutcome> {
  const ip = clientIp((await headers()).get("x-forwarded-for"));
  return booking.resendCode(String(requestId), { ip, now: new Date() });
}

/** Booking flow spec 3.3 step 7 "Send request", for a verified number only. */
export async function bookForNumber(slug: string, input: unknown): Promise<numbers.BookOutcome> {
  return numbers.bookForNumber(String(slug), input, await device(new Date()));
}

/** Spec 3.4 step 4 "Send changes", for a verified number's own appointment only. */
export async function changeForNumber(slug: string, input: unknown): Promise<numbers.ChangeOutcome> {
  return numbers.changeForNumber(String(slug), input, await device(new Date()));
}

/** Spec 3.5 step 3 "Yes, cancel it", for a verified number's own appointment only. */
export async function cancelForNumber(slug: string, mobile: string, appointmentId: string): Promise<numbers.CancelOutcome> {
  return numbers.cancelForNumber(String(slug), mobile, appointmentId, await device(new Date()));
}
