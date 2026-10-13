import { describe, expect, it } from "vitest";
import { actionText, actorText } from "@/lib/access-log";

describe("the access log in words", () => {
  it("says what happened, with the part viewed, the fields changed, or the username tried", () => {
    expect(actionText({ action: "patient.view", details: { part: "chart" } })).toBe("Viewed the record (chart)");
    expect(actionText({ action: "patient.updated", details: { fields: ["mobile", "email"] } })).toBe("Changed the patient's details: mobile, email");
    expect(actionText({ action: "auth.sign_in_failed", details: { username: "ana.s", ip: null } })).toBe("Failed to sign in as ana.s");
    expect(actionText({ action: "chart.added", details: { entryId: "x" } })).toBe("Charted a tooth");
    expect(actionText({ action: "appointment.requested_online", details: { online: true } })).toBe("Booked a visit online");
    expect(actionText({ action: "something.new", details: {} })).toBe("something.new");
    expect(actionText({ action: "patient.form_received", details: { client: "x" } })).toBe("Sent a patient form");
    expect(actionText({ action: "patient.form_attached", details: { form: "x" } })).toBe("Added a patient form to the record");
    expect(actionText({ action: "patient.form_discarded", details: {} })).toBe("Discarded a patient form");
    expect(["bill.issued", "bill.voided", "day.closed", "practice.qr_changed"].map((action) => actionText({ action, details: {} }))).toEqual([
      "Issued a receipt",
      "Voided a receipt",
      "Closed a day",
      "Changed the clinic QR code",
    ]);
  });

  it("names who did it, or the public page when no one was signed in", () => {
    const row = { userId: null, userName: null, action: "patient.form_received", details: {} };
    expect(actorText({ ...row, userId: "u1", userName: "Ana Reyes" })).toBe("Ana Reyes");
    expect(actorText({ ...row, userId: "u1" })).toBe("A removed account");
    expect(actorText({ ...row, action: "appointment.requested_online", details: { online: true } })).toBe("Online booking");
    expect(actorText(row)).toBe("Patient form");
    expect(actorText({ ...row, action: "auth.sign_in_failed" })).toBe("No one signed in");
  });
});
