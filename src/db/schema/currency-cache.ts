/**
 * exchange_rate_cache and supported_currency_cache — port
 * `src/models/exchange-rate-cache.model.ts` and
 * `src/models/supported-currency-cache.model.ts`.
 */
import { doublePrecision, index, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";

import { createdAt, instant, objectIdPk, updatedAt } from "./columns";

export const exchangeRateCache = pgTable(
  "exchange_rate_cache",
  {
    id: objectIdPk(),

    // `uppercase: true, trim: true` in mongoose; normalised in the mapper.
    fromCurrency: text("from_currency").notNull(),
    toCurrency: text("to_currency").notNull(),

    /**
     * A rate, not money — see the note on `transactions.exchange_rate`. Stored
     * as a double so cached values are bit-identical to what mongoose held.
     */
    rate: doublePrecision("rate").notNull(),

    /**
     * Kept as text, not a date. The provider returns a plain `YYYY-MM-DD` day
     * string and mongoose stored it as a String; parsing it into a timestamp
     * here would invent a timezone the provider never specified.
     */
    rateDate: text("rate_date"),

    fetchedAt: instant("fetched_at").notNull(),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // Carried over verbatim: lookups read the freshest rate for a pair.
    index("exchange_rate_cache_pair_fetched_at_idx").on(
      table.fromCurrency,
      table.toCurrency,
      table.fetchedAt.desc(),
    ),
    /**
     * Not in the mongoose model. `currency.job.ts` refreshes rates with a
     * `bulkWrite` of upserts; in Postgres an `ON CONFLICT` upsert needs a unique
     * constraint to target. Without it the job would insert a duplicate row per
     * run and the cache would grow without bound.
     *
     * This does change one thing: Mongo accumulated a historical row per fetch,
     * whereas this keeps one row per pair. Nothing reads the history — every
     * query is "freshest rate for this pair", filtered by MAX_CACHE_AGE_MS — but
     * it is a real difference and is called out here rather than buried.
     */
    uniqueIndex("exchange_rate_cache_pair_key").on(table.fromCurrency, table.toCurrency),
  ],
);

export const supportedCurrencyCache = pgTable(
  "supported_currency_cache",
  {
    id: objectIdPk(),

    code: text("code").notNull(),
    name: text("name").notNull(),

    createdAt: createdAt(),
    /**
     * The mongoose model declared `updatedAt` explicitly AND passed
     * `timestamps: true`, so mongoose owned the field and the explicit
     * declaration was redundant. Here the trigger owns it, same as every other
     * table.
     */
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex("supported_currency_cache_code_key").on(table.code)],
);

export type ExchangeRateCacheRow = typeof exchangeRateCache.$inferSelect;
export type NewExchangeRateCacheRow = typeof exchangeRateCache.$inferInsert;
export type SupportedCurrencyCacheRow = typeof supportedCurrencyCache.$inferSelect;
export type NewSupportedCurrencyCacheRow = typeof supportedCurrencyCache.$inferInsert;
