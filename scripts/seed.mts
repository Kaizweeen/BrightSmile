import { ready } from "@/db";
import { seed } from "@/server/seed";

// Spec 15: development data only, and only in a PGlite folder, never a real Postgres.
const url = process.env.DATABASE_URL || "pglite:.data/dev";
if (process.env.NODE_ENV === "production" || !url.startsWith("pglite:") || url === "pglite:memory") {
  console.error("npm run seed only fills a development database (DATABASE_URL=pglite:<folder>).");
  process.exit(1);
}

try {
  await ready();
  const { password, accounts } = await seed();
  console.log(`Development data is ready in ${url.slice("pglite:".length)}. Sign in with any of these usernames:`);
  for (const line of accounts) console.log(`  ${line}`);
  console.log(`Every account uses the password ${password} (shown only now).`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
