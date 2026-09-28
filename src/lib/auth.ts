import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware, getIP } from "better-auth/api";
import { username } from "better-auth/plugins/username";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, auditLog, rateLimits, sessions, users, verifications } from "@/db/schema";
import { appUrl } from "@/lib/env";

/** One working day (spec 6.7). Sessions are never extended by activity. */
export const SESSION_SECONDS = 12 * 60 * 60;

export const auth = betterAuth({
  appName: "DentaSync",
  baseURL: appUrl(),
  // Production refuses to start without BETTER_AUTH_SECRET (src/lib/env.ts); this default only serves development.
  secret: process.env.BETTER_AUTH_SECRET || "development-only-secret-do-not-use-in-production",
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user: users, session: sessions, account: accounts, verification: verifications, rateLimit: rateLimits },
  }),
  // Accounts are created only by /setup and the join QR (src/server/setup.ts, src/server/staff.ts).
  emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 10, maxPasswordLength: 128 },
  plugins: [username()],
  // Better Auth refuses a user table with required columns it does not know. These two are DentaSync's, and only our
  // own code (src/server/accounts.ts) writes them.
  user: { additionalFields: { role: { type: "string", input: false }, status: { type: "string", input: false } } },
  session: { expiresIn: SESSION_SECONDS, disableSessionRefresh: true },
  databaseHooks: {
    session: {
      create: {
        // A disabled account cannot sign in (spec 6.5). A pending one can, to see the waiting page.
        before: async (session) => {
          const [user] = await db.select({ status: users.status }).from(users).where(eq(users.id, session.userId));
          return user?.status === "disabled" ? false : undefined;
        },
      },
    },
  },
  hooks: {
    // Spec 13: every sign-in is audited, a failed one with the username tried (never the password).
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-in/username") return;
      const user = ctx.context.newSession?.user;
      const from = ctx.request ?? ctx.headers;
      const ip = from ? getIP(from, ctx.context.options) : null;
      await db.insert(auditLog).values({
        userId: user?.id ?? null,
        action: user ? "auth.signed_in" : "auth.sign_in_failed",
        entity: "user",
        entityId: user?.id ?? null,
        details: user ? { ip } : { ip, username: String(ctx.body?.username ?? "").trim().toLowerCase().slice(0, 30) },
      });
    }),
  },
  rateLimit: { storage: "database", customRules: { "/sign-in/username": { window: 15 * 60, max: 10 } } },
  disabledPaths: ["/sign-up/email", "/sign-in/email", "/update-user", "/is-username-available"],
  advanced: { database: { generateId: "uuid" } },
  telemetry: { enabled: false },
});
