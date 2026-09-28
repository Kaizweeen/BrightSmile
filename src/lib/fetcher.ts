export type ErrorBody = {
  code: string;
  message: string;
  fields?: Record<string, string>;
  conflicts?: unknown[];
  warnings?: { code: string; message: string }[];
  requestId?: string;
};

export class RequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: ErrorBody,
  ) {
    super(body.message);
    this.name = "RequestError";
  }
}

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

/** Calls DentaSync's own API. Writes always send JSON, which the server requires. */
export async function api<T = unknown>(path: string, init: { method?: Method; body?: unknown } = {}): Promise<T> {
  const method = init.method ?? "GET";
  const res = await fetch(
    `/api/v1${path}`,
    method === "GET"
      ? { cache: "no-store" }
      : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(init.body ?? {}) },
  );
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const body = (data as { error?: ErrorBody } | null)?.error;
    throw new RequestError(res.status, body ?? { code: "server_error", message: "Something went wrong. Try again." });
  }
  return data as T;
}

/** The message to show for a failed call. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Try again.";
}

/** Field errors from a failed call, keyed by field name. */
export function fieldErrors(error: unknown): Record<string, string> {
  return error instanceof RequestError ? (error.body.fields ?? {}) : {};
}
