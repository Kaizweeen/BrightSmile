import "server-only";
import * as webpush from "web-push";
import { logError } from "@/lib/log";
import type { Saved } from "@/lib/staff-input";
import { adminClient } from "@/lib/supabase/admin";
import type { Staff } from "@/lib/supabase/server";
import { formatDate, formatTime } from "@/lib/time";

export type AlertKind = "request_alert" | "patient_cancel_alert";
export type PushPayload = { title: string; body: string; url: string };
export type StoredSubscription = { endpoint: string; p256dh: string; auth: string };
export type PushSend = (sub: StoredSubscription, body: string) => Promise<unknown>;

/** Spec 10.4: date, time, and dentist only, never a patient's name. Tapping opens the requests page. */
export function pushPayload(kind: AlertKind, startsAt: Date, dentist: string | null): PushPayload {
  const when = `${formatDate(startsAt)}, ${formatTime(startsAt)}${dentist ? ` with ${dentist}` : ""}`;
  return { title: kind === "request_alert" ? "New booking request" : "Request cancelled", body: when, url: "/app/requests" };
}

/** Billing spec 7.4: the plan heads-up. Like every push, a tap opens the requests page, where the banner links to Billing. */
export function planPushPayload(endsAt: Date): PushPayload {
  return { title: `Your BrightSmile plan ends ${formatDate(endsAt)}`, body: "Pay in BrightSmile to keep online booking open.", url: "/app/requests" };
}

// The push services of Chrome and Android (FCM), Firefox, Safari and iOS, and Edge on Windows.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /\.notify\.windows\.com$/];
const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;

/**
 * A browser's PushSubscription (as JSON) reduced to what we store, or null. Only https endpoints on a known
 * push service pass, so sendPush can never be pointed at an arbitrary host. p256dh is a 65 byte key (87
 * base64url characters) and auth is 16 bytes (22 characters), padding allowed.
 */
export function parseSubscription(input: unknown): StoredSubscription | null {
  if (typeof input !== "object" || input === null) return null;
  const { endpoint, keys } = input as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } | null };
  if (typeof endpoint !== "string" || endpoint.length > 1000) return null;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.port !== "" || url.username !== "" || url.password !== "") return null;
  if (!PUSH_HOSTS.some((host) => host.test(url.hostname))) return null;
  const p256dh = keys?.p256dh;
  const auth = keys?.auth;
  if (typeof p256dh !== "string" || !BASE64URL.test(p256dh) || p256dh.length < 86 || p256dh.length > 88) return null;
  if (typeof auth !== "string" || !BASE64URL.test(auth) || auth.length < 22 || auth.length > 24) return null;
  return { endpoint, p256dh, auth };
}

/** web-push with the VAPID keys, or null when they are not all set (every alert then falls back to a text). */
export function vapidSender(env: Record<string, string | undefined> = process.env): PushSend | null {
  const publicKey = env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = env.VAPID_PRIVATE_KEY;
  const subject = env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return null;
  return (sub, body) =>
    webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, body, {
      vapidDetails: { subject, publicKey, privateKey },
      TTL: 60 * 60,
      urgency: "high",
      timeout: 10_000,
    });
}

/** 404 and 410 mean the browser dropped the subscription (spec 10.4): delete it. */
function gone(e: unknown): boolean {
  const code = (e as { statusCode?: unknown } | null)?.statusCode;
  return code === 404 || code === 410;
}

/**
 * Sends a push to every subscription of the clinic and returns how many push services accepted it.
 * Uses the secret-key client because a patient's booking triggers it. Never throws (spec 13).
 */
export async function sendPush(clinicId: string, payload: PushPayload, send: PushSend | null = vapidSender()): Promise<number> {
  if (!send) return 0;
  try {
    const db = adminClient();
    const { data, error } = await db.from("push_subscriptions").select("endpoint, p256dh, auth").eq("clinic_id", clinicId);
    if (error) throw error;
    const subs = (data ?? []) as StoredSubscription[];
    const body = JSON.stringify(payload);
    const results = await Promise.allSettled(subs.map((sub) => send(sub, body)));
    const dropped: string[] = [];
    results.forEach((r, i) => {
      if (r.status === "fulfilled") return;
      if (gone(r.reason)) dropped.push(subs[i].endpoint);
      else logError("sendPush", r.reason);
    });
    if (dropped.length > 0) {
      const { error: deleteError } = await db.from("push_subscriptions").delete().in("endpoint", dropped);
      if (deleteError) logError("sendPush cleanup", deleteError);
    }
    return results.filter((r) => r.status === "fulfilled").length;
  } catch (e) {
    logError("sendPush", e);
    return 0;
  }
}

const FAILED = "Something went wrong. Please try again.";

/**
 * Stores this device's subscription for the signed-in staff member, through their RLS client. The same
 * endpoint again (the browser re-subscribed) updates the keys in place.
 * ponytail: an endpoint already saved by another login on this browser fails RLS and shows FAILED; v1 has one login per clinic.
 */
export async function saveSubscription(staff: Staff, input: unknown): Promise<Saved> {
  const sub = parseSubscription(input);
  if (!sub) return { ok: false, error: "This browser gave an alert address BrightSmile can't use. Try Chrome or Safari." };
  const { error } = await staff.db
    .from("push_subscriptions")
    .upsert({ clinic_id: staff.clinicId, user_id: staff.userId, ...sub }, { onConflict: "endpoint" });
  if (error) {
    logError("saveSubscription", error);
    return { ok: false, error: FAILED };
  }
  return { ok: true };
}

/** Removes this device's subscription. RLS limits it to the staff member's own rows. */
export async function deleteSubscription(staff: Staff, endpoint: unknown): Promise<Saved> {
  if (typeof endpoint !== "string" || endpoint === "" || endpoint.length > 1000) return { ok: false, error: FAILED };
  const { error } = await staff.db.from("push_subscriptions").delete().eq("endpoint", endpoint).eq("user_id", staff.userId);
  if (error) {
    logError("deleteSubscription", error);
    return { ok: false, error: FAILED };
  }
  return { ok: true };
}
