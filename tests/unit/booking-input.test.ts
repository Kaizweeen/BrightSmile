import { describe, expect, it } from "vitest";
import { resolveSelection, type PublicClinic } from "@/lib/booking-input";
import type { Block } from "@/lib/slots";

const day: Block[] = [{ start: 540, end: 1020 }];
const week: Block[][] = [[], day, day, day, day, day, day];
const clinic: PublicClinic = {
  id: "c1",
  slug: "bright-dental",
  name: "Bright Dental",
  smsName: "Bright Dental",
  mobile: "+639170000000",
  address: "Makati",
  mapsUrl: null,
  rules: { slotMinutes: 30, minNoticeMinutes: 120, maxDaysAhead: 60 },
  branch: { id: "b1", name: "Main", address: "Makati", mapsUrl: null },
  branches: [{ id: "b1", name: "Main", address: "Makati", mapsUrl: null }],
  dentists: [
    { id: "d1", name: "Dr. Ana Reyes", smsName: "Dr. Reyes", hours: week },
    { id: "d2", name: "Dr. Marco Lim", smsName: "Dr. Lim", hours: week },
  ],
  procedures: [
    { id: "p1", name: "Consultation", minutes: 30 },
    { id: "p2", name: "Oral Prophylaxis (Cleaning)", minutes: 60 },
  ],
};

describe("resolveSelection", () => {
  it("adds up the chosen procedures, in the clinic's order", () => {
    const chosen = resolveSelection(clinic, { dentistId: "d1", procedureIds: ["p2", "p1"] });
    expect(chosen?.duration).toBe(90);
    expect(chosen?.dentist.id).toBe("d1");
    expect(chosen?.procedures.map((p) => p.name)).toEqual(["Consultation", "Oral Prophylaxis (Cleaning)"]);
  });

  it.each([
    [null],
    ["d1"],
    [{ dentistId: "nobody", procedureIds: ["p1"] }],
    [{ dentistId: "d1", procedureIds: [] }],
    [{ dentistId: "d1", procedureIds: ["p1", "p1"] }],
    [{ dentistId: "d1", procedureIds: ["p1", "archived"] }],
    [{ dentistId: "d1", procedureIds: "p1" }],
    [{ dentistId: "d1", procedureIds: Array.from({ length: 21 }, (_, i) => `p${i}`) }],
  ])("rejects %j", (value) => {
    expect(resolveSelection(clinic, value)).toBeNull();
  });
});
