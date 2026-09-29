import { getIP } from "better-auth/api";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, z } from "zod";
import { auth } from "@/lib/auth";
import { appUrl } from "@/lib/env";
import { ApiError, loggable, pgCode, pgMessage } from "./errors";
import { staffFromHeaders, type Staff } from "./session";

type Params = Record<string, string>;

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

function errorBody(status: number, code: string, message: string, extra: Record<string, unknown> = {}): NextResponse {
  return NextResponse.json({ error: { code, message, ...extra } }, { status });
}

export function fieldErrors(error: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) fields[issue.path.join(".") || "_"] ??= issue.message;
  return fields;
}

/** Maps anything a handler throws to the error shape of spec section 12. */
export function toResponse(error: unknown): NextResponse {
  if (error instanceof ApiError) return errorBody(error.status, error.code, error.message, error.extra);
  if (error instanceof ZodError) {
    return errorBody(400, "invalid", "Check the highlighted fields.", { fields: fieldErrors(error) });
  }
  switch (pgCode(error)) {
    case "23P01":
      return errorBody(409, "conflict", "That time was just taken. Refresh and try again.");
    case "DS001":
      return errorBody(422, "status_change", pgMessage(error) ?? "That status change is not allowed.");
    case "DS002":
      return errorBody(422, "locked", "This record cannot be changed.");
    case "23505":
      return errorBody(409, "duplicate", "That already exists.");
    case "22P02":
      // Postgres refuses a text that is not a UUID where an id belongs.
      return errorBody(404, "not_found", "That was not found.");
  }
  const requestId = crypto.randomUUID();
  console.error(`Request ${requestId} failed:`, loggable(error));
  return errorBody(500, "server_error", `Something went wrong. Reference: ${requestId}`, { requestId });
}

/** Writes must come from DentaSync's own pages, as JSON (spec section 11). */
function refuseForeignWrite(req: NextRequest): NextResponse | null {
  if (req.method === "GET" || req.method === "HEAD") return null;
  if (req.headers.get("origin") !== new URL(appUrl()).origin) {
    return errorBody(403, "bad_origin", "This request did not come from DentaSync.");
  }
  if (!req.headers.get("content-type")?.startsWith("application/json")) {
    return errorBody(415, "not_json", "Send the request as JSON.");
  }
  return null;
}

/** A route for approved staff: checks the write, the session, and the account, and maps every error. */
export function staffRoute<P extends Params = Params>(
  handler: (req: NextRequest, staff: Staff, params: P) => Promise<Response>,
) {
  return async (req: NextRequest, ctx: { params: Promise<P> }): Promise<Response> => {
    const refused = refuseForeignWrite(req);
    if (refused) return refused;
    try {
      const staff = await staffFromHeaders(req.headers);
      if (!staff || staff.status === "disabled") return errorBody(401, "signed_out", "Sign in again.");
      if (staff.status !== "active") return errorBody(403, "pending", "Your account is waiting for approval.");
      return await handler(req, staff, await ctx.params);
    } catch (error) {
      return toResponse(error);
    }
  };
}

/** A route for the signed-out forms: setup, recovery, joining, and password reset. */
export function publicRoute<P extends Params = Params>(handler: (req: NextRequest, params: P) => Promise<Response>) {
  return async (req: NextRequest, ctx: { params: Promise<P> }): Promise<Response> => {
    const refused = refuseForeignWrite(req);
    if (refused) return refused;
    try {
      return await handler(req, await ctx.params);
    } catch (error) {
      return toResponse(error);
    }
  };
}

/** Parses the JSON body with a Zod schema. A bad body throws, and the route answers 400. */
export async function readJson<S extends z.ZodType>(req: NextRequest, schema: S): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiError(400, "invalid", "The request body is not valid JSON.");
  }
  return schema.parse(raw);
}

/** The caller's IP address for the join limit, read from the same header as the sign-in limit (src/lib/auth.ts). */
export function clientIp(req: NextRequest): string {
  return getIP(req, auth.options) ?? "unknown";
}
