import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  // Used only by `npm run db:migrate`, against the production Postgres. PGlite migrates itself (src/db/index.ts).
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
