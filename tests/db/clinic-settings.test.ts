import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addTimeOff,
  loadSettings,
  removeTimeOff,
  saveDentist,
  saveProcedure,
  saveProfile,
  saveRules,
  setDentistActive,
  setProcedureActive,
} from "@/lib/clinic-settings";
import { addDays, manilaDate } from "@/lib/time";
import { adminDb, dropStaffClinic, staffClinic, type StaffSeed } from "./helpers";

const db = adminDb();
let a: StaffSeed;
let b: StaffSeed;
const week = (start: string, end: string) => [[], [{ start, end }], [], [], [], [], []];
const later = addDays(manilaDate(new Date()), 10);

beforeAll(async () => {
  a = await staffClinic();
  b = await staffClinic();
});

afterAll(async () => {
  await dropStaffClinic(a);
  await dropStaffClinic(b);
});

async function clinicRow(id: string) {
  const { data } = await db.from("clinics").select("*").eq("id", id).single().throwOnError();
  return data;
}

describe("profile and rules", () => {
  it("saves the profile with a map link", async () => {
    const input = {
      name: "Renamed Clinic",
      smsName: "Renamed",
      slug: a.seed.clinic.slug,
      mobile: "0917 555 0000",
      address: "Cebu City",
      mapsUrl: "https://maps.app.goo.gl/abc",
    };
    expect(await saveProfile(a.staff, input)).toEqual({ ok: true });
    expect(await clinicRow(a.staff.clinicId)).toMatchObject({
      name: "Renamed Clinic",
      sms_name: "Renamed",
      mobile: "+639175550000",
      address: "Cebu City",
      maps_url: "https://maps.app.goo.gl/abc",
    });
    expect((await clinicRow(b.staff.clinicId)).name).toBe("Staff Clinic");
  });

  it("reports a booking link another clinic uses", async () => {
    const input = { name: "X", smsName: "X", slug: b.seed.clinic.slug, mobile: "09175550000", address: "Cebu", mapsUrl: "" };
    expect(await saveProfile(a.staff, input)).toEqual({ ok: false, field: "slug", error: "That booking link is taken. Try another." });
    expect((await clinicRow(a.staff.clinicId)).slug).toBe(a.seed.clinic.slug);
  });

  it("saves booking rules and the alert channel", async () => {
    const rules = { slotMinutes: 15, minNoticeMinutes: 60, maxDaysAhead: 30, alertChannel: "sms" };
    expect(await saveRules(a.staff, rules)).toEqual({ ok: true });
    expect(await clinicRow(a.staff.clinicId)).toMatchObject({ slot_minutes: 15, min_notice_minutes: 60, max_days_ahead: 30, alert_channel: "sms" });
    expect(await saveRules(a.staff, { ...rules, slotMinutes: 45 })).toMatchObject({ ok: false, field: "slotMinutes" });
  });
});

describe("dentists and hours", () => {
  let lim: string;

  it("adds a dentist with hours and replaces the hours on edit", async () => {
    expect(await saveDentist(a.staff, null, { name: "Dr. Ben Lim", smsName: "Dr. Lim", hours: week("09:00", "12:00") })).toEqual({ ok: true });
    let view = await loadSettings(a.staff, new Date());
    const added = view.dentists.find((d) => d.name === "Dr. Ben Lim")!;
    lim = added.id;
    expect(added.hours[1]).toEqual([{ start: "09:00", end: "12:00" }]);

    const twoBlocks = [[], [{ start: "08:00", end: "11:00" }, { start: "14:00", end: "18:00" }], [], [], [], [], []];
    expect(await saveDentist(a.staff, lim, { name: "Dr. Ben Lim", smsName: "Dr. Lim", hours: twoBlocks })).toEqual({ ok: true });
    view = await loadSettings(a.staff, new Date());
    expect(view.dentists.find((d) => d.id === lim)!.hours[1]).toEqual([
      { start: "08:00", end: "11:00" },
      { start: "14:00", end: "18:00" },
    ]);
    const { count } = await db.from("working_hours").select("id", { count: "exact", head: true }).eq("dentist_id", lim).throwOnError();
    expect(count).toBe(2);
  });

  it("deactivates a dentist but never the last active one", async () => {
    expect(await setDentistActive(a.staff, lim, false)).toEqual({ ok: true });
    expect(await setDentistActive(a.staff, a.seed.dentist.id, false)).toMatchObject({ ok: false });
    expect(await setDentistActive(a.staff, lim, true)).toEqual({ ok: true });
  });

  it("changes nothing for another clinic", async () => {
    expect(await saveDentist(b.staff, lim, { name: "Hacked", smsName: "Hacked", hours: week("01:00", "02:00") })).toMatchObject({ ok: false });
    expect(await setDentistActive(b.staff, lim, false)).toMatchObject({ ok: false });
    const view = await loadSettings(a.staff, new Date());
    expect(view.dentists.find((d) => d.id === lim)).toMatchObject({ name: "Dr. Ben Lim", active: true });
    expect((await loadSettings(b.staff, new Date())).dentists.map((d) => d.id)).toEqual([b.seed.dentist.id]);
  });
});

describe("time off", () => {
  it("adds and removes time off, only in the owner's clinic", async () => {
    const input = { from: `${later}T09:00`, to: `${later}T12:00`, note: "Seminar" };
    expect(await addTimeOff(b.staff, a.seed.dentist.id, input, new Date())).toMatchObject({ ok: false });
    expect(await addTimeOff(a.staff, a.seed.dentist.id, input, new Date())).toEqual({ ok: true });
    const [off] = (await loadSettings(a.staff, new Date())).dentists.find((d) => d.id === a.seed.dentist.id)!.timeOff;
    expect(off.note).toBe("Seminar");

    expect(await removeTimeOff(b.staff, off.id)).toMatchObject({ ok: false });
    expect(await removeTimeOff(a.staff, off.id)).toEqual({ ok: true });
    expect((await loadSettings(a.staff, new Date())).dentists.find((d) => d.id === a.seed.dentist.id)!.timeOff).toEqual([]);
  });
});

describe("procedures", () => {
  it("adds, edits, and archives procedures, keeping at least one active", async () => {
    expect(await saveProcedure(a.staff, null, { name: "Whitening", minutes: 90 })).toEqual({ ok: true });
    let view = await loadSettings(a.staff, new Date());
    const whitening = view.procedures.find((p) => p.name === "Whitening")!;
    expect(await saveProcedure(a.staff, whitening.id, { name: "Teeth Whitening", minutes: 75 })).toEqual({ ok: true });

    for (const p of view.procedures.filter((x) => x.id !== whitening.id)) {
      expect(await setProcedureActive(a.staff, p.id, false)).toEqual({ ok: true });
    }
    expect(await setProcedureActive(a.staff, whitening.id, false)).toMatchObject({ ok: false });
    view = await loadSettings(a.staff, new Date());
    expect(view.procedures.filter((p) => p.active).map((p) => [p.name, p.minutes])).toEqual([["Teeth Whitening", 75]]);
  });

  it("changes nothing for another clinic", async () => {
    const [p] = (await loadSettings(a.staff, new Date())).procedures;
    expect(await saveProcedure(b.staff, p.id, { name: "Hacked", minutes: 30 })).toMatchObject({ ok: false });
    expect(await setProcedureActive(b.staff, p.id, true)).toMatchObject({ ok: false });
    expect((await loadSettings(a.staff, new Date())).procedures.find((x) => x.id === p.id)!.name).toBe(p.name);
  });
});
