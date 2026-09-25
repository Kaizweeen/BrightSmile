import { createHmac } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/paymongo/webhook/route";
import { recordPayment } from "@/lib/billing-data";

// The database side (record_payment, and that a repeated session records once) is proven in tests/sql/billing.test.ts.
vi.mock("@/lib/billing-data", () => ({ recordPayment: vi.fn() }));

const SECRET = "whsk_test_4b2f1c9e8d7a";
const CLINIC = "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const saved = { key: process.env.PAYMONGO_SECRET_KEY, secret: process.env.PAYMONGO_WEBHOOK_SECRET, vercel: process.env.VERCEL_ENV };
const record = vi.mocked(recordPayment);

function event(type = "checkout_session.payment.paid", session: unknown = {
  id: "cs_test_4Nd9k2",
  attributes: { metadata: { clinic_id: CLINIC, months: "3" }, payments: [{ attributes: { amount: 389_700, status: "paid" } }] },
}, live = false) {
  return JSON.stringify({ data: { id: "evt_1", attributes: { type, livemode: live, data: session } } });
}

/** What PayMongo sends: the HMAC in li for live events, in te for test events. */
function signature(body: string, { secret = SECRET, live = false } = {}) {
  const t = Math.floor(Date.now() / 1000);
  const hex = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return live ? `t=${t},te=,li=${hex}` : `t=${t},te=${hex},li=`;
}

function post(body: string, header = signature(body)) {
  return POST(new Request("http://localhost/api/paymongo/webhook", { method: "POST", body, headers: { "Paymongo-Signature": header } }));
}

beforeEach(() => {
  process.env.PAYMONGO_SECRET_KEY = "sk_test_abc";
  process.env.PAYMONGO_WEBHOOK_SECRET = SECRET;
  delete process.env.VERCEL_ENV;
  record.mockReset();
  vi.restoreAllMocks();
});

afterAll(() => {
  for (const [name, value] of [["PAYMONGO_SECRET_KEY", saved.key], ["PAYMONGO_WEBHOOK_SECRET", saved.secret], ["VERCEL_ENV", saved.vercel]] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("POST /api/paymongo/webhook", () => {
  it("refuses a missing or wrong signature before touching the database, logging nothing from the request", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const unsigned = await POST(new Request("http://localhost/api/paymongo/webhook", { method: "POST", body: event() }));
    expect(unsigned.status).toBe(401);
    const wrong = signature(event(), { secret: "whsk_wrong" });
    expect((await post(event(), wrong)).status).toBe(401);
    delete process.env.PAYMONGO_WEBHOOK_SECRET;
    expect((await post(event())).status).toBe(401);
    expect(record).not.toHaveBeenCalled();
    expect(logged).toHaveBeenCalledTimes(3);
    const lines = JSON.stringify(logged.mock.calls);
    for (const part of [wrong.slice(wrong.indexOf("te=") + 3, wrong.indexOf(",li")), "evt_1", "cs_test_4Nd9k2", CLINIC, SECRET]) {
      expect(lines).not.toContain(part);
    }
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

  it("answers 200 for a clinic that no longer exists, and logs the session to refund", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    record.mockRejectedValue({ code: "P0002", message: "clinic not found" });
    const res = await post(event());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ignored" });
    expect(logged).toHaveBeenCalledTimes(1);
    expect(logged.mock.calls[0][1]).toContain("paid checkout for a clinic that no longer exists; refund it in PayMongo");
    expect(logged.mock.calls[0][1]).toContain("cs_test_4Nd9k2");
  });

  it("ignores other events, and logs paid events it cannot read with their event and session ids", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const body of [event("payment.failed"), event("checkout_session.payment.paid", { id: "cs_x", attributes: {} })]) {
      const res = await post(body);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: "ignored" });
    }
    expect(record).not.toHaveBeenCalled();
    expect(logged).toHaveBeenCalledTimes(1);
    expect(logged.mock.calls[0][1]).toMatch(/could not be read.*evt_1.*cs_x/);
  });

  it("ignores test events in production, so test payments never extend real plans", async () => {
    process.env.VERCEL_ENV = "production";
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await post(event());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ignored" });
    expect(record).not.toHaveBeenCalled();
    expect(logged).toHaveBeenCalledTimes(1);

    const live = event(undefined, undefined, true);
    expect((await post(live, signature(live))).status).toBe(401);
    record.mockResolvedValue({ status: "ok", paidThrough: "2027-01-09T02:00:00+00:00" });
    expect(await (await post(live, signature(live, { live: true }))).json()).toEqual({ status: "ok" });
  });
});
