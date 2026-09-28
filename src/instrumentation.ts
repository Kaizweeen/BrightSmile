/** Runs once when the server starts: refuse a broken environment, and migrate PGlite before the first request. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertEnv } = await import("@/lib/env");
  assertEnv(process.env);
  const { ready } = await import("@/db");
  await ready();
}
