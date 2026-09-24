import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb, appointmentRow, deleteClinic, rand, seedClinic, type Seed } from "./helpers";

const db = adminDb();
let seed: Seed;
const at = (clock: string) => `2030-01-07T${clock}:00+08:00`; // far from any real data

beforeAll(async () => {
  seed = await seedClinic();
});

afterAll(async () => {
  await deleteClinic(seed.clinic.id);
});

describe("double booking guard", () => {
  it("rejects an overlapping appointment for the same dentist", async () => {
    await db.from("appointments").insert(appointmentRow(seed, at("09:00"), at("10:00"))).throwOnError();
    const { error } = await db.from("appointments").insert(appointmentRow(seed, at("09:30"), at("10:30"), "pending"));
    expect(error?.code).toBe("23P01");
  });

  it("allows back-to-back appointments", async () => {
    const { error } = await db.from("appointments").insert(appointmentRow(seed, at("10:00"), at("10:30")));
    expect(error).toBeNull();
  });

  it("ignores declined and cancelled appointments", async () => {
    await db.from("appointments").insert(appointmentRow(seed, at("11:00"), at("12:00"), "declined")).throwOnError();
    await db.from("appointments").insert(appointmentRow(seed, at("11:00"), at("12:00"), "cancelled")).throwOnError();
    const { error } = await db.from("appointments").insert(appointmentRow(seed, at("11:00"), at("12:00")));
    expect(error).toBeNull();
  });

  it("lets two dentists overlap", async () => {
    const { data: other } = await db
      .from("dentists")
      .insert({ clinic_id: seed.clinic.id, name: "Dr. Two", sms_name: "Dr. Two" })
      .select()
      .single()
      .throwOnError();
    const { error } = await db.from("appointments").insert({ ...appointmentRow(seed, at("09:00"), at("10:00")), dentist_id: other.id });
    expect(error).toBeNull();
  });
});

describe("integrity checks", () => {
  it("refuses a dentist from another clinic", async () => {
    const other = await seedClinic();
    const { error } = await db.from("appointments").insert({ ...appointmentRow(seed, at("14:00"), at("15:00")), dentist_id: other.dentist.id });
    expect(error?.code).toBe("23503");
    await deleteClinic(other.clinic.id);
  });

  it("refuses short names that start with test", async () => {
    const { error } = await db.from("clinics").insert({ name: "X", sms_name: "TEST Dental", slug: `t-${rand()}`, mobile: "+639170000000" });
    expect(error?.code).toBe("23514");
  });

  it("refuses a reserved slug", async () => {
    const { error } = await db.from("clinics").insert({ name: "X", sms_name: "X", slug: "admin", mobile: "+639170000000" });
    expect(error?.code).toBe("23514");
  });

  it("refuses badly formed mobiles and booking links", async () => {
    for (const bad of [{ mobile: "09170000000", slug: `t-${rand()}` }, { mobile: "+639170000000", slug: "Bad Slug" }]) {
      const { error } = await db.from("clinics").insert({ name: "X", sms_name: "X", ...bad });
      expect(error?.code).toBe("23514");
    }
  });
});
