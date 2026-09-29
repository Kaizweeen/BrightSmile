type Env = Record<string, string | undefined>;

const REQUIRED_IN_PRODUCTION = ["DATABASE_URL", "BETTER_AUTH_SECRET", "APP_URL", "SETUP_TOKEN"];

/** What is wrong with the environment, by variable name only: a value never appears in a message. */
export function envProblems(env: Env): string[] {
  const production = env.NODE_ENV === "production";
  const problems = production
    ? REQUIRED_IN_PRODUCTION.filter((name) => !env[name]?.trim()).map((name) => `${name} is not set`)
    : [];
  if (production && env.DATABASE_URL?.startsWith("pglite:")) {
    problems.push("DATABASE_URL must be a Postgres URL in production");
  } else if (production && env.DATABASE_URL?.trim() && !URL.canParse(env.DATABASE_URL)) {
    // Caught here, by name: parsing it later would throw an error that quotes the whole address, password included.
    problems.push("DATABASE_URL is not a valid address: it should look like postgresql://user:password@host:6543/postgres");
  }
  if (env.NODE_ENV === "development" && env.DATABASE_URL && !env.DATABASE_URL.startsWith("pglite:")) {
    let host = "";
    try {
      host = new URL(env.DATABASE_URL).hostname;
    } catch {}
    if (host !== "localhost" && host !== "127.0.0.1") {
      problems.push("npm run dev runs only on PGlite or a Postgres on this computer: unset DATABASE_URL, which may point at the practice's data");
    }
  }
  if (env.BETTER_AUTH_SECRET && env.BETTER_AUTH_SECRET.length < 32) {
    problems.push("BETTER_AUTH_SECRET must be at least 32 characters");
  }
  if (env.SETUP_TOKEN && env.SETUP_TOKEN.length < 32) problems.push("SETUP_TOKEN must be at least 32 characters");
  if (env.APP_URL) {
    let url: URL | null;
    try {
      url = new URL(env.APP_URL);
    } catch {
      url = null;
    }
    if (!url || url.origin !== env.APP_URL) {
      problems.push("APP_URL must be an origin such as https://dentasync.example.com, with no path or trailing slash");
    } else if (production && url.protocol !== "https:" && url.hostname !== "localhost") {
      problems.push("APP_URL must use https in production");
    }
  }
  return problems;
}

/** Called once when the server starts (src/instrumentation.ts), so a broken deployment fails loudly. */
export function assertEnv(env: Env): void {
  const problems = envProblems(env);
  if (problems.length > 0) throw new Error(`DentaSync environment check failed:\n- ${problems.join("\n- ")}`);
}

/** The app's own origin: APP_URL, or the development default. */
export function appUrl(): string {
  return process.env.APP_URL || "http://localhost:3700";
}
