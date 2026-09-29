import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { databaseSsl } from "../src/db/ssl";

// Applies drizzle/ to the production Postgres, as `drizzle-kit migrate` would, but says why when it fails (drizzle-kit
// exits silently on a wrong password or address). PGlite migrates itself (src/db/index.ts).
const url = process.env.DATABASE_URL;
if (!url?.startsWith("postgres")) {
  console.error("Set DATABASE_URL to the production Postgres address (postgresql://...) for this command.");
  process.exit(1);
}
const pool = new Pool({ connectionString: url, ssl: databaseSsl(url), max: 1 });
try {
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  console.log("The database is up to date.");
} catch (error) {
  // drizzle wraps the database's own error, which says what went wrong (a wrong password, an unknown project).
  const reason = error instanceof Error && error.cause instanceof Error ? error.cause : error;
  console.error("Migration failed:", reason instanceof Error ? reason.message : reason);
  process.exitCode = 1;
} finally {
  await pool.end();
}
