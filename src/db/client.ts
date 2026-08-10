/**
 * Postgres connection, shaped for the same serverless constraints that
 * `src/config/database.config.ts` handles for Mongo.
 *
 * The app runs as a Vercel function (see vercel.json), so this module must:
 *
 *  • Reuse one pool across invocations. Module scope survives between warm
 *    invocations of the same instance, so the pool is cached there rather than
 *    rebuilt per request.
 *  • Keep the per-instance pool SMALL. Postgres connections are a fixed global
 *    resource, unlike Mongo's. Many concurrent function instances each holding
 *    a large pool is the classic way to exhaust a Postgres server, so the
 *    per-instance cap is deliberately low and the real multiplexing is left to
 *    the server-side pooler.
 *  • Disable prepared statements. Neon's pooled endpoint and PgBouncer both run
 *    in transaction pooling mode, where a prepared statement created on one
 *    backend is not visible on the next — `prepare: false` is required, not an
 *    optimisation.
 */
import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { Env } from "../config/env.config";

import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

let sqlClient: postgres.Sql | null = null;
let database: Database | null = null;

const isServerless = Boolean(process.env.VERCEL);

const createClient = (): postgres.Sql =>
  postgres(Env.DATABASE_URL, {
    /**
     * One connection per function instance in serverless. Concurrency there
     * comes from Vercel running many instances, not from a deep pool inside
     * one; a pool of 10 per instance multiplied by the instance count is what
     * exhausts the server.
     */
    max: isServerless ? 1 : 10,

    /**
     * Return connections to the pooler while an instance is frozen between
     * requests. Without this a warm-but-idle instance holds a backend open
     * indefinitely.
     */
    idle_timeout: isServerless ? 20 : 0,

    /** Recycle connections so a pooler restart cannot leave a stale socket. */
    max_lifetime: 60 * 30,

    connect_timeout: 10,

    // Required for transaction-mode poolers — see the note above.
    prepare: false,

    /**
     * Return bigint columns as JS numbers. Money is stored as integer cents, so
     * values stay far inside Number.MAX_SAFE_INTEGER, and the mappers and every
     * existing API response already treat amounts as `number`. Left as the
     * default, postgres.js would hand back strings and every arithmetic
     * operation in the analytics layer would silently concatenate instead.
     */
    types: {
      bigint: postgres.BigInt,
    },

    onnotice: () => {},
  });

/**
 * The shared Drizzle instance.
 *
 * Lazy rather than created at module load: `src/main.ts` is imported by the
 * test harness, which stubs the database layer out entirely, and eagerly
 * dialling Postgres at import time would make every test run require a live
 * server.
 */
export const getDb = (): Database => {
  if (!database) {
    sqlClient = createClient();
    database = drizzle(sqlClient, { schema });
  }
  return database;
};

/**
 * Verifies the connection is usable.
 *
 * Replaces `connctDatabase()`. There is no retry loop here on purpose: the
 * Mongo version retried five times with a 5s sleep, which on a cold serverless
 * start could burn 25 seconds of a 60 second budget before failing. postgres.js
 * already retries at the socket level, and a pooled Postgres endpoint either
 * answers quickly or is genuinely down.
 */
export const verifyConnection = async (): Promise<void> => {
  const db = getDb();
  await db.execute(sql`select 1`);
};

/** Closes the pool. Used by tests and by graceful shutdown; a no-op if unopened. */
export const closeDb = async (): Promise<void> => {
  if (sqlClient) {
    await sqlClient.end({ timeout: 5 });
    sqlClient = null;
    database = null;
  }
};
