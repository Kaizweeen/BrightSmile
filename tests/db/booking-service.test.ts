import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requestBooking, resendCode, verifyCode } from "@/lib/booking";
import { addDays, manilaDate, manilaInstant } from "@/lib/time";
import { adminDb, appointmentRow, deleteClinic, rand, seedClinic, type Seed } from "./helpers";

process.env.SMS_MODE = "log";
const db = adminDb();
const date = addDays(manilaDate(new Date()), 3);
const at = (minutes: number) => manilaInstant(date, minutes).toISOString();
const later = (ms: number) => new Date(Date.now() + ms);
const mobiles: string[] = [];
let seed: Seed;
let procedureId: string;

function newMobile(): string {
  const mobile = `+63918${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
  mobiles.push(mobile);
  return mobile;
}
const newIp = () => `test-${rand()}`;
const ctx = (verifiedMobiles: string[] = [], ip = newIp()) => ({ ip, now: new Date(), verifiedMobiles });

function input(startMinutes: number, mobile: string) {
  return {
    dentistId: seed.dentist.id,
    procedureIds: [procedureId],
    startsAt: at(startMinutes),
    first: "Maria",
    last: "Santos",
    mobile,
    birthday: "",
    hmo: "",
    consent: true,
  };
}

/** Log mode keeps the real code in sms_log (spec 10.6), so the test reads it like a phone would. */
async function lastCode(mobile: string): Promise<string> {
  const { data } = await db
    .from("sms_log")
    .select("body")
    .eq("to_mobile", mobile)
    .eq("kind", "otp")
    .order("id", { ascending: false })
    .limit(1)
    .single()
    .throwOnError();
  const match = /is (\d{6})\./.exec(data.body as string);
  if (!match) throw new Error(`No code in: ${data.body}`);
  return match[1];
}

async function codeRequest(startMinutes: number, mobile: string, ip = newIp()): Promise<string> {
  const outcome = await requestBooking(seed.clinic.slug, input(startMinutes, mobile), ctx([], ip));
  if (outcome.status !== "code") throw new Error(`Expected a code, got ${outcome.status}`);
  return outcome.requestId;
}

beforeAll(async () => {
  seed = await seedClinic();
  const { data } = await db
    .from("procedures")
    .insert({ clinic_id: seed.clinic.id, name: "Consultation", duration_minutes: 30 })
    .select("id")
    .single()
    .throwOnError();
  procedureId = data.id;
});

afterAll(async () => {
  await db.from("otp_requests").delete().in("mobile", mobiles);
  await deleteClinic(seed.clinic.id);
});

describe("online booking", () => {
  it("sends a code, then books the stored request once the code is right", async () => {
    const mobile = newMobile();
    const requestId = await codeRequest(540, mobile);
    const code = await lastCode(mobile);
    const wrong = code === "000000" ? "111111" : "000000";
    expect((await verifyCode(requestId, wrong, new Date())).outcome).toEqual({ status: "wrong", attemptsLeft: 4 });

    const right = await verifyCode(requestId, code, new Date());
    expect(right.verifiedMobile).toBe(mobile);
    if (right.outcome.status !== "sent") throw new Error(`Expected sent, got ${right.outcome.status}`);

    const { data: appt } = await db
      .from("appointments")
      .select("id, status, source, starts_at, procedure_names")
      .eq("manage_token", right.outcome.token)
      .single()
      .throwOnError();
    expect(appt).toMatchObject({ status: "pending", source: "online", procedure_names: ["Consultation"] });
    expect(new Date(appt.starts_at).toISOString()).toBe(at(540));

    const { data: alert } = await db
      .from("sms_log")
      .select("to_mobile, status, body")
      .eq("appointment_id", appt.id)
      .eq("kind", "request_alert")
      .single()
      .throwOnError();
    expect(alert.to_mobile).toBe("+639170000000");
    expect(alert.status).toBe("logged");
    expect(alert.body).toMatch(/^New request: Maria S\., /);

    expect((await verifyCode(requestId, code, new Date())).outcome).toEqual({ status: "used" });
  });

  it("skips the code for a mobile this device already verified", async () => {
    const mobile = newMobile();
    const outcome = await requestBooking(seed.clinic.slug, input(570, mobile), ctx([mobile]));
    expect(outcome.status).toBe("sent");
    const { count } = await db.from("otp_requests").select("id", { count: "exact", head: true }).eq("mobile", mobile);
    expect(count).toBe(0);
  });

  it("offers fresh times when the chosen one was just taken", async () => {
    const first = newMobile();
    expect((await requestBooking(seed.clinic.slug, input(600, first), ctx([first]))).status).toBe("sent");
    const second = newMobile();
    const outcome = await requestBooking(seed.clinic.slug, input(600, second), ctx([second]));
    if (outcome.status !== "taken") throw new Error(`Expected taken, got ${outcome.status}`);
    expect(outcome.starts).not.toContain(at(600));
    expect(outcome.starts).toContain(at(630));
  });

  it("re-checks the time before sending a code too", async () => {
    const outcome = await requestBooking(seed.clinic.slug, input(600, newMobile()), ctx());
    expect(outcome.status).toBe("taken");
  });

  it("names every problem with the details", async () => {
    const outcome = await requestBooking(seed.clinic.slug, { ...input(630, "123"), consent: false }, ctx());
    if (outcome.status !== "invalid") throw new Error(`Expected invalid, got ${outcome.status}`);
    expect(Object.keys(outcome.errors).sort()).toEqual(["consent", "mobile"]);
  });

  it("does not know an unknown booking link", async () => {
    const outcome = await requestBooking("no-such-clinic-zz9", input(630, newMobile()), ctx());
    expect(outcome).toEqual({ status: "invalid", errors: { slot: "This booking link doesn't exist." } });
  });

  it("books at most 3 pending requests per clinic for one mobile, then refuses a 4th", async () => {
    const day = addDays(date, 1);
    const at2 = (minutes: number) => manilaInstant(day, minutes).toISOString();
    const mobile = newMobile();
    const build = (minutes: number) => ({ ...input(0, mobile), startsAt: at2(minutes) });
    for (const minutes of [540, 570, 600]) {
      expect((await requestBooking(seed.clinic.slug, build(minutes), ctx([mobile]))).status).toBe("sent");
    }
    expect(await requestBooking(seed.clinic.slug, build(630), ctx([mobile]))).toEqual({ status: "too_many" });
    await db.from("appointments").delete().eq("clinic_id", seed.clinic.id).gte("starts_at", manilaInstant(day, 0).toISOString());
  });

  it("never books a time that stopped being open while the code was out", async () => {
    const mobile = newMobile();
    const requestId = await codeRequest(660, mobile);
    await db.from("appointments").insert(appointmentRow(seed, at(660), at(690), "confirmed")).throwOnError();
    const result = await verifyCode(requestId, await lastCode(mobile), new Date());
    expect(result.outcome.status).toBe("taken");
    expect(result.verifiedMobile).toBe(mobile);
  });
});

describe("verification code rules", () => {
  it("locks a code after 5 wrong tries, even for the right code", async () => {
    const mobile = newMobile();
    const requestId = await codeRequest(720, mobile);
    const code = await lastCode(mobile);
    const wrong = code === "000000" ? "111111" : "000000";
    for (const left of [4, 3, 2, 1, 0]) {
      expect((await verifyCode(requestId, wrong, new Date())).outcome).toEqual({ status: "wrong", attemptsLeft: left });
    }
    expect((await verifyCode(requestId, code, new Date())).outcome).toEqual({ status: "locked" });
  });

  it("never lets parallel wrong guesses spend more than 5 attempts", async () => {
    const mobile = newMobile();
    const requestId = await codeRequest(690, mobile);
    const code = await lastCode(mobile);
    const wrong = code === "000000" ? "111111" : "000000";
    await Promise.all(Array.from({ length: 10 }, () => verifyCode(requestId, wrong, new Date())));
    const { data } = await db.from("otp_requests").select("attempts").eq("id", requestId).single().throwOnError();
    expect(data.attempts).toBeLessThanOrEqual(5);
  });

  it("expires a code after 5 minutes", async () => {
    const mobile = newMobile();
    const requestId = await codeRequest(750, mobile);
    const code = await lastCode(mobile);
    expect((await verifyCode(requestId, code, later(5 * 60_000 + 1_000))).outcome).toEqual({ status: "expired" });
  });

  it("treats an unknown or malformed request as expired", async () => {
    expect((await verifyCode("00000000-0000-0000-0000-000000000000", "123456", new Date())).outcome).toEqual({ status: "expired" });
    expect((await verifyCode("not-a-uuid", "123456", new Date())).outcome).toEqual({ status: "expired" });
  });

  it("resends after 60 seconds with a new code and retires the old one", async () => {
    const mobile = newMobile();
    const oldId = await codeRequest(780, mobile);
    const oldCode = await lastCode(mobile);
    expect((await resendCode(oldId, { ip: newIp(), now: new Date() })).status).toBe("wait");

    const resent = await resendCode(oldId, { ip: newIp(), now: later(61_000) });
    if (resent.status !== "code") throw new Error(`Expected code, got ${resent.status}`);
    expect(resent.requestId).not.toBe(oldId);
    expect((await verifyCode(oldId, oldCode, later(62_000))).outcome).toEqual({ status: "expired" });
    const verified = await verifyCode(resent.requestId, await lastCode(mobile), new Date());
    expect(verified.outcome.status).toBe("sent");
  });

  it("allows 3 codes per mobile in an hour", async () => {
    const mobile = newMobile();
    for (let i = 0; i < 3; i++) await codeRequest(810, mobile);
    expect((await requestBooking(seed.clinic.slug, input(810, mobile), ctx())).status).toBe("limited");
  });

  it("allows 10 codes per IP address in an hour", async () => {
    const ip = newIp();
    for (let i = 0; i < 10; i++) await codeRequest(840, newMobile(), ip);
    expect((await requestBooking(seed.clinic.slug, input(840, newMobile()), ctx([], ip))).status).toBe("limited");
  });

  it("still caps parallel requests at 3 codes per mobile", async () => {
    const mobile = newMobile();
    const results = await Promise.all(
      Array.from({ length: 6 }, () => requestBooking(seed.clinic.slug, input(870, mobile), ctx())),
    );
    const codeCount = results.filter((r) => r.status === "code").length;
    expect(codeCount).toBeLessThanOrEqual(3);
    const { count } = await db.from("otp_requests").select("id", { count: "exact", head: true }).eq("mobile", mobile);
    expect(count).toBeLessThanOrEqual(3);
  });

  it("lets only one of two parallel resends through, and rejects reuse of a retired id", async () => {
    const mobile = newMobile();
    const oldId = await codeRequest(900, mobile);

    const [first, second] = await Promise.all([
      resendCode(oldId, { ip: newIp(), now: later(61_000) }),
      resendCode(oldId, { ip: newIp(), now: later(61_000) }),
    ]);
    const codeResults = [first, second].filter((r) => r.status === "code");
    expect(codeResults.length).toBe(1);

    // The other racer sees the row already retired by the winner.
    const other = codeResults[0] === first ? second : first;
    expect(["gone", "wait"]).toContain(other.status);

    // Reusing the now-retired original id is unusable.
    expect((await resendCode(oldId, { ip: newIp(), now: later(62_000) })).status).toBe("gone");
  });

  it("rejects a resend before 60 seconds", async () => {
    const mobile = newMobile();
    const oldId = await codeRequest(930, mobile);
    expect((await resendCode(oldId, { ip: newIp(), now: new Date() })).status).toBe("wait");
  });
});
