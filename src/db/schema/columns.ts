/**
 * Shared column builders.
 *
 * Centralised so every table agrees on how ids, foreign keys, timestamps and
 * money are represented — a per-table divergence here is exactly the kind of
 * thing that silently breaks response parity with the Mongo implementation.
 */
import { sql } from "drizzle-orm";
import { bigint, char, timestamp } from "drizzle-orm/pg-core";

import { OBJECT_ID_LENGTH } from "../object-id";

/**
 * Primary key: a 24-char ObjectId-format hex string, not a UUID. See
 * `src/db/object-id.ts` for why the Mongo id format is preserved.
 *
 * Deliberately has no database-level default. Ids are generated in application
 * code by `newObjectId()` so that the per-process random segment and the
 * monotonic counter behave the way the BSON spec describes; a SQL default would
 * have to reimplement that and would drift.
 */
export const objectIdPk = () => char("id", { length: OBJECT_ID_LENGTH }).primaryKey();

/** A foreign-key column in the same id format. */
export const objectIdRef = (name: string) =>
  char(name, { length: OBJECT_ID_LENGTH });

/**
 * Money, stored as integer cents.
 *
 * Mongo stored cents too, but hid the conversion inside schema `set:`/`get:`
 * hooks so services passed and received dollars. Postgres has no equivalent
 * hook, so the conversion moves to the explicit mappers in `src/db/mappers/`.
 * `mode: "number"` keeps the JS type as `number`, matching what the services
 * and every existing API response already use.
 *
 * bigint rather than integer: an int4 cents column tops out around $21.4M,
 * which is a plausible ceiling for a lifetime account total.
 */
export const cents = (name: string) => bigint(name, { mode: "number" });

/**
 * `timestamps: true` produced `createdAt`/`updatedAt` as UTC dates. `withTimezone`
 * keeps them as `timestamptz` so the values round-trip through JSON identically
 * regardless of the server's local zone.
 *
 * `updatedAt` is maintained by the `set_updated_at` trigger installed in the
 * initial migration, mirroring how mongoose maintained it outside the caller's
 * control. Application code must not set it by hand.
 */
export const createdAt = () =>
  timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .default(sql`now()`);

export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .default(sql`now()`);

/** A nullable point in time, e.g. `lastProcessed`, `nextRecurringDate`. */
export const instant = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });
