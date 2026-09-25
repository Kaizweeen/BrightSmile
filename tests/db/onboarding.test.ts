import { afterAll, describe, expect, it } from "vitest";
import { DEFAULT_HOURS, DEFAULT_PROCEDURES, parseOnboarding } from "@/lib/onboarding";
import { adminDb, deleteClinic, deleteUser, rand, signedInUser } from "./helpers";

const cleanup: { clinicId?: string; userId?: string } = {};

afterAll(async () => {
  if (cleanup.clinicId) await deleteClinic(cleanup.clinicId);
  if (cleanup.userId) await deleteUser(cleanup.userId);
});

describe("onboarding payload", () => {
  it("creates a clinic from the onboarding defaults", async () => {
    const user = await signedInUser();
    cleanup.userId = user.userId;
    const parsed = parseOnboarding({
      name: "Onboard Dental",
      smsName: "Onboard Dental",
      slug: `ob-${rand()}`,
      mobile: "0917 123 4567",
      address: "Makati",
      dentistName: "Dr. Ana Reyes",
      dentistSmsName: "Dr. Reyes",
      hours: DEFAULT_HOURS,
      procedures: DEFAULT_PROCEDURES,
    });
    if (!parsed.ok) throw new Error(parsed.error);

    const { data: clinicId } = await user.db.rpc("create_clinic", { p: parsed.payload }).throwOnError();
    cleanup.clinicId = clinicId;

    const db = adminDb();
    const { data: clinic } = await db.from("clinics").select("mobile, address").eq("id", clinicId).single().throwOnError();
    expect(clinic).toEqual({ mobile: "+639171234567", address: "Makati" });
    const { data: hours } = await db.from("working_hours").select("weekday, start_time, end_time").eq("clinic_id", clinicId).throwOnError();
    expect(hours).toHaveLength(12);
    expect(hours).toContainEqual({ weekday: 6, start_time: "13:00:00", end_time: "17:00:00" });
    const { data: procedures } = await db.from("procedures").select("name, duration_minutes").eq("clinic_id", clinicId).throwOnError();
    expect(procedures).toHaveLength(10);
    expect(procedures).toContainEqual({ name: "Root Canal Treatment", duration_minutes: 90 });
  });
});
