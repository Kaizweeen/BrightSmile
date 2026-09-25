import { createHmac } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/paymongo/webhook/route";
import { recordPayment } from "@/lib/billing-data";

// The database side (record_payment, and that a repeated session records once) is proven in tests/sql/billing.test.ts.
vi.mock("@/lib/billing-data", () => ({ recordPayment: vi.fn() }));

const SECRET = "whsk_test_4b2f1c9e8d7a";
const CLINIC = "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const saved = { key: process.env.PAYMONGO_SECRET_KEY, secret: process.env.PAYMONGO_WEBHOOK_SECRET };
const record = vi.mocked(recordPayment);

function event(type = "checkout_session.payment.paid", session: unknown = {
  id: "cs_test_4Nd9k2",
  attributes: { metadata: { clinic_id: CLINIC, months: "3" }, payments: [{ attributes: { amount: 389_700 } }] },
}) {
  return JSON.stringify({ data: { id: "evt_1", attributes: { type, livemode: false, data: session } } });
}

function post(body: string, secret = SECRET) {
  const t = Math.floor(Date.now() / 1000);
  const hex = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return POST(new Request("http://localhost/api/paymongo/webhook", { method: "POST", body, headers: { "Paymongo-Signature": `t=${t},te=${hex},li=` } }));
}

beforeEach(() => {
  process.env.PAYMONGO_SECRET_KEY = "sk_test_abc";
  process.env.PAYMONGO_WEBHOOK_SECRET = SECRET;
  record.mockReset();
  vi.restoreAllMocks();
});

afterAll(() => {
  for (const [name, value] of [["PAYMONGO_SECRET_KEY", saved.key], ["PAYMONGO_WEBHOOK_SECRET", saved.secret]] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("POST /api/paymongo/webhook", () => {
  it("refuses a missing or wrong signature before touching the database", async () => {
    const unsigned = await POST(new Request("http://localhost/api/paymongo/webhook", { method: "POST", body: event() }));
    expect(unsigned.status).toBe(401);
    expect((await post(event(), "whsk_wrong")).status).toBe(401);
    delete process.env.PAYMONGO_WEBHOOK_SECRET;
    expect((await post(event())).status).toBe(401);
    expect(record).not.toHaveBeenCalled();
  });

  it("records a paid checkout as a PayMongo payment", async () => {
    record.mockResolvedValue({ status: "ok", paidThrough: "2027-01-09T02:00:00+00:00" });
    const res = await post(event());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
    expect(record).toHaveBeenCalledWith({
      clinicId: CLINIC,
      method: "paymongo",
      amountCentavos: 389_700,
      months: 3,
      reference: "cs_test_4Nd9k2",
      sessionId: "cs_test_4Nd9k2",
      recordedBy: null,
    });
  });

  it("answers 200 to a repeated delivery", async () => {
    record.mockResolvedValue({ status: "duplicate", paidThrough: "2027-01-09T02:00:00+00:00" });
    const res = await post(event());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "duplicate" });
  });

  it("answers 500 when the database fails, so PayMongo retries", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    record.mockRejectedValue(new Error("connection reset"));
    expect((await post(event())).status).toBe(500);
  });

  it("ignores other events and paid events it cannot read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const body of [event("payment.failed"), event("checkout_session.payment.paid", { id: "cs_x", attributes: {} })]) {
      const res = await post(body);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: "ignored" });
    }
    expect(record).not.toHaveBeenCalled();
  });
});
