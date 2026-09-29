import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware, getIP } from "better-auth/api";
import { USERNAME_ERROR_CODES, username } from "better-auth/plugins/username";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, rateLimits, sessions, users, verifications } from "@/db/schema";
import { appUrl } from "@/lib/env";
import { audit } from "@/server/audit";

/** One working day (spec 6.7). Sessions are never extended by activity. */
export const SESSION_SECONDS = 12 * 60 * 60;

/**
 * The header the host sets to the visitor's address and never takes from the visitor, for the sign-in and join limits:
 * Vercel's x-real-ip, or else Netlify's x-nf-client-connection-ip (spec 16). CLIENT_IP_HEADER names it on another host.
 */
const CLIENT_IP_HEADER = process.env.CLIENT_IP_HEADER || (process.env.VERCEL ? "x-real-ip" : "x-nf-client-connection-ip");

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
        // A disabled account cannot sign in (spec 6.5), nor a join request older than 7 days (spec 6.3), and both are
        // refused like a wrong password, so the answer never confirms their password. A pending one can, to see the
        // waiting page. No session outlives 12 hours, not even one asked for with rememberMe: false (spec 6.7).
        before: async (session) => {
          const [user] = await db.select({ status: users.status, createdAt: users.createdAt }).from(users).where(eq(users.id, session.userId));
          const expired = user?.status === "pending" && user.createdAt.getTime() < Date.now() - 7 * 86_400_000;
          if (user?.status === "disabled" || expired) throw APIError.from("UNAUTHORIZED", USERNAME_ERROR_CODES.INVALID_USERNAME_OR_PASSWORD);
          return { data: { expiresAt: new Date(Math.min(session.expiresAt.getTime(), Date.now() + SESSION_SECONDS * 1000)) } };
        },
      },
    },
  },
  hooks: {
    // Spec 13: every sign-in and password change is audited. A failed sign-in keeps the username tried only when it
    // names an account, so a password typed into the username field is never stored.
    after: createAuthMiddleware(async (ctx) => {
      const from = ctx.request ?? ctx.headers;
      const ip = from ? getIP(from, ctx.context.options) : null;
      if (ctx.path === "/sign-in/username") {
        const user = ctx.context.newSession?.user;
        if (user) {
          await audit({ userId: user.id, action: "auth.signed_in", entity: "user", entityId: user.id, details: { ip } });
          return;
        }
        const tried = String(ctx.body?.username ?? "").trim().toLowerCase();
        const [account] = tried ? await db.select({ id: users.id }).from(users).where(eq(users.username, tried)) : [];
        await audit({
          userId: null,
          action: "auth.sign_in_failed",
          entity: "user",
          entityId: account?.id ?? null,
          details: { ip, username: account ? tried : null },
        });
      }
      if (ctx.path === "/change-password") {
        const done = ctx.context.returned as { user?: { id?: string } } | undefined;
        const userId = done instanceof APIError ? undefined : done?.user?.id;
        if (userId) await audit({ userId, action: "auth.password_changed", entity: "user", entityId: userId, details: { ip } });
      }
    }),
  },
  // Per IP address (spec 6.7). A branch's staff often share one address, so 30 tries in 15 minutes.
  rateLimit: { storage: "database", customRules: { "/sign-in/username": { window: 15 * 60, max: 30 } } },
  disabledPaths: ["/sign-up/email", "/sign-in/email", "/update-user", "/is-username-available"],
  advanced: { database: { generateId: "uuid" }, ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] } },
  telemetry: { enabled: false },
});
