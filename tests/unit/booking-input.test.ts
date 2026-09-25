import { describe, expect, it } from "vitest";
import { detailErrors, parseBookingInput, resolveSelection, type PublicClinic } from "@/lib/booking-input";
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
  dentists: [
    { id: "d1", name: "Dr. Ana Reyes", smsName: "Dr. Reyes", hours: week },
    { id: "d2", name: "Dr. Marco Lim", smsName: "Dr. Lim", hours: week },
  ],
  procedures: [
    { id: "p1", name: "Consultation", minutes: 30 },
    { id: "p2", name: "Oral Prophylaxis (Cleaning)", minutes: 60 },
  ],
};

const today = "2026-09-24";
const good = {
  dentistId: "d2",
  procedureIds: ["p2", "p1"],
  startsAt: "2026-10-01T01:00:00.000Z",
  first: " Maria ",
  last: "Santos",
  mobile: "0917 123 4567",
  birthday: "",
  hmo: " Maxicare ",
  consent: true,
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

describe("detailErrors", () => {
  it("asks for the required fields", () => {
    const errors = detailErrors({ first: "", last: "", mobile: "", birthday: "", hmo: "", consent: false }, today);
    expect(Object.keys(errors).sort()).toEqual(["consent", "first", "last", "mobile"]);
    expect(errors.mobile).toBe("Enter a Philippine mobile number, like 0917 123 4567.");
    expect(errors.consent).toBe("Please agree before sending your request.");
  });

  it("rejects a future birthday", () => {
    const errors = detailErrors({ ...good, birthday: "2026-09-25" }, today);
    expect(errors).toEqual({ birthday: "Use a real past date, or leave this blank." });
  });
});

describe("parseBookingInput", () => {
  it("builds the stored payload on the server's terms", () => {
    expect(parseBookingInput(clinic, good, today)).toEqual({
      ok: true,
      payload: {
        clinicId: "c1",
        slug: "bright-dental",
        dentistId: "d2",
        startsAt: "2026-10-01T01:00:00.000Z",
        endsAt: "2026-10-01T02:30:00.000Z",
        procedureNames: ["Consultation", "Oral Prophylaxis (Cleaning)"],
        first: "Maria",
        last: "Santos",
        mobile: "+639171234567",
        birthday: null,
        hmo: "Maxicare",
      },
    });
  });

  it("ignores fields the client has no say over", () => {
    const result = parseBookingInput(clinic, { ...good, clinicId: "someone-else", endsAt: "2030-01-01T00:00:00Z" }, today);
    expect(result.ok && result.payload.clinicId).toBe("c1");
    expect(result.ok && result.payload.endsAt).toBe("2026-10-01T02:30:00.000Z");
  });

  it("reports every detail problem at once", () => {
    const result = parseBookingInput(clinic, { ...good, mobile: "123", consent: "yes" }, today);
    expect(result.ok).toBe(false);
    expect(!result.ok && Object.keys(result.errors).sort()).toEqual(["consent", "mobile"]);
  });

  it("flags an unusable visit or time as slot", () => {
    const badTime = parseBookingInput(clinic, { ...good, startsAt: "tomorrow" }, today);
    expect(!badTime.ok && badTime.errors.slot).toBe("Pick the visit and time again.");
    const badDentist = parseBookingInput(clinic, { ...good, dentistId: "gone" }, today);
    expect(!badDentist.ok && badDentist.errors.slot).toBe("Pick the visit and time again.");
  });

  it("survives input that is not an object", () => {
    expect(parseBookingInput(clinic, "hello", today).ok).toBe(false);
  });
});
