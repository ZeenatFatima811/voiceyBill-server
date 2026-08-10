/**
 * categories, reports, report_settings and the two currency caches.
 *
 * Grouped because none of them carries money or hidden fields, so each is a
 * near-passthrough: rename `id` to `_id` and apply the path normalisation.
 *
 * None of these schemas declares `toJSON` options, so NONE of them exposes the
 * `id` virtual: a category, report or report setting carries `_id` and no `id`.
 * Adding one would be as much a behaviour change as removing it from
 * transactions or budgets, which do expose it.
 */
import type { CategoryRow, NewCategoryRow } from "../schema/categories";
import type {
  ExchangeRateCacheRow,
  NewExchangeRateCacheRow,
  NewSupportedCurrencyCacheRow,
  SupportedCurrencyCacheRow,
} from "../schema/currency-cache";
import type {
  NewReportRow,
  NewReportSettingRow,
  ReportCurrencySummary,
  ReportRow,
  ReportSettingRow,
} from "../schema/reports";

import {
  definedOnly,
  insertStamps,
  normaliseCurrency,
  normaliseTrimmed,
  omitNulls,
  updateStamp,
  withMongoId,
} from "./common";

// ---------------------------------------------------------------------------
// categories
// ---------------------------------------------------------------------------

export interface CategoryApi {
  _id: string;
  userId: string;
  name: string;
  color: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export const toCategoryApi = (row: CategoryRow): CategoryApi => withMongoId(row);

export const toCategoryApiList = (rows: CategoryRow[]): CategoryApi[] =>
  rows.map(toCategoryApi);

export interface CategoryInput {
  id: string;
  userId: string;
  name: string;
  color?: string;
  isDefault?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export const toCategoryRow = (input: CategoryInput): NewCategoryRow =>
  ({
    ...input,
    ...insertStamps(input),
    name: normaliseTrimmed(input.name),
  }) as NewCategoryRow;

export const toCategoryUpdate = (
  patch: Partial<CategoryInput>,
): Partial<NewCategoryRow> => {
  const mapped: Record<string, unknown> = { ...patch };
  if (patch.name !== undefined) mapped.name = normaliseTrimmed(patch.name);
  return { ...definedOnly(mapped), ...updateStamp(patch) } as Partial<NewCategoryRow>;
};

// ---------------------------------------------------------------------------
// reports
// ---------------------------------------------------------------------------

export interface ReportApi {
  _id: string;
  userId: string;
  period: string;
  sentDate: Date;
  startDate: Date;
  endDate: Date;
  status: string;
  baseCurrency: string;
  currencySummary: ReportCurrencySummary;
  createdAt: Date;
  updatedAt: Date;
}

export const toReportApi = (row: ReportRow): ReportApi => withMongoId(row);

export const toReportApiList = (rows: ReportRow[]): ReportApi[] => rows.map(toReportApi);

export interface ReportInput {
  id: string;
  userId: string;
  period: string;
  sentDate: Date;
  startDate: Date;
  endDate: Date;
  status?: string;
  baseCurrency?: string;
  currencySummary?: ReportCurrencySummary;
  createdAt?: Date;
  updatedAt?: Date;
}

export const toReportRow = (input: ReportInput): NewReportRow =>
  ({
    ...input,
    ...insertStamps(input),
    baseCurrency:
      input.baseCurrency === undefined
        ? undefined
        : normaliseCurrency(input.baseCurrency),
  }) as NewReportRow;

export const toReportUpdate = (patch: Partial<ReportInput>): Partial<NewReportRow> =>
  ({
    ...definedOnly(patch as Record<string, unknown>),
    ...updateStamp(patch),
  }) as Partial<NewReportRow>;

// ---------------------------------------------------------------------------
// report_settings
// ---------------------------------------------------------------------------

export interface ReportSettingApi {
  _id: string;
  userId: string;
  frequency: string;
  isEnabled: boolean;
  nextReportDate: Date | null;
  lastSentDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * No omission here, unlike transactions.
 *
 * `nextReportDate` and `lastSentDate` declare no default, so mongoose omitted
 * them until first assigned — but `updateReportSettingService` assigns null
 * explicitly whenever reports are disabled, after which they ARE present. A
 * static omit rule would be wrong for one of the two states, so the null is
 * kept; it is what every row holds after its first update.
 */
export const toReportSettingApi = (row: ReportSettingRow): ReportSettingApi =>
  withMongoId(row);

export const toReportSettingApiList = (rows: ReportSettingRow[]): ReportSettingApi[] =>
  rows.map(toReportSettingApi);

export interface ReportSettingInput {
  id: string;
  userId: string;
  frequency?: string;
  isEnabled?: boolean;
  nextReportDate?: Date | null;
  lastSentDate?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export const toReportSettingRow = (input: ReportSettingInput): NewReportSettingRow =>
  ({ ...input, ...insertStamps(input) }) as NewReportSettingRow;

export const toReportSettingUpdate = (
  patch: Partial<ReportSettingInput>,
): Partial<NewReportSettingRow> =>
  ({
    ...definedOnly(patch as Record<string, unknown>),
    ...updateStamp(patch),
  }) as Partial<NewReportSettingRow>;

// ---------------------------------------------------------------------------
// exchange_rate_cache
// ---------------------------------------------------------------------------

export interface ExchangeRateApi {
  _id: string;
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  rateDate: string | null;
  fetchedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/** Bare `{ type: String }` in exchange-rate-cache.model.ts — no default. */
const RATE_OMITTED_WHEN_NULL = ["rateDate"] as const;

export const toExchangeRateApi = (row: ExchangeRateCacheRow): ExchangeRateApi =>
  omitNulls(withMongoId(row), RATE_OMITTED_WHEN_NULL);

export const toExchangeRateApiList = (rows: ExchangeRateCacheRow[]): ExchangeRateApi[] =>
  rows.map(toExchangeRateApi);

export interface ExchangeRateInput {
  id: string;
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  rateDate?: string | null;
  fetchedAt: Date;
}

export const toExchangeRateRow = (input: ExchangeRateInput): NewExchangeRateCacheRow =>
  ({
    ...input,
    ...insertStamps(input as { createdAt?: Date; updatedAt?: Date }),
    fromCurrency: normaliseCurrency(input.fromCurrency),
    toCurrency: normaliseCurrency(input.toCurrency),
  }) as NewExchangeRateCacheRow;

// ---------------------------------------------------------------------------
// supported_currency_cache
// ---------------------------------------------------------------------------

export interface SupportedCurrencyApi {
  _id: string;
  code: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export const toSupportedCurrencyApi = (
  row: SupportedCurrencyCacheRow,
): SupportedCurrencyApi => withMongoId(row);

export const toSupportedCurrencyApiList = (
  rows: SupportedCurrencyCacheRow[],
): SupportedCurrencyApi[] => rows.map(toSupportedCurrencyApi);

export interface SupportedCurrencyInput {
  id: string;
  code: string;
  name: string;
}

export const toSupportedCurrencyRow = (
  input: SupportedCurrencyInput,
): NewSupportedCurrencyCacheRow =>
  ({
    ...input,
    ...insertStamps(input as { createdAt?: Date; updatedAt?: Date }),
    code: normaliseCurrency(input.code),
    name: normaliseTrimmed(input.name),
  }) as NewSupportedCurrencyCacheRow;
