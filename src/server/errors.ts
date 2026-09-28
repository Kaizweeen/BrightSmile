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

type PgLike = { code?: unknown; message?: unknown; constraint?: unknown; table?: unknown; cause?: unknown };

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

/**
 * What an unexpected error may put in the logs (spec 12 and 13). A failed query's message, its values, and the row
 * Postgres quotes back can hold patient details or password hashes, so no message is kept: only the error's name, the
 * Postgres code, constraint, and table, the SQL text (its values are $1, $2, ...), and the stack's frames.
 */
export function loggable(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { name: typeof error };
  const pg = pgError(error);
  const header = `${error.name}: ${error.message}`;
  const query = (error as { query?: unknown }).query;
  return {
    name: error.name,
    code: pg?.code,
    constraint: pg?.constraint,
    table: pg?.table,
    query: typeof query === "string" ? query : undefined,
    frames: error.stack?.startsWith(header) ? error.stack.slice(header.length).trim() : undefined,
  };
}
