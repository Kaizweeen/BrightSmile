import { formatDate, formatTime } from "@/lib/time";

export type AlertKind = "request_alert" | "patient_cancel_alert";
export type PushPayload = { title: string; body: string; url: string };

/** Spec 10.4: date, time, and dentist only, never a patient's name. Tapping opens the requests page. */
export function pushPayload(kind: AlertKind, startsAt: Date, dentist: string | null): PushPayload {
  const when = `${formatDate(startsAt)}, ${formatTime(startsAt)}${dentist ? ` with ${dentist}` : ""}`;
  return { title: kind === "request_alert" ? "New booking request" : "Request cancelled", body: when, url: "/app/requests" };
}

/**
 * Sends a push to every subscription of the clinic's members and returns how many were delivered.
 * ponytail: always 0 until Plan 4 adds web-push and subscriptions, so every alert falls back to a text.
 */
export async function sendPush(clinicId: string, payload: PushPayload): Promise<number> {
  void clinicId;
  void payload;
  return 0;
}
