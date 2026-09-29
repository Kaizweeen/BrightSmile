import { describe, expect, it } from "vitest";
import { actionText } from "@/lib/access-log";

describe("the access log in words", () => {
  it("says what happened, with the part viewed, the fields changed, or the username tried", () => {
    expect(actionText({ action: "patient.view", details: { part: "chart" } })).toBe("Viewed the record (chart)");
    expect(actionText({ action: "patient.updated", details: { fields: ["mobile", "email"] } })).toBe("Changed the patient's details: mobile, email");
    expect(actionText({ action: "auth.sign_in_failed", details: { username: "ana.s", ip: null } })).toBe("Failed to sign in as ana.s");
    expect(actionText({ action: "chart.added", details: { entryId: "x" } })).toBe("Charted a tooth");
    expect(actionText({ action: "something.new", details: {} })).toBe("something.new");
  });
});
