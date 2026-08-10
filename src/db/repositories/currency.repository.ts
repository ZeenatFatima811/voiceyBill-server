/**
 * exchange_rate_cache and supported_currency_cache repository.
 *
 * One behaviour difference is deliberate: Mongo accumulated a historical row per
 * fetch, whereas `exchange_rate_cache` now carries a unique index on
 * `(from_currency, to_currency)` so the refresh job can upsert. Nothing reads
 * the history — every query is "freshest rate for this pair" — but the history
 * stops accumulating.
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";

import { normaliseCurrency } from "../mappers/common";
import {
  toExchangeRateApi,
  toExchangeRateApiList,
  toExchangeRateRow,
  toSupportedCurrencyApiList,
  toSupportedCurrencyRow,
  type ExchangeRateApi,
  type ExchangeRateInput,
  type SupportedCurrencyApi,
  type SupportedCurrencyInput,
} from "../mappers/misc.mapper";
import { newObjectId } from "../object-id";
import { exchangeRateCache, supportedCurrencyCache } from "../schema/currency-cache";
import { executor, type Executor } from "../unit-of-work";

const one = <T>(rows: T[]): T | null => rows[0] ?? null;

/**
 * The freshest cached rate for a pair.
 *
 * Currencies are normalised on the way in, because mongoose's `uppercase: true`
 * applied to queries as well as writes — a lookup for "usd" matched a row
 * stored as "USD".
 */
export const findRate = async (
  fromCurrency: string,
  toCurrency: string,
  exec?: Executor,
): Promise<ExchangeRateApi | null> => {
  const rows = await executor(exec)
    .select()
    .from(exchangeRateCache)
    .where(
      and(
        eq(exchangeRateCache.fromCurrency, normaliseCurrency(fromCurrency)),
        eq(exchangeRateCache.toCurrency, normaliseCurrency(toCurrency)),
      ),
    )
    .orderBy(desc(exchangeRateCache.fetchedAt))
    .limit(1);

  const row = one(rows);
  return row ? toExchangeRateApi(row) : null;
};

export const listRates = async (exec?: Executor): Promise<ExchangeRateApi[]> =>
  toExchangeRateApiList(
    await executor(exec)
      .select()
      .from(exchangeRateCache)
      .orderBy(
        asc(exchangeRateCache.fromCurrency),
        asc(exchangeRateCache.toCurrency),
        asc(exchangeRateCache.fetchedAt),
      ),
  );

export type UpsertRateInput = Omit<ExchangeRateInput, "id"> & { id?: string };

/** Single-pair upsert, for the write-through after a live fetch. */
export const upsertRate = async (
  input: UpsertRateInput,
  exec?: Executor,
): Promise<ExchangeRateApi> => {
  const row = toExchangeRateRow({
    ...input,
    id: input.id ?? newObjectId(),
  } as ExchangeRateInput);

  const [saved] = await executor(exec)
    .insert(exchangeRateCache)
    .values(row)
    .onConflictDoUpdate({
      target: [exchangeRateCache.fromCurrency, exchangeRateCache.toCurrency],
      set: { rate: row.rate, rateDate: row.rateDate, fetchedAt: row.fetchedAt },
    })
    .returning();

  return toExchangeRateApi(saved);
};

/** The refresh cron's `bulkWrite`, as one multi-row upsert. */
export const upsertRates = async (
  inputs: UpsertRateInput[],
  exec?: Executor,
): Promise<ExchangeRateApi[]> => {
  if (inputs.length === 0) return [];

  const rows = inputs.map((input) =>
    toExchangeRateRow({ ...input, id: input.id ?? newObjectId() } as ExchangeRateInput),
  );

  return toExchangeRateApiList(
    await executor(exec)
      .insert(exchangeRateCache)
      .values(rows)
      .onConflictDoUpdate({
        target: [exchangeRateCache.fromCurrency, exchangeRateCache.toCurrency],
        set: {
          // `excluded` is the row proposed by this INSERT — the standard way to
          // reference incoming values in a MULTI-row upsert. Referencing the
          // mapped `row` variables instead (as the single-pair upsert above can
          // safely do) would apply the last row's values to every conflict.
          rate: sql`excluded.rate`,
          rateDate: sql`excluded.rate_date`,
          fetchedAt: sql`excluded.fetched_at`,
        },
      })
      .returning(),
  );
};

// ---------------------------------------------------------------------------
// supported_currency_cache
// ---------------------------------------------------------------------------

export const listSupported = async (
  exec?: Executor,
): Promise<SupportedCurrencyApi[]> =>
  toSupportedCurrencyApiList(
    await executor(exec)
      .select()
      .from(supportedCurrencyCache)
      .orderBy(asc(supportedCurrencyCache.code)),
  );

export type UpsertSupportedInput = Omit<SupportedCurrencyInput, "id"> & { id?: string };

/**
 * Replaces the supported-currency list.
 *
 * The Mongo version did `deleteMany({})` then `insertMany(...)`, which leaves
 * the table empty if the insert fails. Wrapping both in one statement pair
 * inside the caller's transaction removes that window; callers should pass an
 * `Executor` from `withTransaction`.
 */
export const replaceSupported = async (
  inputs: UpsertSupportedInput[],
  exec?: Executor,
): Promise<SupportedCurrencyApi[]> => {
  const run = executor(exec);
  await run.delete(supportedCurrencyCache);

  if (inputs.length === 0) return [];

  const rows = inputs.map((input) =>
    toSupportedCurrencyRow({
      ...input,
      id: input.id ?? newObjectId(),
    } as SupportedCurrencyInput),
  );

  return toSupportedCurrencyApiList(
    await run.insert(supportedCurrencyCache).values(rows).returning(),
  );
};
