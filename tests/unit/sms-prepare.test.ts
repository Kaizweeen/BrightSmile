import { describe, expect, it } from "vitest";
import { prepareSms, productionModeError, readSemaphoreReply, smsMode } from "@/lib/sms/prepare";

const otp = { clinic: "Bright Dental", code: "123456" };

describe("smsMode", () => {
  it("sends only when told to exactly", () => {
    expect(smsMode("live")).toBe("live");
    expect(smsMode("log")).toBe("log");
    expect(smsMode(undefined)).toBe("log");
    expect(smsMode("LIVE")).toBe("log");
  });
});

describe("productionModeError", () => {
  it("refuses a non-live mode in production", () => {
    expect(productionModeError("production", "log")).toBe("SMS_MODE is not live in production");
  });

  it("allows live mode in production", () => {
    expect(productionModeError("production", "live")).toBeNull();
  });

  it("allows log mode outside production", () => {
    expect(productionModeError("preview", "log")).toBeNull();
    expect(productionModeError(undefined, "log")).toBeNull();
  });
});

describe("prepareSms", () => {
  it("stores the real code in log mode so tests can read it", () => {
    expect(prepareSms("otp", otp, "log")).toEqual({
      message: "Your code for Bright Dental is {otp}. It expires in 5 minutes. Don't share it with anyone.",
      stored: "Your code for Bright Dental is 123456. It expires in 5 minutes. Don't share it with anyone.",
      code: "123456",
      credits: 2,
    });
  });

  it("masks the code in live mode (spec 10.6)", () => {
    const sms = prepareSms("otp", otp, "live");
    expect(sms.stored).toBe("Your code for Bright Dental is ******. It expires in 5 minutes. Don't share it with anyone.");
    expect(sms.stored).not.toContain("123456");
    expect(sms.message).toContain("{otp}");
    expect(sms.code).toBe("123456");
  });

  it("sends and stores other texts as rendered", () => {
    const vars = { first: "Ana", lastInitial: "C", date: "Thu Sep 24", time: "10:00 AM" };
    expect(prepareSms("patient_cancel_alert", vars, "live")).toEqual({
      message: "Cancelled: Ana C., Thu Sep 24, 10:00 AM.",
      stored: "Cancelled: Ana C., Thu Sep 24, 10:00 AM.",
      code: null,
      credits: 1,
    });
  });
});

describe("readSemaphoreReply", () => {
  it("takes the message id from a success", () => {
    expect(readSemaphoreReply(200, [{ message_id: 4242, status: "Pending" }])).toEqual({ ok: true, id: "4242" });
  });

  it("reports validation errors", () => {
    expect(readSemaphoreReply(200, { number: ["The number format is invalid."] })).toEqual({
      ok: false,
      error: 'Semaphore 200: {"number":["The number format is invalid."]}',
    });
  });

  it("reports server errors and empty replies", () => {
    expect(readSemaphoreReply(500, "Server Error")).toEqual({ ok: false, error: "Semaphore 500: Server Error" });
    expect(readSemaphoreReply(200, [])).toEqual({ ok: false, error: "Semaphore 200: []" });
  });

  it("keeps errors to 300 characters", () => {
    const reply = readSemaphoreReply(500, "x".repeat(1000));
    expect(reply.ok === false && reply.error.length).toBe(300);
  });
});
