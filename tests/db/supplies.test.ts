import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as supplyRoute from "@/app/api/v1/supplies/[id]/route";
import * as suppliesRoute from "@/app/api/v1/supplies/route";
import { db } from "@/db";
import { auditLog, supplies } from "@/db/schema";
import { call, makeBranch, makeUser, request, signIn } from "../helpers";

async function build() {
  const a = await makeBranch({ code: "supply-a" });
  const b = await makeBranch({ code: "supply-b" });
  const as = async (role: "owner" | "manager" | "dentist", branchIds: string[]) => signIn((await makeUser({ role, branchIds })).username);
  return { a, b, owner: await as("owner", []), manager: await as("manager", [a.id]), dentist: await as("dentist", [a.id]) };
}
let worldPromise: ReturnType<typeof build> | undefined;
const world = () => (worldPromise ??= build());

const add = (cookie: string, body: Record<string, unknown>) => call(suppliesRoute.POST, request("/api/v1/supplies", { method: "POST", cookie, body }));
const patch = (cookie: string, id: string, body: Record<string, unknown>) =>
  call(supplyRoute.PATCH, request(`/api/v1/supplies/${id}`, { method: "PATCH", cookie, body }), { id });
const list = (cookie: string, branch: string) => call(suppliesRoute.GET, request(`/api/v1/supplies?branch=${branch}`, { cookie }));

describe("supplies", () => {
  it("lets a manager add a supply, count stock in and out, and logs each change", async () => {
    const w = await world();
    const res = await add(w.manager, { branch: "supply-a", name: " Gloves (M) ", unit: "box", quantity: 10, reorderLevel: 3 });
    expect(res.status).toBe(201);
    const { id } = await res.json();
    expect((await (await patch(w.manager, id, { adjust: -4 })).json()).quantity).toBe(6);
    expect((await (await patch(w.manager, id, { adjust: 20 })).json()).quantity).toBe(26);
    const [row] = await db.select().from(supplies).where(eq(supplies.id, id));
    expect(row).toMatchObject({ name: "Gloves (M)", quantity: 26, branchId: w.a.id });
    expect((await db.select().from(auditLog).where(eq(auditLog.entityId, id))).map((e) => e.action)).toEqual(["supply.created", "supply.updated", "supply.updated"]);
  });

  it("refuses to take out more than is in stock, and leaves the count alone", async () => {
    const w = await world();
    const { id } = await (await add(w.owner, { branch: "supply-a", name: "Anaesthetic", quantity: 2 })).json();
    const res = await patch(w.owner, id, { adjust: -3 });
    expect(res.status).toBe(422);
    expect((await res.json()).error.fields.adjust).toBe("Only 2 pcs in stock.");
    expect((await db.select().from(supplies).where(eq(supplies.id, id)))[0].quantity).toBe(2);
  });

  it("does not allow the same name twice in a branch, but allows it in another", async () => {
    const w = await world();
    expect((await add(w.owner, { branch: "supply-a", name: "Floss" })).status).toBe(201);
    expect((await add(w.owner, { branch: "supply-a", name: "FLOSS" })).status).toBe(409);
    expect((await add(w.owner, { branch: "supply-b", name: "Floss" })).status).toBe(201);
  });

  it("lets a dentist look but not change, and hides a branch from staff who do not cover it", async () => {
    const w = await world();
    const { id } = await (await add(w.owner, { branch: "supply-a", name: "Cotton rolls" })).json();
    expect((await list(w.dentist, "supply-a")).status).toBe(200);
    expect((await patch(w.dentist, id, { adjust: 1 })).status).toBe(403);
    expect((await add(w.dentist, { branch: "supply-a", name: "Nope" })).status).toBe(403);
    expect((await list(w.manager, "supply-b")).status).toBe(403);
    expect((await add(w.manager, { branch: "supply-b", name: "Nope" })).status).toBe(403);
    const other = await (await add(w.owner, { branch: "supply-b", name: "Bibs" })).json();
    expect((await patch(w.manager, other.id, { adjust: 1 })).status).toBe(404);
  });

  it("rejects fractions and an empty change", async () => {
    const w = await world();
    const { id } = await (await add(w.owner, { branch: "supply-a", name: "Burs" })).json();
    expect((await patch(w.owner, id, { adjust: 1.5 })).status).toBe(400);
    expect((await patch(w.owner, id, {})).status).toBe(400);
  });
});
