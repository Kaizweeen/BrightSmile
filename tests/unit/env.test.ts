import { describe, expect, it } from "vitest";
import { assertEnv, envProblems, MAX_APP_HOST } from "@/lib/env";

const dev = {
  NODE_ENV: "development",
  NEXT_PUBLIC_SUPABASE_URL: "https://dev.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
  SUPABASE_SECRET_KEY: "sb_secret_x",
  APP_SECRET: "a".repeat(43),
};
const production = {
  ...dev,
  NODE_ENV: "production",
  VERCEL_ENV: "production",
  APP_URL: "https://brightsmile.ph",
  CRON_SECRET: "c".repeat(43),
  SMS_MODE: "live",
  SEMAPHORE_API_KEY: "semaphore-key",
  SEMAPHORE_SENDER_NAME: "BrightSmile",
  SMS_LOW_CREDIT_THRESHOLD: "500",
  OPERATOR_MOBILE: "0917 123 4567",
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: "vapid-public",
  VAPID_PRIVATE_KEY: "vapid-private",
  VAPID_SUBJECT: "mailto:hello@brightsmile.ph",
  NEXT_PUBLIC_CONTACT_EMAIL: "hello@brightsmile.ph",
  OPERATOR_EMAILS: "kai@example.com",
  BILLING_GCASH_NAME: "Kai B.",
  BILLING_GCASH_NUMBER: "0917 555 0101",
};

describe("envProblems", () => {
  it("accepts a complete development and a complete production environment", () => {
    expect(envProblems(dev)).toEqual([]);
    expect(envProblems({ ...dev, APP_URL: "http://localhost:3600" })).toEqual([]);
    expect(envProblems(production)).toEqual([]);
  });

  it("names every missing variable", () => {
    expect(envProblems({})).toEqual([
      "NEXT_PUBLIC_SUPABASE_URL is not set",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set",
      "SUPABASE_SECRET_KEY is not set",
      "APP_SECRET is not set",
    ]);
    const { VAPID_PRIVATE_KEY, OPERATOR_MOBILE, ...missing } = production;
    void VAPID_PRIVATE_KEY;
    void OPERATOR_MOBILE;
    expect(envProblems(missing)).toEqual(["OPERATOR_MOBILE is not set", "VAPID_PRIVATE_KEY is not set"]);
    expect(envProblems({ ...production, APP_SECRET: "   " })).toEqual(["APP_SECRET is not set"]);
  });

  it("needs APP_URL on every production build, previews included", () => {
    expect(envProblems({ ...dev, NODE_ENV: "production", VERCEL_ENV: "preview" })).toEqual(["APP_URL is not set"]);
  });

  it(`refuses an APP_URL host longer than ${MAX_APP_HOST} characters, except on previews`, () => {
    expect(envProblems({ ...production, APP_URL: "https://brightsmileapp.ph" })).toEqual([]); // 17
    const long = "https://brightsmile-clinic.ph"; // 21
    expect(envProblems({ ...production, APP_URL: long })).toEqual([
      "APP_URL's host is longer than 17 characters, which would split texts into 2 parts",
    ]);
    expect(envProblems({ ...dev, APP_URL: long })).toHaveLength(1);
    expect(envProblems({ ...dev, NODE_ENV: "production", VERCEL_ENV: "preview", APP_URL: "https://brightsmile-git-main-kai.vercel.app" })).toEqual([]);
  });

  it("refuses an APP_URL that is not a bare origin, or not https in production", () => {
    const origin = "APP_URL must be an origin like https://brightsmile.ph, with no path and no trailing slash";
    expect(envProblems({ ...production, APP_URL: "https://brightsmile.ph/" })).toEqual([origin]);
    expect(envProblems({ ...production, APP_URL: "https://brightsmile.ph/app" })).toEqual([origin]);
    expect(envProblems({ ...production, APP_URL: "brightsmile.ph" })).toEqual([origin]);
    expect(envProblems({ ...production, APP_URL: "http://brightsmile.ph" })).toEqual(["APP_URL must use https in production"]);
  });

  it("refuses log mode in production", () => {
    expect(envProblems({ ...production, SMS_MODE: "log" })).toEqual(["SMS_MODE is not live in production"]);
    expect(envProblems({ ...dev, SMS_MODE: "log" })).toEqual([]);
  });

  it("checks formats without repeating the values", () => {
    const bad = {
      ...production,
      CRON_SECRET: "short-secret",
      APP_SECRET: "tiny-app-secret",
      OPERATOR_MOBILE: "028123456",
      SMS_LOW_CREDIT_THRESHOLD: "lots",
      SEMAPHORE_SENDER_NAME: "BrightSmileClinic",
    };
    const problems = envProblems(bad);
    expect(problems).toEqual([
      "CRON_SECRET must be at least 16 characters",
      "APP_SECRET must be at least 32 characters in production",
      "OPERATOR_MOBILE must be a Philippine mobile number",
      "SMS_LOW_CREDIT_THRESHOLD must be a whole number",
      "SEMAPHORE_SENDER_NAME must be at most 11 characters",
    ]);
    for (const value of ["short-secret", "tiny-app-secret", "028123456", "lots", "BrightSmileClinic"]) {
      expect(problems.join("\n")).not.toContain(value);
    }
  });
});

