import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { parseMonths } from "@/lib/billing";
import { logError } from "@/lib/log";
import { isUuid } from "@/lib/validate";

const CHECKOUT_SESSIONS = "https://api.paymongo.com/v1/checkout_sessions";
/** The only place createCheckout sends a clinic. */
const CHECKOUT_ORIGIN = "https://checkout.paymongo.com";
/** The one event that records a payment (billing spec 7.3). */
export const PAID_EVENT = "checkout_session.payment.paid";
/**
 * A signature whose timestamp is further than this from now is refused: 3 days either way (spec 7.3). PayMongo
 * does not document whether its retries are signed again, and record_payment makes a replayed delivery harmless.
 */
export const SIGNATURE_TOLERANCE_S = 3 * 24 * 60 * 60;

export type PayMongoKeys = { secretKey: string; webhookSecret: string };

/** Both keys, or null while PayMongo is not set up (the Billing page then offers GCash only). */
export function paymongoKeys(env: Record<string, string | undefined> = process.env): PayMongoKeys | null {
  const secretKey = env.PAYMONGO_SECRET_KEY?.trim();
  const webhookSecret = env.PAYMONGO_WEBHOOK_SECRET?.trim();
  return secretKey && webhookSecret ? { secretKey, webhookSecret } : null;
}

export type CheckoutInput = { clinicId: string; slug: string; tier: string; months: number; amountCentavos: number; appUrl: string };

/** POST /v1/checkout_sessions for one prepayment (spec 7.3). Basic auth: the secret key as username, no password. */
export function checkoutRequest(input: CheckoutInput, secretKey: string): { url: string; init: RequestInit } {
  const months = `${input.months} ${input.months === 1 ? "month" : "months"}`;
  const body = {
    data: {
      attributes: {
        line_items: [{ name: `BrightSmile ${input.tier} plan, ${months}`, amount: input.amountCentavos, currency: "PHP", quantity: 1 }],
        payment_method_types: ["gcash", "paymaya", "card"],
        success_url: `${input.appUrl}/app/billing?paid=1`,
        cancel_url: `${input.appUrl}/app/billing`,
        description: `BrightSmile ${input.tier} plan for ${input.slug}, ${months}`,
        reference_number: input.slug,
        // PayMongo metadata values are strings. The webhook trusts these because only our server creates sessions.
        metadata: { clinic_id: input.clinicId, months: String(input.months) },
        send_email_receipt: true,
      },
    },
  };
  return {
    url: CHECKOUT_SESSIONS,
    init: {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    },
  };
}

/**
 * Creates the checkout session and returns its checkout_url, which must be on checkout.paymongo.com. Otherwise
 * null, after logging the status and PayMongo's error code: never the key, and never the error's detail, which
 * can echo what was sent. Never throws.
 */
export async function createCheckout(input: CheckoutInput, secretKey: string): Promise<string | null> {
  try {
    const { url, init } = checkoutRequest(input, secretKey);
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
    const body = (await res.json().catch(() => null)) as {
      data?: { attributes?: { checkout_url?: unknown } };
      errors?: { code?: unknown }[];
    } | null;
    const checkoutUrl = body?.data?.attributes?.checkout_url;
    if (res.ok && typeof checkoutUrl === "string" && URL.canParse(checkoutUrl) && new URL(checkoutUrl).origin === CHECKOUT_ORIGIN) {
      return checkoutUrl;
    }
    const code = body?.errors?.[0]?.code;
    const reason = typeof code === "string" && /^\w{1,64}$/.test(code) ? `, ${code}` : "";
    logError("createCheckout", res.ok ? `PayMongo gave no ${CHECKOUT_ORIGIN} checkout_url` : `PayMongo answered ${res.status}${reason}`);
    return null;
  } catch (e) {
    logError("createCheckout", e);
    return null;
  }
}

/**
 * The Paymongo-Signature header is "t=<unix seconds>,te=<hex>,li=<hex>": an HMAC-SHA256 of "{t}.{raw body}"
 * with the webhook secret, in li for live events and te for test events. Compared in constant time, and
 * refused when t is more than SIGNATURE_TOLERANCE_S (3 days) from now.
 */
export function verifySignature(header: string | null, rawBody: string, secret: string | undefined, livemode: boolean, now: Date): boolean {
  if (!header || !secret) return false;
  const fields = new Map<string, string>();
  for (const part of header.split(",")) {
    const at = part.indexOf("=");
    if (at > 0) fields.set(part.slice(0, at).trim(), part.slice(at + 1).trim());
  }
  const t = fields.get("t") ?? "";
  const sent = fields.get(livemode ? "li" : "te") ?? "";
  if (!/^\d{1,12}$/.test(t) || !/^[0-9a-f]{64}$/i.test(sent)) return false;
  if (Math.abs(now.getTime() / 1000 - Number(t)) > SIGNATURE_TOLERANCE_S) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest();
  return timingSafeEqual(expected, Buffer.from(sent, "hex"));
}

export type PaidCheckout = { sessionId: string; clinicId: string; months: number; amountCentavos: number };
/** eventId and sessionId are kept for logs (neither is a secret); paid is what gets recorded. */
export type WebhookEvent = { eventId: string | null; livemode: boolean; type: string | null; sessionId: string | null; paid: PaidCheckout | null };

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

/** A plain PayMongo id ("evt_...", "cs_..."), or null, so nothing odd reaches a log or the database. */
const plainId = (value: unknown): string | null => (typeof value === "string" && /^[A-Za-z0-9_]{1,100}$/.test(value) ? value : null);

/**
 * Reads a webhook body defensively, checking every field it uses: {data: {id, attributes: {type, livemode,
 * data: <checkout session>}}}. paid is set only for a paid checkout whose session carries our metadata and at
 * least one paid payment; any other shape leaves it null.
 */
export function readWebhookEvent(rawBody: string): WebhookEvent {
  let root: unknown = null;
  try {
    root = JSON.parse(rawBody);
  } catch {
    // Not JSON: nothing to read.
  }
  const data = record(record(root)?.data);
  const attributes = record(data?.attributes);
  const session = record(attributes?.data);
  const sessionId = plainId(session?.id);
  const livemode = attributes?.livemode === true;
  const type = typeof attributes?.type === "string" ? attributes.type : null;
  const none = { eventId: plainId(data?.id), livemode, type, sessionId, paid: null };
  if (type !== PAID_EVENT) return none;

  const details = record(session?.attributes);
  const metadata = record(details?.metadata);
  const clinicId = metadata?.clinic_id;
  const months = parseMonths(metadata?.months);
  if (!sessionId || !isUuid(clinicId) || months === null) return none;
  // PayMongo lists one payment per attempt, failed ones included: only the paid ones count.
  const payments = Array.isArray(details?.payments) ? details.payments : [];
  const amounts = payments.map((p) => record(record(p)?.attributes)).filter((a) => a?.status === "paid").map((a) => a?.amount);
  if (amounts.length === 0 || !amounts.every((a): a is number => Number.isInteger(a) && (a as number) > 0)) return none;
  return { ...none, paid: { sessionId, clinicId, months, amountCentavos: amounts.reduce((sum, a) => sum + a, 0) } };
}
