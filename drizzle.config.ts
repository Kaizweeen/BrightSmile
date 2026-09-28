import { defineConfig } from "drizzle-kit";

// `npm run db:generate` writes migrations from src/db/schema.ts. `npm run db:migrate` applies them to the Postgres in
// DATABASE_URL (production). PGlite databases migrate themselves when the app starts (src/db/index.ts).
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  ...(process.env.DATABASE_URL?.startsWith("postgres") ? { dbCredentials: { url: process.env.DATABASE_URL } } : {}),
});