describe("billing variables", () => {
  it("requires the operator emails and the GCash details in production only", () => {
    const { OPERATOR_EMAILS, BILLING_GCASH_NAME, BILLING_GCASH_NUMBER, ...missing } = production;
    void OPERATOR_EMAILS;
    void BILLING_GCASH_NAME;
    void BILLING_GCASH_NUMBER;
    expect(envProblems(missing)).toEqual(["OPERATOR_EMAILS is not set", "BILLING_GCASH_NAME is not set", "BILLING_GCASH_NUMBER is not set"]);
    expect(envProblems(dev)).toEqual([]);
  });

  it("wants both PayMongo keys or neither, everywhere", () => {
    const both = "PAYMONGO_SECRET_KEY and PAYMONGO_WEBHOOK_SECRET must be set together, or neither";
    expect(envProblems({ ...dev, PAYMONGO_SECRET_KEY: "sk_test_abc" })).toEqual([both]);
    expect(envProblems({ ...production, PAYMONGO_WEBHOOK_SECRET: "whsk_abc" })).toEqual([both]);
    expect(envProblems({ ...production, PAYMONGO_SECRET_KEY: "sk_live_abc", PAYMONGO_WEBHOOK_SECRET: "whsk_abc" })).toEqual([]);
  });

  it("refuses a PayMongo test key in production only, without repeating it", () => {
    const testKey = { PAYMONGO_SECRET_KEY: " sk_test_4b2f1c9e ", PAYMONGO_WEBHOOK_SECRET: "whsk_abc" };
    const problems = envProblems({ ...production, ...testKey });
    expect(problems).toEqual(["PAYMONGO_SECRET_KEY must be a live key in production, not a test key"]);
    expect(problems.join(" ")).not.toContain("4b2f1c9e");
    expect(envProblems({ ...dev, ...testKey })).toEqual([]);
    expect(envProblems({ ...dev, NODE_ENV: "production", VERCEL_ENV: "preview", APP_URL: "https://bsmile.vercel.app", ...testKey })).toEqual([]);
  });

  it("checks the formats without repeating the values", () => {
    const problems = envProblems({ ...production, OPERATOR_EMAILS: "kai@example.com, not-an-email", BILLING_GCASH_NUMBER: "12345" });
    expect(problems).toEqual([
      "OPERATOR_EMAILS must be email addresses separated by commas",
      "BILLING_GCASH_NUMBER must be a Philippine mobile number",
    ]);
    expect(problems.join(" ")).not.toContain("not-an-email");
    expect(problems.join(" ")).not.toContain("12345");
  });

  it("refuses an OPERATOR_EMAILS value that lists no addresses", () => {
    for (const empty of [",", " , ,"]) {
      expect(envProblems({ ...production, OPERATOR_EMAILS: empty })).toEqual(["OPERATOR_EMAILS lists no email addresses"]);
      expect(envProblems({ ...dev, OPERATOR_EMAILS: empty })).toEqual(["OPERATOR_EMAILS lists no email addresses"]);
    }
  });
});

describe("assertEnv", () => {
  it("throws one error listing every problem, and passes a good environment", () => {
    expect(() => assertEnv({})).toThrow(/^BrightSmile environment check failed:\n- NEXT_PUBLIC_SUPABASE_URL is not set\n- /);
    expect(() => assertEnv(production)).not.toThrow();
  });
});
