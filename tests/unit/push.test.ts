import { afterEach, describe, expect, it } from "vitest";
import { parseSubscription, planPushPayload, pushPayload, sendPush, vapidSender } from "@/lib/push";
import { manilaInstant } from "@/lib/time";

const start = manilaInstant("2026-09-24", 600);
const keys = { p256dh: `B${"A".repeat(86)}`, auth: "A".repeat(22) };

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

describe("planPushPayload", () => {
  it("says when the plan ends and opens the requests page", () => {
    expect(planPushPayload(manilaInstant("2026-10-09", 600))).toEqual({
      title: "Your BrightSmile plan ends Fri Oct 9",
      body: "Pay in BrightSmile to keep online booking open.",
      url: "/app/requests",
    });
  });
});

describe("parseSubscription", () => {
  it("accepts the push services browsers use", () => {
    for (const endpoint of [
      "https://fcm.googleapis.com/fcm/send/abc:def",
      "https://updates.push.services.mozilla.com/wpush/v2/gAAAA",
      "https://web.push.apple.com/QGx7",
      "https://wns2-sg2p.notify.windows.com/w/?token=BQYAAA",
    ]) {
      expect(parseSubscription({ endpoint, keys, expirationTime: null })).toEqual({ endpoint, ...keys });
    }
  });

  it("refuses endpoints that are not a known push service over https", () => {
    for (const endpoint of [
      "http://fcm.googleapis.com/fcm/send/abc",
      "https://fcm.googleapis.com:8443/fcm/send/abc",
      "https://user:pw@fcm.googleapis.com/fcm/send/abc",
      "https://evil.example/fcm.googleapis.com",
      "https://fcm.googleapis.com.evil.example/x",
      "https://notify.windows.com.evil.example/x",
      "not a url",
      `https://fcm.googleapis.com/${"a".repeat(1000)}`,
    ]) {
      expect(parseSubscription({ endpoint, keys })).toBeNull();
    }
  });

  it("refuses missing or malformed keys", () => {
    const endpoint = "https://fcm.googleapis.com/fcm/send/abc";
    expect(parseSubscription({ endpoint })).toBeNull();
    expect(parseSubscription({ endpoint, keys: { ...keys, auth: "short" } })).toBeNull();
    expect(parseSubscription({ endpoint, keys: { ...keys, p256dh: "has spaces and is not base64url at all, sorry" } })).toBeNull();
    expect(parseSubscription(null)).toBeNull();
    expect(parseSubscription("https://fcm.googleapis.com/fcm/send/abc")).toBeNull();
  });
});

describe("vapidSender and sendPush without keys", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("has no sender until all three VAPID values are set", () => {
    expect(vapidSender({})).toBeNull();
    expect(vapidSender({ NEXT_PUBLIC_VAPID_PUBLIC_KEY: "p", VAPID_PRIVATE_KEY: "k" })).toBeNull();
    expect(vapidSender({ NEXT_PUBLIC_VAPID_PUBLIC_KEY: "p", VAPID_PRIVATE_KEY: "k", VAPID_SUBJECT: "mailto:a@b.c" })).toBeTypeOf("function");
  });

  it("delivers to nobody without VAPID keys, so the alert falls back to a text", async () => {
    delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    expect(await sendPush("any-clinic", pushPayload("request_alert", start, null))).toBe(0);
  });
});
