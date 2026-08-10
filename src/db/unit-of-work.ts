/**
 * Transaction boundary — the replacement for `mongoose.startSession()` and
 * `session.withTransaction(...)`.
 *
 * Six paths depend on this: register, create-transaction, update-transaction,
 * delete-account, the recurring-transaction cron and the monthly report cron.
 * Each currently threads a `ClientSession` through every call it makes so the
 * reads and the writes commit together.
 *
 * Postgres makes this both simpler and stricter:
 *
 *  • Simpler, because a transaction is native rather than something that only
 *    works on a replica set. The comment in transaction.service.ts noting
 *    "Requires a replica set (all Atlas tiers)" stops being a caveat, and the
 *    local-development gap it caused disappears.
 *
 *  • Stricter, because a statement issued OUTSIDE the transaction while one is
 *    open runs on a different connection and will not see the uncommitted rows.
 *    Under mongoose, forgetting to pass `{ session }` silently degraded to a
 *    non-transactional read. Here it produces a visible wrong answer instead,
 *    which is why every repository function takes an `Executor`.
 */
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";

import { getDb, type Database } from "./client";
import type * as schema from "./schema";

/** An open transaction, as handed to the `db.transaction()` callback. */
export type Transaction = PgTransaction<
  PostgresJsQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

/**
 * Anything that can run a query.
 *
 * Every repository function accepts one of these and defaults to the shared
 * connection. Passing the active transaction is the equivalent of mongoose's
 * `{ session }`, and omitting it inside a transaction is the equivalent of
 * forgetting that option.
 */
export type Executor = Database | Transaction;

/** Resolves the executor to use, defaulting to the shared connection. */
export const executor = (given?: Executor): Executor => given ?? getDb();

/**
 * Runs `fn` inside a transaction, committing on return and rolling back on
 * throw — the same contract as `session.withTransaction`.
 *
 * The callback receives the transaction, which must be threaded into every
 * repository call it makes.
 */
export const withTransaction = async <T>(
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> => getDb().transaction((tx) => fn(tx as Transaction));
