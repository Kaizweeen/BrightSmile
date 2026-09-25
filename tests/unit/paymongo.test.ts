import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkoutRequest, createCheckout, paymongoKeys, readWebhookEvent, verifySignature } from "@/lib/paymongo";

const SECRET = "whsk_test_4b2f1c9e8d7a";
const CLINIC = "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const NOW = new Date("2026-09-25T02:00:00Z");
const T = Math.floor(NOW.getTime() / 1000);
const input = { clinicId: CLINIC, slug: "bright-dental", tier: "Team", months: 3, amountCentavos: 389_700, appUrl: "https://brightsmile.ph" };

/** What PayMongo sends: te for test events, li for live events. */
function signature(body: string, { live = false, t = T, secret = SECRET } = {}) {
  const hex = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return live ? `t=${t},te=,li=${hex}` : `t=${t},te=${hex},li=`;
}

function paidEvent({ live = false, metadata = { clinic_id: CLINIC, months: "3" } as Record<string, unknown>, payments = [{ attributes: { amount: 389_700 } }] as unknown[] } = {}) {
  return JSON.stringify({
    data: {
      id: "evt_9aZ",
      type: "event",
      attributes: {
        type: "checkout_session.payment.paid",
        livemode: live,
        data: { id: "cs_test_4Nd9k2", type: "checkout_session", attributes: { metadata, reference_number: "bright-dental", payments } },
      },
    },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("paymongoKeys", () => {
  it("needs both keys", () => {
    expect(paymongoKeys({ PAYMONGO_SECRET_KEY: "sk_test_a", PAYMONGO_WEBHOOK_SECRET: " whsk_b " })).toEqual({ secretKey: "sk_test_a", webhookSecret: "whsk_b" });
    expect(paymongoKeys({ PAYMONGO_SECRET_KEY: "sk_test_a" })).toBeNull();
    expect(paymongoKeys({ PAYMONGO_SECRET_KEY: " ", PAYMONGO_WEBHOOK_SECRET: "whsk_b" })).toBeNull();
    expect(paymongoKeys({})).toBeNull();
  });
});

describe("checkoutRequest", () => {
  it("posts one line item with the amount computed on our server, with basic auth", () => {
    const { url, init } = checkoutRequest(input, "sk_test_abc");
    expect(url).toBe("https://api.paymongo.com/v1/checkout_sessions");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("sk_test_abc:").toString("base64")}`);
    expect(JSON.parse(init.body as string)).toEqual({
      data: {
        attributes: {
          line_items: [{ name: "BrightSmile Team plan, 3 months", amount: 389_700, currency: "PHP", quantity: 1 }],
          payment_method_types: ["gcash", "paymaya", "card"],
          success_url: "https://brightsmile.ph/app/billing?paid=1",
          cancel_url: "https://brightsmile.ph/app/billing",
          description: "BrightSmile Team plan for bright-dental, 3 months",
          reference_number: "bright-dental",
          metadata: { clinic_id: CLINIC, months: "3" },
          send_email_receipt: true,
        },
      },
    });
    expect(JSON.parse(checkoutRequest({ ...input, months: 1 }, "k").init.body as string).data.attributes.line_items[0].name).toBe("BrightSmile Team plan, 1 month");
  });
});

describe("createCheckout", () => {
  it("returns PayMongo's checkout_url", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ data: { id: "cs_1", attributes: { checkout_url: "https://checkout.paymongo.com/cs_1" } } }));
    expect(await createCheckout(input, "sk_test_abc")).toBe("https://checkout.paymongo.com/cs_1");
    expect(fetchSpy.mock.calls[0][0]).toBe("https://api.paymongo.com/v1/checkout_sessions");
  });

  it("gives null for a refusal or a network error, and never logs the key", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ errors: [{ detail: "Unauthorized" }] }, { status: 401 }));
    expect(await createCheckout(input, "sk_test_abc")).toBeNull();
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("socket hang up"));
    expect(await createCheckout(input, "sk_test_abc")).toBeNull();
    expect(JSON.stringify(logged.mock.calls)).not.toContain("sk_test_abc");
    expect(logged).toHaveBeenCalledWith("createCheckout failed:", "PayMongo answered 401");
  });
});

describe("verifySignature", () => {
  const body = paidEvent();

  it("accepts a valid test signature (te) and a valid live signature (li)", () => {
    expect(verifySignature(signature(body), body, SECRET, false, NOW)).toBe(true);
    const live = paidEvent({ live: true });
    expect(verifySignature(signature(live, { live: true }), live, SECRET, true, NOW)).toBe(true);
  });

  it("checks the field that matches the event's mode", () => {
    expect(verifySignature(signature(body), body, SECRET, true, NOW)).toBe(false);
    expect(verifySignature(signature(body, { live: true }), body, SECRET, false, NOW)).toBe(false);
  });

  it("refuses a wrong secret, an altered body, or a missing secret", () => {
    expect(verifySignature(signature(body, { secret: "whsk_other" }), body, SECRET, false, NOW)).toBe(false);
    expect(verifySignature(signature(body), body.replace("389700", "1"), SECRET, false, NOW)).toBe(false);
    expect(verifySignature(signature(body), body, undefined, false, NOW)).toBe(false);
    expect(verifySignature(signature(body), body, "", false, NOW)).toBe(false);
  });

  it("refuses a timestamp more than 5 minutes away, either way", () => {
    expect(verifySignature(signature(body, { t: T - 300 }), body, SECRET, false, NOW)).toBe(true);
    expect(verifySignature(signature(body, { t: T - 301 }), body, SECRET, false, NOW)).toBe(false);
    expect(verifySignature(signature(body, { t: T + 301 }), body, SECRET, false, NOW)).toBe(false);
  });

  it("refuses a malformed header", () => {
    const hex = createHmac("sha256", SECRET).update(`${T}.${body}`).digest("hex");
    for (const header of [null, "", "garbage", `te=${hex}`, `t=${T}`, `t=abc,te=${hex}`, `t=${T},te=${hex.slice(0, 63)}`, `t=${T},te=${hex}zz`, `t=${T},te=${"g".repeat(64)}`]) {
      expect(verifySignature(header, body, SECRET, false, NOW)).toBe(false);
    }
  });
});

describe("readWebhookEvent", () => {
  it("reads a paid checkout: our session id, clinic, months, and the amount paid", () => {
    expect(readWebhookEvent(paidEvent())).toEqual({
      livemode: false,
      type: "checkout_session.payment.paid",
      paid: { sessionId: "cs_test_4Nd9k2", clinicId: CLINIC, months: 3, amountCentavos: 389_700 },
    });
    expect(readWebhookEvent(paidEvent({ live: true })).livemode).toBe(true);
    const split = paidEvent({ payments: [{ attributes: { amount: 200_000 } }, { attributes: { amount: 189_700 } }] });
    expect(readWebhookEvent(split).paid?.amountCentavos).toBe(389_700);
  });

  it("reads other events without a payment", () => {
    const other = JSON.stringify({ data: { attributes: { type: "payment.failed", livemode: true, data: {} } } });
    expect(readWebhookEvent(other)).toEqual({ livemode: true, type: "payment.failed", paid: null });
    expect(readWebhookEvent("not json")).toEqual({ livemode: false, type: null, paid: null });
    expect(readWebhookEvent("[]")).toEqual({ livemode: false, type: null, paid: null });
  });

  it("leaves paid empty when any field it needs is missing or wrong", () => {
    for (const body of [
      paidEvent({ metadata: {} }),
      paidEvent({ metadata: { clinic_id: "not-a-uuid", months: "3" } }),
      paidEvent({ metadata: { clinic_id: CLINIC, months: "13" } }),
      paidEvent({ metadata: { clinic_id: CLINIC, months: "0" } }),
      paidEvent({ payments: [] }),
      paidEvent({ payments: [{ attributes: { amount: "389700" } }] }),
      paidEvent({ payments: [{ attributes: { amount: 0 } }] }),
      paidEvent({ payments: [{ attributes: {} }] }),
      paidEvent({ payments: [null] }),
      paidEvent().replace('"cs_test_4Nd9k2"', '"cs test; drop"'),
    ]) {
      expect(readWebhookEvent(body).paid).toBeNull();
    }
  });
});
