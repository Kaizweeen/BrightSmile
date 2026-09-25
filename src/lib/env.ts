import { normalizeMobile } from "@/lib/phone";
import { productionModeError, smsMode } from "@/lib/sms/prepare";

type Env = Record<string, string | undefined>;

/** Every text template fits 160 characters with an APP_URL host of at most this many characters (spec 10.1). */
export const MAX_APP_HOST = 17;

const ALWAYS = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY", "APP_SECRET"];
const LIVE = [
  "APP_URL",
  "CRON_SECRET",
  "SEMAPHORE_API_KEY",
  "SEMAPHORE_SENDER_NAME",
  "OPERATOR_MOBILE",
  "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "VAPID_SUBJECT",
  "NEXT_PUBLIC_CONTACT_EMAIL",
];

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** The development Supabase project, where the database and e2e tests create and delete data. */
const DEV_PROJECT_REF = "fmvqwojzsklinbdmfjkn";

/** What is wrong with the environment, by variable name and rule only: a value never appears, not even in part. */
export function envProblems(env: Env): string[] {
  const production = env.VERCEL_ENV === "production";
  const required = [...ALWAYS, ...(env.NODE_ENV === "production" ? ["APP_URL"] : []), ...(production ? LIVE : [])];
  const problems = [...new Set(required)].filter((name) => !env[name]?.trim()).map((name) => `${name} is not set`);

  if (env.APP_URL) {
    const url = parseUrl(env.APP_URL);
    if (!url || url.origin !== env.APP_URL) {
      problems.push("APP_URL must be an origin like https://brightsmile.ph, with no path and no trailing slash");
    } else {
      if (url.host.length > MAX_APP_HOST && env.VERCEL_ENV !== "preview") {
        problems.push(`APP_URL's host is longer than ${MAX_APP_HOST} characters, which would split texts into 2 parts`);
      }
      if (production && url.protocol !== "https:") problems.push("APP_URL must use https in production");
    }
  }
  if (production && env.NEXT_PUBLIC_SUPABASE_URL?.includes(DEV_PROJECT_REF)) {
    problems.push("NEXT_PUBLIC_SUPABASE_URL points at the development project; production needs its own");
  }
  const smsError = productionModeError(env.VERCEL_ENV, smsMode(env.SMS_MODE));
  if (smsError) problems.push(smsError);
  if (env.CRON_SECRET && env.CRON_SECRET.length < 16) problems.push("CRON_SECRET must be at least 16 characters");
  if (production && env.APP_SECRET?.trim() && env.APP_SECRET.length < 32) problems.push("APP_SECRET must be at least 32 characters in production");
  if (env.OPERATOR_MOBILE && !normalizeMobile(env.OPERATOR_MOBILE)) problems.push("OPERATOR_MOBILE must be a Philippine mobile number");
  if (env.SMS_LOW_CREDIT_THRESHOLD && !/^\d+$/.test(env.SMS_LOW_CREDIT_THRESHOLD.trim())) {
    problems.push("SMS_LOW_CREDIT_THRESHOLD must be a whole number");
  }
  if (env.SEMAPHORE_SENDER_NAME && env.SEMAPHORE_SENDER_NAME.length > 11) problems.push("SEMAPHORE_SENDER_NAME must be at most 11 characters");
  return problems;
}

/** Called once at server start (src/instrumentation.ts), so a misconfigured deployment fails loudly instead of misbehaving. */
export function assertEnv(env: Env): void {
  const problems = envProblems(env);
  if (problems.length > 0) throw new Error(`BrightSmile environment check failed:\n- ${problems.join("\n- ")}`);
}
