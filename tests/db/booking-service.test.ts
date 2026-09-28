import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resendCode } from "@/lib/booking";
import { bookForNumber, checkVerification, startVerification } from "@/lib/number-booking";
import { addDays, manilaDate, manilaInstant } from "@/lib/time";
import { adminDb, deleteClinic, rand, seedClinic, type Seed } from "./helpers";

process.env.SMS_MODE = "log";
const db = adminDb();
const date = addDays(manilaDate(new Date()), 3);
const at = (minutes: number) => manilaInstant(date, minutes).toISOString();
const later = (ms: number) => new Date(Date.now() + ms);
const mobiles: string[] = [];
let seed: Seed;
let procedureId: string;
let branchId: string;

function newMobile(): string {
  const mobile = `+63918${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
  mobiles.push(mobile);
  return mobile;
}
const newIp = () => `test-${rand()}`;
const phone = (verifiedMobiles: string[] = [], ip = newIp()) => ({ ip, now: new Date(), verifiedMobiles });
const form = { last: "Santos", first: "Maria", birthday: "1990-05-17", sex: "female", address: "Makati", agree: true, signature: "Maria Santos" };

/** A request for someone new, as the booking page sends it once the number is verified. */
function request(startsAt: string, mobile: string) {
  return { mobile, branchId, dentistId: seed.dentist.id, procedureIds: [procedureId], startsAt, form };
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

async function codeRequest(mobile: string, ip = newIp()): Promise<string> {
  const outcome = await startVerification(seed.clinic.slug, mobile, phone([], ip));
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
  const { data: branch } = await db.from("branches").select("id").eq("clinic_id", seed.clinic.id).single().throwOnError();
  branchId = branch.id;
});

afterAll(async () => {
  await db.from("otp_requests").delete().in("mobile", mobiles);
  await deleteClinic(seed.clinic.id);
});

describe("booking by a verified number", () => {
  it("texts a code, verifies the number with it, then books someone new with the form", async () => {
    const mobile = newMobile();
    const requestId = await codeRequest(mobile);
    const code = await lastCode(mobile);
    const wrong = code === "000000" ? "111111" : "000000";
    expect(await checkVerification(requestId, wrong, new Date())).toEqual({ status: "wrong", attemptsLeft: 4 });
    expect(await checkVerification(requestId, code, new Date())).toEqual({ status: "verified", mobile });

    const outcome = await bookForNumber(seed.clinic.slug, request(at(540), mobile), phone([mobile]));
    if (outcome.status !== "sent") throw new Error(`Expected sent, got ${outcome.status}`);
    const { data: appt } = await db
      .from("appointments")
      .select("id, status, source, starts_at, procedure_names, branch_id")
      .eq("manage_token", outcome.token)
      .single()
      .throwOnError();
    expect(appt).toMatchObject({ status: "pending", source: "online", procedure_names: ["Consultation"], branch_id: branchId });
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

    expect(await checkVerification(requestId, code, new Date())).toEqual({ status: "used" });
  });

  it("skips the code for a number this phone already verified", async () => {
    const mobile = newMobile();
    expect(await startVerification(seed.clinic.slug, mobile, phone([mobile]))).toEqual({ status: "verified", mobile });
    const { count } = await db.from("otp_requests").select("id", { count: "exact", head: true }).eq("mobile", mobile);
    expect(count).toBe(0);
  });

  it("offers fresh times when the chosen one was just taken", async () => {
    const first = newMobile();
    expect((await bookForNumber(seed.clinic.slug, request(at(600), first), phone([first]))).status).toBe("sent");
    const second = newMobile();
    const outcome = await bookForNumber(seed.clinic.slug, request(at(600), second), phone([second]));
    if (outcome.status !== "taken") throw new Error(`Expected taken, got ${outcome.status}`);
    expect(outcome.starts).not.toContain(at(600));
    expect(outcome.starts).toContain(at(630));
  });

  it("names every problem with the form", async () => {
    const mobile = newMobile();
    const outcome = await bookForNumber(seed.clinic.slug, { ...request(at(630), mobile), form: { ...form, agree: false, address: "" } }, phone([mobile]));
    if (outcome.status !== "invalid") throw new Error(`Expected invalid, got ${outcome.status}`);
    expect(Object.keys(outcome.errors).sort()).toEqual(["address", "agree"]);
  });

  it("does not know an unknown booking link", async () => {
    expect(await startVerification("no-such-clinic-zz9", newMobile(), phone())).toEqual({ status: "invalid" });
  });

  it("books at most 3 pending requests per clinic for one mobile, then refuses a 4th", async () => {
    const day = addDays(date, 1);
    const at2 = (minutes: number) => manilaInstant(day, minutes).toISOString();
    const mobile = newMobile();
    for (const minutes of [540, 570, 600]) {
      expect((await bookForNumber(seed.clinic.slug, request(at2(minutes), mobile), phone([mobile]))).status).toBe("sent");
    }
    expect(await bookForNumber(seed.clinic.slug, request(at2(630), mobile), phone([mobile]))).toEqual({ status: "too_many" });
    await db.from("appointments").delete().eq("clinic_id", seed.clinic.id).gte("starts_at", manilaInstant(day, 0).toISOString());
  });
});

describe("verification code rules", () => {
  it("locks a code after 5 wrong tries, even for the right code", async () => {
    const mobile = newMobile();
    const requestId = await codeRequest(mobile);
    const code = await lastCode(mobile);
    const wrong = code === "000000" ? "111111" : "000000";
    for (const left of [4, 3, 2, 1, 0]) {
      expect(await checkVerification(requestId, wrong, new Date())).toEqual({ status: "wrong", attemptsLeft: left });
    }
    expect(await checkVerification(requestId, code, new Date())).toEqual({ status: "locked" });
  });

  it("never lets parallel wrong guesses spend more than 5 attempts", async () => {
    const mobile = newMobile();
    const requestId = await codeRequest(mobile);
    const code = await lastCode(mobile);
    const wrong = code === "000000" ? "111111" : "000000";
    await Promise.all(Array.from({ length: 10 }, () => checkVerification(requestId, wrong, new Date())));
    const { data } = await db.from("otp_requests").select("attempts").eq("id", requestId).single().throwOnError();
    expect(data.attempts).toBeLessThanOrEqual(5);
  });

  it("expires a code after 5 minutes", async () => {
    const mobile = newMobile();
    const requestId = await codeRequest(mobile);
    const code = await lastCode(mobile);
    expect(await checkVerification(requestId, code, later(5 * 60_000 + 1_000))).toEqual({ status: "expired" });
  });

  it("treats an unknown or malformed request as expired", async () => {
    expect(await checkVerification("00000000-0000-0000-0000-000000000000", "123456", new Date())).toEqual({ status: "expired" });
    expect(await checkVerification("not-a-uuid", "123456", new Date())).toEqual({ status: "expired" });
  });

  it("resends after 60 seconds with a new code and retires the old one", async () => {
    const mobile = newMobile();
    const oldId = await codeRequest(mobile);
    const oldCode = await lastCode(mobile);
    expect((await resendCode(oldId, { ip: newIp(), now: new Date() })).status).toBe("wait");

    const resent = await resendCode(oldId, { ip: newIp(), now: later(61_000) });
    if (resent.status !== "code") throw new Error(`Expected code, got ${resent.status}`);
    expect(resent.requestId).not.toBe(oldId);
    expect(await checkVerification(oldId, oldCode, later(62_000))).toEqual({ status: "expired" });
    expect(await checkVerification(resent.requestId, await lastCode(mobile), new Date())).toEqual({ status: "verified", mobile });
  });

  it("allows 3 codes per mobile in an hour", async () => {
    const mobile = newMobile();
    for (let i = 0; i < 3; i++) await codeRequest(mobile);
    expect((await startVerification(seed.clinic.slug, mobile, phone())).status).toBe("limited");
  });

  it("allows 10 codes per IP address in an hour", async () => {
    const ip = newIp();
    for (let i = 0; i < 10; i++) await codeRequest(newMobile(), ip);
    expect((await startVerification(seed.clinic.slug, newMobile(), phone([], ip))).status).toBe("limited");
  });

  it("still caps parallel requests at 3 codes per mobile", async () => {
    const mobile = newMobile();
    const results = await Promise.all(Array.from({ length: 6 }, () => startVerification(seed.clinic.slug, mobile, phone())));
    expect(results.filter((r) => r.status === "code").length).toBeLessThanOrEqual(3);
    const { count } = await db.from("otp_requests").select("id", { count: "exact", head: true }).eq("mobile", mobile);
    expect(count).toBeLessThanOrEqual(3);
  });

  it("lets only one of two parallel resends through, and rejects reuse of a retired id", async () => {
    const mobile = newMobile();
    const oldId = await codeRequest(mobile);

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
    const oldId = await codeRequest(mobile);
    expect((await resendCode(oldId, { ip: newIp(), now: new Date() })).status).toBe("wait");
  });
});
