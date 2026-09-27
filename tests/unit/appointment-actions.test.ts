import { describe, expect, it } from "vitest";
import { rowText, type Row } from "@/lib/appointment-actions";

const row: Row = {
  id: "a1",
  status: "confirmed",
  starts_at: "2026-10-05T02:00:00.000Z",
  ends_at: "2026-10-05T02:30:00.000Z",
  dentist_id: "d1",
  manage_token: "AbCdEfGhIjKl",
  patient: { first_name: "Ana", mobile: "+639171112222", anonymized_at: null },
  dentist: { sms_name: "Dr. Reyes" },
  branch: { sms_name: "Makati" },
  clinic: { sms_name: "Bright Dental", slug: "bright-dental" },
};
const start = new Date(row.starts_at);

describe("rowText", () => {
  it("names the appointment's branch after the clinic once the clinic has 2 or more active branches", () => {
    expect(rowText(row, "confirmed", null, start, 1).clinicSmsName).toBe("Bright Dental");
    expect(rowText(row, "confirmed", null, start, 2).clinicSmsName).toBe("Bright Dental Makati");
  });

  it("keeps the reason and has no one to text for a deleted patient", () => {
    const deleted = { ...row, patient: { ...row.patient, anonymized_at: "2026-09-20T00:00:00Z" } };
    expect(rowText(deleted, "cancelled", null, start, 2, "Dentist unavailable")).toMatchObject({ mobile: null, reason: "Dentist unavailable" });
  });
});
