import "server-only";

/**
 * The app's own base URL (used in links inside texts and emails), never with a trailing slash.
 * Missing in production is a misconfiguration, not something to paper over with localhost.
 */
export function appUrl(): string {
  const raw = process.env.APP_URL;
  if (raw) return raw.replace(/\/+$/, "");
  if (process.env.NODE_ENV === "production") throw new Error("APP_URL is not set");
  return "http://localhost:3600";
}
