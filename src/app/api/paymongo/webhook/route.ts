import { recordPayment } from "@/lib/billing-data";
import { logError } from "@/lib/log";
import { PAID_EVENT, paymongoKeys, readWebhookEvent, verifySignature } from "@/lib/paymongo";

/**
 * Billing spec 7.3: PayMongo posts checkout_session.payment.paid here. 401 for a bad signature. 200 for a payment
 * recorded now or already, and for any other event. 500 when the database fails, so PayMongo retries, which
 * record_payment makes safe.
 */
export async function POST(request: Request) {
  const raw = await request.text();
  const event = readWebhookEvent(raw);
  const secret = paymongoKeys()?.webhookSecret;
  if (!verifySignature(request.headers.get("paymongo-signature"), raw, secret, event.livemode, new Date())) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }
  if (event.type !== PAID_EVENT) return Response.json({ status: "ignored" });
  if (!event.paid) {
    logError("paymongo webhook", "a paid checkout could not be read; check PayMongo and record it at /admin");
    return Response.json({ status: "ignored" });
  }
  try {
    const { status } = await recordPayment({ ...event.paid, method: "paymongo", reference: event.paid.sessionId, recordedBy: null });
    return Response.json({ status });
  } catch (e) {
    logError("paymongo webhook", e);
    return Response.json({ error: "Not recorded" }, { status: 500 });
  }
}
