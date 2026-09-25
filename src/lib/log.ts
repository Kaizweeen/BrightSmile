/** Where it failed and the error message only: never patient details, codes, secrets, or push addresses (spec 12). */
export function logError(where: string, e: unknown): void {
  console.error(`${where} failed:`, String((e as { message?: unknown } | null)?.message ?? e));
}
