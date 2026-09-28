import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadPatientView } from "@/lib/patient-link";

// The patient link reads one appointment by its token with the secret key; the fake answers one row and records the
// columns asked for.
const fake = vi.hoisted(() => ({ select: "", row: null as Record<string, unknown> | null }));

vi.mock("@/lib/notify", () => ({ alertClinic: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  adminClient: () => ({
    from: () => ({
      select: (columns: string) => {
        fake.select = columns;
        return { eq: () => ({ maybeSingle: async () => ({ data: fake.row, error: null }) }) };
      },
    }),
  }),
}));

const now = new Date("2026-10-01T00:00:00.000Z");

beforeEach(() => {
  fake.row = {
    id: "a1",
    clinic_id: "c1",
    status: "confirmed",
    starts_at: "2026-10-05T02:00:00.000Z",
    patient: { first_name: "Ana", last_name: "Cruz" },
    dentist: { name: "Dr. Ana Reyes", sms_name: "Dr. Reyes" },
    clinic: { name: "Bright Dental", slug: "bright-dental", mobile: "+639170000000" },
    branch: { name: "Makati", address: "12 Rizal St, Makati", maps_url: "https://maps.app.goo.gl/abc" },
  };
});

describe("loadPatientView", () => {
  it("names the visit's branch, its address, and its map link", async () => {
    expect(await loadPatientView("AbCdEfGhIjKl", now)).toMatchObject({
      firstName: "Ana",
      clinicName: "Bright Dental",
      branchName: "Makati",
      branchAddress: "12 Rizal St, Makati",
      branchMapsUrl: "https://maps.app.goo.gl/abc",
      cancellable: true,
    });
    expect(fake.select).toContain("branch:branches(name, address, maps_url)");
  });
});
