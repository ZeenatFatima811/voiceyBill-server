import "dotenv/config";
import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit reads the environment directly rather than going through
 * `src/config/env.config.ts`. The Env object is validated at import time and
 * pulls in the whole application config surface (JWT secrets, Cloudinary,
 * Resend, …), none of which a migration run should require.
 *
 * DIRECT_DATABASE_URL wins when set. Migrations are DDL, and DDL should not go
 * through a transaction-mode pooler: statements in one migration can land on
 * different backends, and advisory locks — which drizzle-kit uses to stop two
 * concurrent deploys applying the same migration — are held per connection and
 * would be silently lost. The runtime app is the opposite case and wants the
 * POOLED url; see src/db/client.ts.
 *
 * On Neon these are the same database, reachable at two hostnames: the pooled
 * one contains "-pooler", the direct one does not.
 */
const url = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;

if (!url) {
  throw new Error(
    "Neither DIRECT_DATABASE_URL nor DATABASE_URL is set. Copy .env.example to " +
      ".env, or start the local database with `docker compose up -d postgres`.",
  );
}

if (/-pooler\./.test(url)) {
  console.warn(
    "[drizzle] WARNING: migrating through a POOLED connection. Set " +
      "DIRECT_DATABASE_URL to the non-pooler hostname instead.",
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: { url },
  // Emit the generated SQL as it is applied; migrations against a hosted
  // database are much easier to audit when the statements are in the log.
  verbose: true,
  // Prompt before generating anything destructive.
  strict: true,
});
