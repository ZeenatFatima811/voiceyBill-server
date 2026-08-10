/**
 * budgets <-> API shape.
 *
 * The trap here is `categoryLimits[].limit`. It lives inside a jsonb array and
 * is stored in CENTS, exactly like the scalar `totalBudget`, because the
 * mongoose subdocument schema applied the same `convertToCents` setter. A port
 * that converts the scalar but not the array leaves every budget summary wrong
 * by a factor of 100 while still looking plausible.
 *
 * The two units side by side, for a budget of $2500.50 with a $500.25 food
 * limit — what a caller passes and sees, versus what the columns hold:
 *
 *   API   { "totalBudget": 2500.5,  "categoryLimits": [{ "limit": 500.25 }] }
 *   rows  { "totalBudget": 250050,  "categoryLimits": [{ "limit": 50025  }] }
 */
import type { BudgetCategoryLimitRow, BudgetRow, NewBudgetRow } from "../schema/budgets";

import {
  centsToDollarsRequired,
  definedOnly,
  dollarsToCentsRequired,
  insertStamps,
  normaliseTrimmed,
  updateStamp,
  withMongoId,
  withVirtualId,
} from "./common";

export interface BudgetCategoryLimitApi {
  category: string;
  limit: number;
}

export interface BudgetApi {
  _id: string;
  /** Present because the schema sets `toJSON: { getters: true }`. */
  id: string;
  userId: string;
  month: number;
  year: number;
  totalBudget: number;
  categoryLimits: BudgetCategoryLimitApi[];
  createdAt: Date;
  updatedAt: Date;
}

const limitsToDollars = (limits: BudgetCategoryLimitRow[]): BudgetCategoryLimitApi[] =>
  (limits ?? []).map((entry) => ({
    category: entry.category,
    limit: centsToDollarsRequired(entry.limit),
  }));

const limitsToCents = (
  limits: BudgetCategoryLimitApi[] | undefined,
): BudgetCategoryLimitRow[] | undefined =>
  limits?.map((entry) => ({
    category: normaliseTrimmed(entry.category),
    limit: dollarsToCentsRequired(entry.limit),
  }));

export const toBudgetApi = (row: BudgetRow): BudgetApi => {
  const base = withMongoId(row);
  return withVirtualId({
    ...base,
    totalBudget: centsToDollarsRequired(row.totalBudget),
    categoryLimits: limitsToDollars(row.categoryLimits),
  }) as unknown as BudgetApi;
};

export const toBudgetApiList = (rows: BudgetRow[]): BudgetApi[] => rows.map(toBudgetApi);

export interface BudgetInput {
  id: string;
  userId: string;
  month: number;
  year: number;
  totalBudget: number;
  categoryLimits?: BudgetCategoryLimitApi[];
  createdAt?: Date;
  updatedAt?: Date;
}

export const toBudgetRow = (input: BudgetInput): NewBudgetRow =>
  ({
    ...input,
    ...insertStamps(input),
    totalBudget: dollarsToCentsRequired(input.totalBudget),
    categoryLimits: limitsToCents(input.categoryLimits) ?? [],
  }) as NewBudgetRow;

export const toBudgetUpdate = (patch: Partial<BudgetInput>): Partial<NewBudgetRow> => {
  const mapped: Record<string, unknown> = { ...patch };

  if (patch.totalBudget !== undefined) {
    mapped.totalBudget = dollarsToCentsRequired(patch.totalBudget);
  }
  if (patch.categoryLimits !== undefined) {
    mapped.categoryLimits = limitsToCents(patch.categoryLimits);
  }

  return { ...definedOnly(mapped), ...updateStamp(patch) } as Partial<NewBudgetRow>;
};
