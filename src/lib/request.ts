/**
 * The client's address for rate limits: the first entry of x-forwarded-for. Vercel sets this header
 * and overwrites any value the client sent, so it can be trusted there.
 */
export function clientIp(forwardedFor: string | null): string {
  const first = forwardedFor?.split(",")[0]?.trim();
  return first ? first.slice(0, 64) : "unknown";
}
