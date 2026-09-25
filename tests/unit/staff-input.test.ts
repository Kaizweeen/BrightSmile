import { describe, expect, it } from "vitest";
import { matchesWords, parseManualBooking, parsePatientFields, parseSlot, patientSearch } from "@/lib/staff-input";

const today = "2026-09-25";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("parsePatientFields", () => {
  it("cleans names, makes the mobile optional, and normalizes it", () => {
    expect(parsePatientFields({ first: " Ana ", last: "Cruz", mobile: "0917 123 4567", birthday: "", hmo: "" }, today)).toEqual({
      ok: true,
      value: { first: "Ana", last: "Cruz", mobile: "+639171234567", birthday: null, hmo: "" },
    });
    expect(parsePatientFields({ first: "Lolo", last: "Santos", mobile: "  " }, today)).toEqual({
      ok: true,
      value: { first: "Lolo", last: "Santos", mobile: null, birthday: null, hmo: "" },
    });
  });

  it("reports each bad field", () => {
    const result = parsePatientFields({ first: "", last: "x".repeat(51), mobile: "02 8123 4567", birthday: "2999-01-01", hmo: "y".repeat(61) }, today);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(["birthday", "first", "hmo", "last", "mobile"]);
  });
});

describe("parseSlot", () => {
  it("accepts an open or custom time on a whole minute", () => {
    expect(parseSlot({ dentistId: uuid(1), startsAt: "2026-09-28T01:00:00.000Z", custom: false })).toEqual({
      dentistId: uuid(1),
      startsAt: new Date("2026-09-28T01:00:00.000Z"),
      custom: false,
    });
  });

  it("rejects anything malformed", () => {
    expect(parseSlot(null)).toBeNull();
    expect(parseSlot({ dentistId: "x", startsAt: "2026-09-28T01:00:00Z", custom: false })).toBeNull();
    expect(parseSlot({ dentistId: uuid(1), startsAt: "soon", custom: false })).toBeNull();
    expect(parseSlot({ dentistId: uuid(1), startsAt: "2026-09-28T01:00:30Z", custom: false })).toBeNull();
    expect(parseSlot({ dentistId: uuid(1), startsAt: "2026-09-28T01:00:00Z", custom: "yes" })).toBeNull();
  });
});

describe("parseManualBooking", () => {
  const slot = { dentistId: uuid(1), startsAt: "2026-09-28T01:00:00Z", custom: true };

  it("takes an existing patient by id and ignores typed details", () => {
    const result = parseManualBooking({ patientId: uuid(2), procedureIds: [uuid(3)], slot, sendText: true }, today);
    expect(result).toEqual({
      ok: true,
      value: { patientId: uuid(2), patient: null, procedureIds: [uuid(3)], slot: parseSlot(slot), sendText: true },
    });
  });

  it("takes a new patient's details when there is no id, and sendText only when true", () => {
    const result = parseManualBooking({ patient: { first: "Lolo", last: "Santos" }, procedureIds: [uuid(3)], slot, sendText: "yes" }, today);
    expect(result.ok && result.value.patient).toEqual({ first: "Lolo", last: "Santos", mobile: null, birthday: null, hmo: "" });
    expect(result.ok && result.value.sendText).toBe(false);
  });

  it("needs procedures, a time, and a patient", () => {
    const result = parseManualBooking({ procedureIds: [], slot: null }, today);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(["first", "last", "procedures", "slot"]);
    const dupes = parseManualBooking({ patientId: uuid(2), procedureIds: [uuid(3), uuid(3)], slot }, today);
    expect(dupes.ok).toBe(false);
    const tooMany = parseManualBooking({ patientId: uuid(2), procedureIds: Array.from({ length: 21 }, (_, i) => uuid(i + 10)), slot }, today);
    expect(tooMany.ok).toBe(false);
  });
});

describe("patientSearch", () => {
  it("searches mobiles by prefix in the stored form", () => {
    expect(patientSearch("0918 123")).toEqual({ kind: "mobile", prefix: "+63918123" });
    expect(patientSearch("+63 918-123")).toEqual({ kind: "mobile", prefix: "+63918123" });
    expect(patientSearch("918")).toEqual({ kind: "mobile", prefix: "+63918" });
  });

  it("searches names by lowercase word, dropping characters that could change the query", () => {
    expect(patientSearch("  Maria  Santos ")).toEqual({ kind: "name", words: ["maria", "santos"] });
    expect(patientSearch("ana,(x)%*")).toEqual({ kind: "name", words: ["anax"] });
    expect(patientSearch("O'Brien Dela-Cruz")).toEqual({ kind: "name", words: ["o'brien", "dela-cruz"] });
    expect(patientSearch("Ñino")).toEqual({ kind: "name", words: ["ñino"] });
  });

  it("returns null for nothing useful", () => {
    expect(patientSearch("")).toBeNull();
    expect(patientSearch("  ,,  ")).toBeNull();
    expect(patientSearch(42)).toBeNull();
  });

  it("treats one or two digits as a name search, not a mobile search", () => {
    expect(patientSearch("12")).toEqual({ kind: "name", words: ["12"] });
  });
});

describe("matchesWords", () => {
  it("needs every word somewhere in the full name", () => {
    expect(matchesWords({ first: "Maria", last: "Santos" }, ["mar", "san"])).toBe(true);
    expect(matchesWords({ first: "Mario", last: "Reyes" }, ["mar", "san"])).toBe(false);
  });
});
