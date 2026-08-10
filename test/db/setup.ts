/**
 * Environment for the repository integration checks.
 *
 * Imported FIRST by repositories.spec.ts, and nothing else may be imported
 * before it. `src/config/env.config.ts` builds `Env` at import time and
 * `getEnv` throws on a variable with no default, so anything that pulls in the
 * database client transitively requires these to already be set.
 *
 * This lives in its own module rather than as statements at the top of the spec
 * because TypeScript compiles `import` to `require` and hoists all of them
 * above any plain statement — so assignments written above the imports would
 * run too late to matter. An import cannot be hoisted above another import.
 */

/**
 * Fixed timezone.
 *
 * Postgres returns `timestamptz` normalised to UTC, and several assertions
 * compare a Date built in JS against a value that made a round trip. Left to
 * the machine's local zone, the same check would pass in London and fail in
 * Karachi.
 */
process.env.TZ = "UTC";

process.env.NODE_ENV ??= "test";

/** Defaults to the local dev Postgres from docker-compose. */
process.env.DATABASE_URL ??=
  "postgresql://voiceybill:voiceybill@localhost:5432/voiceybill";

process.env.JWT_SECRET ??= "db-check-jwt-secret";
process.env.OPENAI_API_KEY ??= "db-check-openai-key";
process.env.UPLIFT_AI_API_KEY ??= "db-check-uplift-key";
process.env.GEMINI_API_KEY ??= "db-check-gemini-key";
process.env.CLOUDINARY_CLOUD_NAME ??= "db-check-cloud";
process.env.CLOUDINARY_API_KEY ??= "db-check-cloud-key";
process.env.CLOUDINARY_API_SECRET ??= "db-check-cloud-secret";
process.env.RESEND_API_KEY ??= "db-check-resend-key";
process.env.GOOGLE_CLIENT_ID ??= "db-check-google-client-id";

export {};
