import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { db } from "@/db";
import { branches, userBranches, users, type OperatingHours } from "@/db/schema";
import { auth } from "@/lib/auth";
import { DEFAULT_HOURS } from "@/lib/hours";
import type { Role } from "@/lib/permissions";
import { randomToken } from "@/lib/tokens";
import { createCredentialUser } from "@/server/accounts";
import { staffById, type Staff } from "@/server/session";

export const PASSWORD = "correct horse battery";
const passwordHash = hashPassword(PASSWORD);
let seq = 0;

export async function makeBranch(opts: { code?: string; name?: string; hours?: OperatingHours } = {}) {
  seq += 1;
  const [row] = await db
    .insert(branches)
    .values({
      code: opts.code ?? `branch-${seq}`,
      name: opts.name ?? `Branch ${seq}`,
      operatingHours: opts.hours ?? DEFAULT_HOURS,
      joinCode: randomToken(16),
    })
    .returning();
  return row;
}

/** A staff member with the test password. Pending accounts get requestedBranchId; others get branchIds. */
export async function makeUser(opts: {
  role: Role;
  branchIds?: string[];
  seesPatients?: boolean;
  status?: "pending" | "active" | "disabled";
  requestedBranchId?: string;
  name?: string;
}): Promise<Staff> {
  seq += 1;
  const { id } = await createCredentialUser(
    {
      name: opts.name ?? `Test ${opts.role} ${seq}`,
      username: `${opts.role}.${seq}`,
      role: opts.role,
      status: opts.status ?? "active",
      seesPatients: opts.seesPatients ?? opts.role === "dentist",
      requestedBranchId: opts.requestedBranchId ?? null,
      primaryBranchId: opts.branchIds?.[0] ?? opts.requestedBranchId ?? null,
    },
    await passwordHash,
  );
  if (opts.branchIds?.length) {
    await db.insert(userBranches).values(opts.branchIds.map((branchId) => ({ userId: id, branchId })));
  }
  const staff = await staffById(id);
  if (!staff) throw new Error("makeUser: the user was not created");
  return staff;
}

/** Signs in through Better Auth and returns the session cookie ("name=value"). */
export async function signIn(username: string, password = PASSWORD): Promise<string> {
  const res = await auth.api.signInUsername({ body: { username, password }, returnHeaders: true });
  const cookie = res.headers.get("set-cookie");
  if (!cookie) throw new Error("signIn: no session cookie");
  return cookie.split(";")[0];
}

/** A request as the browser sends it: writes carry the app's Origin and JSON unless told otherwise. */
export function request(
  path: string,
  opts: { method?: string; body?: unknown; cookie?: string; origin?: string | null; contentType?: string } = {},
): NextRequest {
  const method = opts.method ?? "GET";
  const headers = new Headers();
  if (opts.cookie) headers.set("cookie", opts.cookie);
  if (method !== "GET") {
    if (opts.origin !== null) headers.set("origin", opts.origin ?? "http://localhost:3700");
    headers.set("content-type", opts.contentType ?? "application/json");
  }
  return new NextRequest(new URL(path, "http://localhost:3700"), {
    method,
    headers,
    body: method === "GET" ? undefined : JSON.stringify(opts.body ?? {}),
  });
}

/** Calls a route handler the way Next.js does. */
export function call<P extends Record<string, string>>(
  handler: (req: NextRequest, ctx: { params: Promise<P> }) => Promise<Response>,
  req: NextRequest,
  params: P = {} as P,
): Promise<Response> {
  return handler(req, { params: Promise.resolve(params) });
}

/** Reads a user row, for assertions. */
export async function userRow(id: string) {
  const [row] = await db.select().from(users).where(eq(users.id, id));
  return row;
}
