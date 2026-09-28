/** An error a route answers with its own status and code (spec section 12). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const notFound = (what = "That") => new ApiError(404, "not_found", `${what} was not found.`);

export const forbidden = (message = "You do not have access to this.") => new ApiError(403, "forbidden", message);

type PgLike = { code?: unknown; message?: unknown; constraint?: unknown; cause?: unknown };

/** The Postgres error inside Drizzle's wrapper (DrizzleQueryError keeps it as `cause`). */
function pgError(error: unknown): PgLike | undefined {
  for (let e = error as PgLike | undefined; e; e = e.cause as PgLike | undefined) {
    if (!(e instanceof ApiError) && typeof e.code === "string") return e;
  }
  return undefined;
}

export function pgCode(error: unknown): string | undefined {
  const e = pgError(error);
  return typeof e?.code === "string" ? e.code : undefined;
}

export function pgMessage(error: unknown): string | undefined {
  const e = pgError(error);
  return typeof e?.message === "string" ? e.message : undefined;
}

export function pgConstraint(error: unknown): string | undefined {
  const e = pgError(error);
  return typeof e?.constraint === "string" ? e.constraint : undefined;
}
