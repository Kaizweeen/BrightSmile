"use server";

import { cookies, headers } from "next/headers";
import { dayOpenStarts, loadClinic, monthOpenDates } from "@/lib/availability";
import * as booking from "@/lib/booking";
import { resolveSelection } from "@/lib/booking-input";
import { DEVICE_COOKIE, readDevice, signDevice } from "@/lib/codes";
import { clientIp } from "@/lib/request";

// Server Actions are public POST endpoints: every argument is checked here before use.
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const DEVICE_MAX_AGE = 180 * 86_400;

async function chosen(slug: unknown, selection: unknown) {
  const clinic = typeof slug === "string" ? await loadClinic({ slug }) : null;
  const picked = clinic ? resolveSelection(clinic, selection) : null;
  return clinic && picked ? { clinic, picked } : null;
}

/** Enabled days of a month: dates only, never busy times (spec 6). */
export async function getOpenDates(slug: string, selection: unknown, month: string): Promise<string[]> {
  if (typeof month !== "string" || !MONTH.test(month)) return [];
  const found = await chosen(slug, selection);
  if (!found) return [];
  return monthOpenDates(found.clinic, found.picked.dentist, found.picked.duration, month, new Date());
}

/** Open start times of one day as ISO instants. */
export async function getOpenStarts(slug: string, selection: unknown, date: string): Promise<string[]> {
  if (typeof date !== "string" || !DATE.test(date)) return [];
  const found = await chosen(slug, selection);
  if (!found) return [];
  const starts = await dayOpenStarts(found.clinic, found.picked.dentist, found.picked.duration, date, new Date());
  return starts.map((s) => s.toISOString());
}

export async function requestBooking(slug: string, input: unknown): Promise<booking.BookingOutcome> {
  const now = new Date();
  const store = await cookies();
  const ip = clientIp((await headers()).get("x-forwarded-for"));
  const verifiedMobiles = readDevice(store.get(DEVICE_COOKIE)?.value, now);
  return booking.requestBooking(String(slug), input, { ip, now, verifiedMobiles });
}

export async function verifyBookingCode(requestId: string, code: string): Promise<booking.VerifyOutcome> {
  const now = new Date();
  const { outcome, verifiedMobile } = await booking.verifyCode(String(requestId), String(code), now);
  if (verifiedMobile) {
    // Spec 10.3: remember up to 5 verified mobiles on this device for 180 days.
    const store = await cookies();
    const known = readDevice(store.get(DEVICE_COOKIE)?.value, now).filter((m) => m !== verifiedMobile);
    store.set(DEVICE_COOKIE, signDevice([...known, verifiedMobile], now), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: DEVICE_MAX_AGE,
    });
  }
  return outcome;
}

export async function resendBookingCode(requestId: string): Promise<booking.ResendOutcome> {
  const ip = clientIp((await headers()).get("x-forwarded-for"));
  return booking.resendCode(String(requestId), { ip, now: new Date() });
}
