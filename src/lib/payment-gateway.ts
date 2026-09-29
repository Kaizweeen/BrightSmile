import { createHmac, timingSafeEqual } from "crypto";
// PayMongo QR Ph. Verify endpoints/payload shapes against current PayMongo docs before going live.
const BASE = "https://api.paymongo.com/v1";
const auth = () => "Basic " + Buffer.from(`${process.env.PAYMONGO_SECRET_KEY}:`).toString("base64");

async function pm(path: string, attributes: object) {
  const r = await fetch(BASE + path, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: auth() },
    body: JSON.stringify({ data: { attributes } }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.errors?.[0]?.detail ?? "Payment gateway error");
  return j.data;
}

export const gatewayEnabled = () => !!process.env.PAYMONGO_SECRET_KEY;

export async function createQrSession(amount: number, invoiceId: string) {
  const intent = await pm("/payment_intents", {
    amount, currency: "PHP", payment_method_allowed: ["qrph"], metadata: { invoiceId },
  });
  const method = await pm("/payment_methods", { type: "qrph" });
  const attached = await pm(`/payment_intents/${intent.id}/attach`, {
    payment_method: method.id, client_key: intent.attributes.client_key,
  });
  return { sessionId: intent.id as string, imageUrl: attached.attributes.next_action?.code?.image_url as string | undefined };
}

export function verifyWebhook(raw: string, header: string | null) {
  if (!header || !process.env.PAYMONGO_WEBHOOK_SECRET) return false;
  const p = Object.fromEntries(header.split(",").map((x) => x.split("=") as [string, string]));
  const expected = createHmac("sha256", process.env.PAYMONGO_WEBHOOK_SECRET).update(`${p.t}.${raw}`).digest("hex");
  const got = p.li || p.te || "";
  return got.length === expected.length && timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}
