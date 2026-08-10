/**
 * budgets — ports `src/models/budget.model.ts`.
 */
import { integer, jsonb, pgTable, uniqueIndex } from "drizzle-orm/pg-core";

import { cents, createdAt, objectIdPk, objectIdRef, updatedAt } from "./columns";
import { users } from "./users";

/**
 * `categoryLimits` was an embedded subdocument array with `{ _id: false }`, so
 * it had no identity of its own and was always read and written as a whole
 * array. jsonb preserves that shape and its ordering exactly.
 *
 * Note the unit: the embedded schema applied `convertToCents` on write, so
 * `limit` is stored in CENTS here, the same as `totalBudget`. The mapper
 * converts the whole array on the way in and out — a partial conversion that
 * handled `totalBudget` but not the array elements would produce budget
 * summaries that are wrong by a factor of 100.
 */
export type BudgetCategoryLimitRow = { category: string; limit: number };

export const budgets = pgTable(
  "budgets",
  {
    id: objectIdPk(),

    userId: objectIdRef("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    /** 1-12; the mongoose `min`/`max` become a CHECK in the migration SQL. */
    month: integer("month").notNull(),
    year: integer("year").notNull(),

    totalBudget: cents("total_budget").notNull(),

    categoryLimits: jsonb("category_limits")
      .$type<BudgetCategoryLimitRow[]>()
      .notNull()
      .default([]),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // "Compound index for unique budget per user per month-year" — carried over
    // from the mongoose model. `createOrUpdateBudget` relies on this to make its
    // upsert atomic, so it must stay unique.
    uniqueIndex("budgets_user_id_month_year_key").on(
      table.userId,
      table.month,
      table.year,
    ),
  ],
);

export type BudgetRow = typeof budgets.$inferSelect;
export type NewBudgetRow = typeof budgets.$inferInsert;
