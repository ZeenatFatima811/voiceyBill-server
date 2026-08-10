/**
 * Applies pending Drizzle migrations during a PRODUCTION deploy.
 *
 * Wired into `vercel-build`, not `build`. Vercel prefers a `vercel-build` script
 * when one exists, while CI keeps running plain `build` — which matters, because
 * CI has no database and a migrate step in `build` would fail every pull request.
 *
 * Why this exists at all: migrations were a manual step, and it went wrong once
 * already. Migration 0002 was missing from the production database for a while,
 * which meant the `set_updated_at` trigger was still overwriting
 * application-supplied timestamps with the database clock — the exact bug 0002
 * was written to fix. Nothing detected it; someone noticed.
 *
 * Deliberately narrow. It runs only when all of these hold:
 *
 *   • VERCEL_ENV is "production" — preview and development deploys share the
 *     project's environment variables unless they are scoped per-environment, so
 *     without this check a preview build of any branch would migrate the
 *     production database. That is the failure mode this guard exists for.
 *   • a connection string is present.
 *
 * Otherwise it exits 0 and says why. A skip must never fail a build; a genuine
 * migration failure must always fail it, so the deploy stops rather than serving
 * an application whose schema does not match its code.
 */
import { spawnSync } from "node:child_process";

const log = (message) => process.stdout.write(`[deploy-migrate] ${message}\n`);

const vercelEnv = process.env.VERCEL_ENV;

/**
 * `DIRECT_DATABASE_URL` first, matching drizzle.config.ts: DDL must not go
 * through a transaction-mode pooler, where statements can land on different
 * backends and the advisory lock that stops two concurrent deploys applying the
 * same migration is held per connection and silently lost.
 */
const url = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;

if (vercelEnv && vercelEnv !== "production") {
  log(`skipped — VERCEL_ENV is "${vercelEnv}", migrations run on production only.`);
  process.exit(0);
}

if (!url) {
  // Local `npm run vercel-build` and any environment without a database
  // configured. Not an error: there is nothing to migrate against.
  log("skipped — neither DIRECT_DATABASE_URL nor DATABASE_URL is set.");
  process.exit(0);
}

if (/-pooler\./.test(url)) {
  log(
    "WARNING: migrating through a POOLED connection. Set DIRECT_DATABASE_URL to " +
      "the non-pooler hostname.",
  );
}

log("applying pending migrations from drizzle/ …");

const result = spawnSync("npx", ["drizzle-kit", "migrate"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: process.env,
});

if (result.error) {
  log(`FAILED to start drizzle-kit: ${result.error.message}`);
  process.exit(1);
}

if (result.status !== 0) {
  log(
    `FAILED — drizzle-kit exited ${result.status}. The deploy is being stopped ` +
      "on purpose: shipping code against a schema it does not match is worse " +
      "than not shipping.",
  );
  process.exit(result.status ?? 1);
}

log("migrations up to date.");
