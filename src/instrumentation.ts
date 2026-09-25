/** Next calls register once when a server instance starts. A bad environment stops it there, naming variables only. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertEnv } = await import("@/lib/env");
  assertEnv(process.env);
}
