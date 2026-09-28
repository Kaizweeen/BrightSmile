import { mkdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { drizzle as drizzlePostgres } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { Pool } from "pg";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
type Connection = { db: Db; ready: Promise<void> };

/**
 * DATABASE_URL picks the database: "pglite:memory" (tests), "pglite:<folder>" (development, the default), or a
 * postgres:// URL (production). PGlite runs inside this process and migrates itself; a real Postgres is migrated with
 * `npm run db:migrate`.
 */
function connect(url = process.env.DATABASE_URL || "pglite:.data/dev"): Connection {
  if (!url.startsWith("pglite:")) {
    const db = drizzlePostgres(new Pool({ connectionString: url, max: 5 }), { schema });
    return { db: db as unknown as Db, ready: Promise.resolve() };
  }
  const target = url.slice("pglite:".length);
  if (target !== "memory") mkdirSync(target, { recursive: true });
  const client =
    target === "memory"
      ? new PGlite({ extensions: { btree_gist } })
      : new PGlite(target, { extensions: { btree_gist } });
  const db = drizzlePglite(client, { schema });
  const ready = (async () => {
    await client.exec("set time zone 'UTC'");
    await migrate(db, { migrationsFolder: "./drizzle" });
  })();
  return { db: db as unknown as Db, ready };
}

// One connection per process, kept across hot reloads. It opens on first use, never at import, so `next build`
// (which imports every route) never opens the development database.
const cache = globalThis as unknown as { __dentasync?: Connection };
const current = (): Connection => (cache.__dentasync ??= connect());

export const db: Db = new Proxy({} as Db, {
  get(_target, property) {
    const real = current().db as unknown as Record<PropertyKey, unknown>;
    const value = Reflect.get(real, property, real);
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(real) : value;
  },
});

/** Resolves once the database is ready: migrated (PGlite) or at once (Postgres). */
export function ready(): Promise<void> {
  return current().ready;
}
