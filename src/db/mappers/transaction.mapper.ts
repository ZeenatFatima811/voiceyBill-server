/**
 * transactions <-> API shape.
 *
 * Reference payload — note `amount` in DOLLARS, both `_id` and `id`, and nulls
 * preserved rather than omitted:
 *
 *   { "_id": "…b9", "id": "…b9", "amount": 271.35, "originalAmount": 250,
 *     "originalCurrency": "EUR", "exchangeRate": 1.0854, "rateSource": "live",
 *     "lastProcessed": null, "recurringInterval": null, … }
 */
import type { NewTransactionRow, TransactionRow } from "../schema/transactions";

import {
  centsToDollars,
  centsToDollarsRequired,
  definedOnly,
  dollarsToCents,
  dollarsToCentsRequired,
  insertStamps,
  normaliseCurrency,
  omitNulls,
  updateStamp,
  withMongoId,
  withVirtualId,
} from "./common";

export interface TransactionApi {
  _id: string;
  /** Present because the schema sets `toJSON: { virtuals: true, getters: true }`. */
  id: string;
  userId: string;
  title: string;
  type: string;
  amount: number;
  originalAmount: number | null;
  originalCurrency: string | null;
  baseCurrencyAtTime: string | null;
  exchangeRate: number | null;
  rateSource: string | null;
  exchangeRateFetchedAt: Date | null;
  description?: string;
  category: string;
  receiptUrl?: string;
  date: Date;
  isRecurring: boolean;
  recurringInterval: string | null;
  nextRecurringDate: Date | null;
  lastProcessed: Date | null;
  status: string;
  paymentMethod: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Paths mongoose omitted when unset.
 *
 * Both are bare `{ type: String }` in transaction.model.ts — no `default`, so a
 * document that never set them simply has no such key. Every other nullable
 * path on this model declares `default: null` and IS present as null.
 */
const OMITTED_WHEN_NULL = ["description", "receiptUrl"] as const;

/** Row -> the object a caller previously received from mongoose. */
export const toTransactionApi = (row: TransactionRow): TransactionApi => {
  const base = withMongoId(row);
  return omitNulls(
    withVirtualId({
      ...base,
      amount: centsToDollarsRequired(row.amount),
      originalAmount: centsToDollars(row.originalAmount),
    }),
    OMITTED_WHEN_NULL,
  ) as unknown as TransactionApi;
};

export const toTransactionApiList = (rows: TransactionRow[]): TransactionApi[] =>
  rows.map(toTransactionApi);

/**
 * Inbound values for an insert.
 *
 * `amount` arrives in dollars from the services, exactly as it did under
 * mongoose, and is converted here — the one place it can be converted.
 */
export interface TransactionInput {
  id: string;
  userId: string;
  title: string;
  type: string;
  amount: number;
  originalAmount?: number | null;
  originalCurrency?: string | null;
  baseCurrencyAtTime?: string | null;
  exchangeRate?: number | null;
  rateSource?: string | null;
  exchangeRateFetchedAt?: Date | null;
  description?: string | null;
  category: string;
  receiptUrl?: string | null;
  date?: Date;
  isRecurring?: boolean;
  recurringInterval?: string | null;
  nextRecurringDate?: Date | null;
  lastProcessed?: Date | null;
  status?: string;
  paymentMethod?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export const toTransactionRow = (input: TransactionInput): NewTransactionRow =>
  ({
    ...input,
    ...insertStamps(input),
    amount: dollarsToCentsRequired(input.amount),
    originalAmount: dollarsToCents(input.originalAmount),
    // `uppercase: true` on all three currency paths.
    originalCurrency: normaliseCurrency(input.originalCurrency),
    baseCurrencyAtTime: normaliseCurrency(input.baseCurrencyAtTime),
  }) as NewTransactionRow;

/**
 * A partial update.
 *
 * Runs through `definedOnly` so an omitted field stays untouched rather than
 * being nulled — see the note on that helper. `amount` is converted only when
 * the caller actually supplied it; converting `undefined` would write NaN.
 */
export const toTransactionUpdate = (
  patch: Partial<TransactionInput>,
): Partial<NewTransactionRow> => {
  const mapped: Record<string, unknown> = { ...patch };

  if (patch.amount !== undefined) {
    mapped.amount = dollarsToCentsRequired(patch.amount);
  }
  if (patch.originalAmount !== undefined) {
    mapped.originalAmount = dollarsToCents(patch.originalAmount);
  }
  if (patch.originalCurrency !== undefined) {
    mapped.originalCurrency = normaliseCurrency(patch.originalCurrency);
  }
  if (patch.baseCurrencyAtTime !== undefined) {
    mapped.baseCurrencyAtTime = normaliseCurrency(patch.baseCurrencyAtTime);
  }

  return { ...definedOnly(mapped), ...updateStamp(patch) } as Partial<NewTransactionRow>;
};
