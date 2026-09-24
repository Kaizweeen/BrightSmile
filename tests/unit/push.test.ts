import { describe, expect, it } from "vitest";
import { pushPayload, sendPush } from "@/lib/push";
import { manilaInstant } from "@/lib/time";

const start = manilaInstant("2026-09-24", 600);

describe("pushPayload", () => {
  it("describes a new request by date, time, and dentist", () => {
    expect(pushPayload("request_alert", start, "Dr. Reyes")).toEqual({
      title: "New booking request",
      body: "Thu Sep 24, 10:00 AM with Dr. Reyes",
      url: "/app/requests",
    });
  });

  it("describes a cancellation without a dentist for one-dentist clinics", () => {
    expect(pushPayload("patient_cancel_alert", start, null)).toEqual({
      title: "Request cancelled",
      body: "Thu Sep 24, 10:00 AM",
      url: "/app/requests",
    });
  });

  it("has nowhere to put a patient's name (spec 10.4)", () => {
    expect(Object.keys(pushPayload("request_alert", start, null)).sort()).toEqual(["body", "title", "url"]);
  });
});

describe("sendPush", () => {
  it("delivers to nobody until Plan 4 adds web push, so alerts fall back to texts", async () => {
    expect(await sendPush("any-clinic", pushPayload("request_alert", start, null))).toBe(0);
  });
});
