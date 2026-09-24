import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteSubscription, pushPayload, saveSubscription, sendPush, type PushSend } from "@/lib/push";
import { adminDb, dropStaffClinic, rand, staffClinic, type StaffSeed } from "./helpers";

const db = adminDb();
const keys = { p256dh: `B${"A".repeat(86)}`, auth: "A".repeat(22) };
const endpoint = () => `https://fcm.googleapis.com/fcm/send/test-${rand()}${rand()}`;
const payload = pushPayload("request_alert", new Date(), null);
let a: StaffSeed;
let b: StaffSeed;

beforeAll(async () => {
  [a, b] = await Promise.all([staffClinic(), staffClinic()]);
});

afterAll(async () => {
  await Promise.all([dropStaffClinic(a), dropStaffClinic(b)]);
});

async function rowsFor(end: string) {
  const { data } = await db.from("push_subscriptions").select("clinic_id, user_id, p256dh").eq("endpoint", end).throwOnError();
  return data;
}

describe("saveSubscription and deleteSubscription", () => {
  it("stores this device for the signed-in staff member, once per endpoint", async () => {
    const end = endpoint();
    expect(await saveSubscription(a.staff, { endpoint: end, keys })).toEqual({ ok: true });
    const newKeys = { ...keys, p256dh: `B${"C".repeat(86)}` };
    expect(await saveSubscription(a.staff, { endpoint: end, keys: newKeys })).toEqual({ ok: true });
    expect(await rowsFor(end)).toEqual([{ clinic_id: a.staff.clinicId, user_id: a.staff.userId, p256dh: newKeys.p256dh }]);
    expect(await deleteSubscription(a.staff, end)).toEqual({ ok: true });
  });

  it("refuses an endpoint that is not a push service", async () => {
    const result = await saveSubscription(a.staff, { endpoint: "https://evil.example/push", keys });
    expect(result.ok).toBe(false);
    expect(await rowsFor("https://evil.example/push")).toEqual([]);
  });

  it("keeps each clinic's subscriptions to itself (RLS)", async () => {
    const end = endpoint();
    await saveSubscription(a.staff, { endpoint: end, keys });
    const { error } = await a.staff.db
      .from("push_subscriptions")
      .insert({ clinic_id: b.staff.clinicId, user_id: a.staff.userId, endpoint: endpoint(), ...keys });
    expect(error).not.toBeNull();
    const { data: seen } = await b.staff.db.from("push_subscriptions").select("id").eq("endpoint", end);
    expect(seen).toEqual([]);
    expect(await deleteSubscription(b.staff, end)).toEqual({ ok: true });
    expect(await rowsFor(end)).toHaveLength(1);
    expect(await deleteSubscription(a.staff, end)).toEqual({ ok: true });
    expect(await rowsFor(end)).toEqual([]);
  });
});

describe("sendPush", () => {
  it("counts accepted pushes, deletes 404 and 410 subscriptions, and keeps the rest", async () => {
    const [ok, gone, missing, down] = [endpoint(), endpoint(), endpoint(), endpoint()];
    await db
      .from("push_subscriptions")
      .insert([ok, gone, missing, down].map((e) => ({ clinic_id: b.staff.clinicId, user_id: b.staff.userId, endpoint: e, ...keys })))
      .throwOnError();
    const bodies: string[] = [];
    const send: PushSend = async (sub, body) => {
      bodies.push(body);
      if (sub.endpoint === gone) throw Object.assign(new Error("Gone"), { statusCode: 410 });
      if (sub.endpoint === missing) throw Object.assign(new Error("Not found"), { statusCode: 404 });
      if (sub.endpoint === down) throw Object.assign(new Error("Server error"), { statusCode: 500 });
      return { statusCode: 201 };
    };
    expect(await sendPush(b.staff.clinicId, payload, send)).toBe(1);
    expect(bodies).toEqual(Array(4).fill(JSON.stringify(payload)));
    expect(await rowsFor(ok)).toHaveLength(1);
    expect(await rowsFor(down)).toHaveLength(1);
    expect(await rowsFor(gone)).toEqual([]);
    expect(await rowsFor(missing)).toEqual([]);
  });

  it("delivers to nobody without a sender or without subscriptions", async () => {
    expect(await sendPush(a.staff.clinicId, payload, null)).toBe(0);
    expect(await sendPush(a.staff.clinicId, payload, async () => ({}))).toBe(0);
  });
});
