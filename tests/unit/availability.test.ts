import { beforeEach, describe, expect, it, vi } from "vitest";
import { dayOpenStarts, loadClinic } from "@/lib/availability";
import type { PublicClinic } from "@/lib/booking-input";
import { formatTime } from "@/lib/time";

// The secret-key client as loadClinic and busyBetween read it: each table answers its rows below, whatever the
// filters. The database applies clinic_id and active; this checks what loadClinic does with the rows it gets.
const fake = vi.hoisted(() => ({ rows: {} as Record<string, unknown[]> }));
vi.mock("@/lib/supabase/admin", () => ({
  adminClient: () => ({
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query,
        lt: () => query,
        gt: () => query,
        order: () => query,
        maybeSingle: async () => ({ data: fake.rows[table]?.[0] ?? null, error: null }),
        throwOnError: async () => ({ data: fake.rows[table] ?? [], error: null }),
      };
      return query;
    },
  }),
}));

const MAKATI = "b1";
const PASIG = "b2";
const now = new Date("2026-10-01T00:00:00Z");
const monday = "2026-10-05";

beforeEach(() => {
  fake.rows = {
    clinics: [
      {
        id: "c1",
        slug: "bright-dental",
        name: "Bright Dental",
        sms_name: "Bright Dental",
        mobile: "+639170000000",
        address: "Makati",
        maps_url: null,
        slot_minutes: 30,
        min_notice_minutes: 120,
        max_days_ahead: 60,
      },
    ],
    branches: [
      { id: MAKATI, name: "Makati", address: "Ayala Ave", maps_url: null },
      { id: PASIG, name: "Pasig", address: "Kapitolyo", maps_url: "https://maps.app.goo.gl/x" },
    ],
    dentists: [
      { id: "d1", name: "Dr. Ana Reyes", sms_name: "Dr. Reyes" },
      { id: "d2", name: "Dr. Ben Lim", sms_name: "Dr. Lim" },
    ],
    working_hours: [
      { dentist_id: "d1", branch_id: MAKATI, weekday: 1, start_time: "09:00:00", end_time: "12:00:00" },
      { dentist_id: "d1", branch_id: PASIG, weekday: 1, start_time: "13:00:00", end_time: "17:00:00" },
      { dentist_id: "d2", branch_id: PASIG, weekday: 2, start_time: "09:00:00", end_time: "10:00:00" },
    ],
    procedures: [{ id: "p1", name: "Consultation", duration_minutes: 30 }],
    appointments: [],
    time_off: [],
  };
});

const times = async (clinic: PublicClinic, ignoreId?: string) =>
  (await dayOpenStarts(clinic, clinic.dentists[0], 60, monday, now, ignoreId)).map((s) => formatTime(s));

describe("loadClinic", () => {
  it("opens at the first active branch when none is named, as every page from before branches does", async () => {
    const clinic = await loadClinic({ slug: "bright-dental" });
    expect(clinic?.branch).toEqual({ id: MAKATI, name: "Makati", address: "Ayala Ave", mapsUrl: null });
    expect(clinic?.branches.map((b) => b.id)).toEqual([MAKATI, PASIG]);
    expect(clinic?.dentists.map((d) => d.id)).toEqual(["d1"]);
    expect(clinic?.dentists[0].hours[1]).toEqual([{ start: 540, end: 720 }]);
  });

  it("uses only the named branch's hours, and lists the dentists who work there", async () => {
    const clinic = await loadClinic({ slug: "bright-dental" }, PASIG);
    expect(clinic?.branch.name).toBe("Pasig");
    expect(clinic?.dentists.map((d) => [d.id, d.hours[1], d.hours[2]])).toEqual([
      ["d1", [{ start: 780, end: 1020 }], []],
      ["d2", [], [{ start: 540, end: 600 }]],
    ]);
  });

  it("is null for a branch that is not one of the clinic's active branches", async () => {
    expect(await loadClinic({ slug: "bright-dental" }, "b3")).toBeNull();
  });
});

describe("dayOpenStarts", () => {
  it("offers a dentist's times at the chosen branch only", async () => {
    expect(await times((await loadClinic({ slug: "bright-dental" }))!)).toEqual(["9:00 AM", "9:30 AM", "10:00 AM", "10:30 AM", "11:00 AM"]);
    expect(await times((await loadClinic({ slug: "bright-dental" }, PASIG))!)).toEqual([
      "1:00 PM",
      "1:30 PM",
      "2:00 PM",
      "2:30 PM",
      "3:00 PM",
      "3:30 PM",
      "4:00 PM",
    ]);
  });

  it("counts the appointment being changed as free, and every other one as busy", async () => {
    fake.rows.appointments = [{ id: "a1", starts_at: "2026-10-05T01:00:00Z", ends_at: "2026-10-05T02:00:00Z" }]; // 9:00 to 10:00 AM Manila
    const clinic = (await loadClinic({ slug: "bright-dental" }))!;
    expect(await times(clinic)).toEqual(["10:00 AM", "10:30 AM", "11:00 AM"]);
    expect(await times(clinic, "a1")).toEqual(["9:00 AM", "9:30 AM", "10:00 AM", "10:30 AM", "11:00 AM"]);
  });
});
