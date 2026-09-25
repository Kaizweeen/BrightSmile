import { recordPayment } from "@/lib/billing-data";
import { logError } from "@/lib/log";
import { PAID_EVENT, paymongoKeys, readWebhookEvent, verifySignature } from "@/lib/paymongo";

/**
 * Billing spec 7.3: PayMongo posts checkout_session.payment.paid here. 401 for a bad signature. 200 for a payment
 * recorded now or already, for any other event, for a test event in production (test payments never extend real
 * plans), and for a clinic that no longer exists (logged, to refund). 500 when the database fails, so PayMongo
 * retries, which record_payment makes safe.
 */
export async function POST(request: Request) {
  const raw = await request.text();
  const event = readWebhookEvent(raw);
  const secret = paymongoKeys()?.webhookSecret;
  if (!verifySignature(request.headers.get("paymongo-signature"), raw, secret, event.livemode, new Date())) {
    // Nothing from the request goes in the log: it is unverified.
    logError("paymongo webhook", "refused a signature that did not verify with PAYMONGO_WEBHOOK_SECRET");
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }
  if (!event.livemode && process.env.VERCEL_ENV === "production") {
    logError("paymongo webhook", `ignored test event ${event.eventId ?? "unknown"} in production`);
    return Response.json({ status: "ignored" });
  }
  if (event.type !== PAID_EVENT) return Response.json({ status: "ignored" });
  if (!event.paid) {
    logError(
      "paymongo webhook",
      `a paid checkout could not be read (event ${event.eventId ?? "unknown"}, checkout session ${event.sessionId ?? "unknown"}); check PayMongo and record it at /admin`,
    );
    return Response.json({ status: "ignored" });
  }
  try {
    const { status } = await recordPayment({ ...event.paid, method: "paymongo", reference: event.paid.sessionId, recordedBy: null });
    return Response.json({ status });
  } catch (e) {
    // P0002: record_payment found no such clinic. A retry cannot help, so answer 200 and leave the refund to Kai.
    if ((e as { code?: unknown } | null)?.code === "P0002") {
      logError(
        "paymongo webhook",
        `paid checkout for a clinic that no longer exists; refund it in PayMongo (checkout session ${event.paid.sessionId})`,
      );
      return Response.json({ status: "ignored" });
    }
    logError("paymongo webhook", e);
    return Response.json({ error: "Not recorded" }, { status: 500 });
  }
}
