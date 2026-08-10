/**
 * Shared mapping primitives.
 *
 * A mapper's job is to make a Postgres row indistinguishable from the mongoose
 * document it replaces — not "close enough", but byte-identical once
 * serialised, because the web and mobile clients read these payloads directly
 * and were not changed by the migration.
 *
 * Three mongoose behaviours have no Postgres equivalent and are reproduced
 * here rather than being scattered through the repositories:
 *
 *   1. `_id` — the primary key is exposed under the Mongo name, never `id`
 *      alone. See src/db/object-id.ts for why the FORMAT is preserved too.
 *
 *   2. The `id` virtual — mongoose adds an `id` getter alongside `_id`, but it
 *      only reaches the payload when a schema opts in via `toJSON`. That is per
 *      model and NOT uniform, so `withVirtualId` is applied deliberately:
 *
 *        transaction  toJSON: { virtuals: true, getters: true }  -> has `id`
 *        budget       toJSON: { getters: true }                  -> has `id`
 *        category     (no toJSON options)                        -> NO `id`
 *        report       (no toJSON options)                        -> NO `id`
 *        user         omitPassword() -> toObject()               -> NO `id`
 *
 *      `getters: true` is enough on its own because mongoose applies virtual
 *      getters under that flag. Adding `id` to a model that never had it is as
 *      much a behaviour change as dropping it from one that did.
 *
 *   3. Path options — `lowercase`, `uppercase` and `trim` normalised values on
 *      WRITE. Postgres has no such hook, so `normaliseX` helpers run in the
 *      inbound direction and the CHECK constraints in
 *      drizzle/0001_constraints_and_triggers.sql assert they were not skipped.
 */
import { convertToCents, convertToDollarUnit } from "../../utils/format-currency";

/** A payload shaped like a mongoose document: keyed by `_id`, not `id`. */
export type ApiDocument<T> = T & { _id: string };

/**
 * Renames the primary key from `id` to `_id`.
 *
 * Every mapper starts here, so nothing can accidentally ship a Postgres-shaped
 * `id`-only payload to a client that reads `_id`.
 */
export const withMongoId = <T extends { id: string }>(
  row: T,
): Omit<T, "id"> & { _id: string } => {
  const { id, ...rest } = row;
  return { ...rest, _id: id };
};

/**
 * Re-adds `id` alongside `_id`, for the models whose schemas exposed the
 * virtual. Apply only where the table above says so.
 */
export const withVirtualId = <T extends { _id: string }>(doc: T): T & { id: string } => ({
  ...doc,
  id: doc._id,
});

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/**
 * Cents -> dollars, for reads. Mirrors the mongoose schema getter.
 *
 * Null-preserving: `originalAmount` is nullable and mongoose's getter returned
 * null rather than 0 for it, so a `?? 0` here would invent a value that the
 * clients would render as a real zero amount.
 */
export const centsToDollars = (value: number | null | undefined): number | null =>
  value === null || value === undefined ? null : convertToDollarUnit(value);

/** Dollars -> cents, for writes. Mirrors the mongoose schema setter. */
export const dollarsToCents = (value: number | null | undefined): number | null =>
  value === null || value === undefined ? null : convertToCents(value);

/**
 * The non-null variants, for required columns.
 *
 * Separate rather than a `!` at each call site so a required amount can never
 * silently become null when an upstream value goes missing.
 */
export const centsToDollarsRequired = (value: number): number =>
  convertToDollarUnit(value);

export const dollarsToCentsRequired = (value: number): number => convertToCents(value);

// ---------------------------------------------------------------------------
// Path normalisation
// ---------------------------------------------------------------------------

/** `lowercase: true, trim: true` — the email path. */
export const normaliseEmail = (value: string): string => value.trim().toLowerCase();

/** `uppercase: true, trim: true` — every currency path. */
export const normaliseCurrency = <T extends string | null | undefined>(
  value: T,
): T extends string ? string : T =>
  (typeof value === "string" ? value.trim().toUpperCase() : value) as never;

/** `trim: true` — names, labels, category names. */
export const normaliseTrimmed = <T extends string | null | undefined>(
  value: T,
): T extends string ? string : T =>
  (typeof value === "string" ? value.trim() : value) as never;

/**
 * Drops keys whose value is `undefined`.
 *
 * A partial update built from an optional DTO carries `undefined` for every
 * field the caller omitted. Passed to Drizzle those become explicit `NULL`s and
 * would wipe columns the caller never mentioned — mongoose's `$set` ignored
 * them. This is the single most destructive difference between the two, so it
 * is applied on every update path.
 */
/**
 * Removes keys whose value is null, for paths mongoose OMITTED rather than
 * stored.
 *
 * The document-vs-relational difference, and it reaches the API payload, not
 * just the raw row. A mongoose path declaring `default: null` was written
 * explicitly and appears in every document; a nullable path with NO default
 * that was never assigned is simply absent from the BSON — the key does not
 * exist. Postgres has the column either way and returns null for both.
 *
 * So a mapper must drop exactly the second group, or a response gains
 * `"description": null` where the client previously saw no key at all.
 *
 * Anything declaring `default: null` — originalAmount, exchangeRate,
 * lastProcessed, recurringInterval, providerId — must NOT be passed here, or
 * the divergence appears in the opposite direction.
 */
export const omitNulls = <T extends Record<string, unknown>>(
  doc: T,
  keys: readonly (keyof T)[],
): T => {
  const out = { ...doc };
  for (const key of keys) {
    if (out[key] === null) delete out[key];
  }
  return out;
};

/**
 * Supplies `createdAt`/`updatedAt` for an insert, in the APPLICATION's clock.
 *
 * `timestamps: true` had mongoose stamp both from the JS clock in-process. The
 * Postgres columns default to `now()`, which is the DATABASE server's clock —
 * a different value from a different machine. Setting them here restores the
 * original semantics, so the application keeps control of the column that
 * `transactions_user_id_created_at_idx` orders a user's history by.
 *
 * Callers may pass explicit values (the seeders and the backfill do), which
 * always win.
 */
export const insertStamps = (input: {
  createdAt?: Date;
  updatedAt?: Date;
}): { createdAt: Date; updatedAt: Date } => {
  const now = new Date();
  return {
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? input.createdAt ?? now,
  };
};

/**
 * Supplies `updatedAt` for an update, again in the application's clock.
 *
 * The `set_updated_at` trigger stamps only when a statement leaves the column
 * untouched (see drizzle/0002), so an explicit value here is respected rather
 * than overwritten.
 */
export const updateStamp = (patch: { updatedAt?: Date }): { updatedAt: Date } => ({
  updatedAt: patch.updatedAt ?? new Date(),
});

export const definedOnly = <T extends Record<string, unknown>>(patch: T): Partial<T> => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) out[key] = value;
  }
  return out as Partial<T>;
};
