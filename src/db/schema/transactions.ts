/**
 * transactions — ports `src/models/transaction.model.ts`.
 *
 * The enums are re-exported from the mongoose model rather than redeclared, so
 * there is exactly one definition of each set of values during the migration
 * and the two cannot drift apart.
 */
import { sql } from "drizzle-orm";
import { boolean, doublePrecision, index, pgTable, text } from "drizzle-orm/pg-core";

import {
  PaymentMethodEnum,
  RecurringIntervalEnum,
  TransactionStatusEnum,
  TransactionTypeEnum,
} from "../../enums/domain.enum";

import { cents, createdAt, instant, objectIdPk, objectIdRef, updatedAt } from "./columns";
import { users } from "./users";

const TRANSACTION_TYPES = Object.values(TransactionTypeEnum) as [string, ...string[]];
const TRANSACTION_STATUSES = Object.values(TransactionStatusEnum) as [string, ...string[]];
const RECURRING_INTERVALS = Object.values(RecurringIntervalEnum) as [string, ...string[]];
const PAYMENT_METHODS = Object.values(PaymentMethodEnum) as [string, ...string[]];

/** `rateSource` allowed `"live"`, `"cached"` or null. */
export const RATE_SOURCES = ["live", "cached"] as const;

export const transactions = pgTable(
  "transactions",
  {
    id: objectIdPk(),

    userId: objectIdRef("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    title: text("title").notNull(),
    type: text("type", { enum: TRANSACTION_TYPES }).notNull(),

    /**
     * Integer cents. Mongoose applied `convertToCents` on write and
     * `convertToDollarUnit` on read via schema getters, with
     * `toJSON: { getters: true }` meaning API responses carried dollars. The
     * mapper reproduces both halves — see `src/db/mappers/transaction.mapper.ts`.
     */
    amount: cents("amount").notNull(),
    originalAmount: cents("original_amount"),

    // `uppercase: true` on the mongoose paths; normalised in the mapper.
    originalCurrency: text("original_currency"),
    baseCurrencyAtTime: text("base_currency_at_time"),

    /**
     * A rate is a ratio, not money, so it is NOT stored as cents.
     * `doublePrecision` matches the IEEE-754 double mongoose stored, keeping
     * captured values bit-identical through the migration. Rounding it to a
     * numeric here would change existing analytics output.
     */
    exchangeRate: doublePrecision("exchange_rate"),
    rateSource: text("rate_source", { enum: RATE_SOURCES }),
    exchangeRateFetchedAt: instant("exchange_rate_fetched_at"),

    description: text("description"),
    category: text("category").notNull(),
    receiptUrl: text("receipt_url"),

    date: instant("date").notNull().default(sql`now()`),

    isRecurring: boolean("is_recurring").notNull().default(false),
    recurringInterval: text("recurring_interval", { enum: RECURRING_INTERVALS }),
    nextRecurringDate: instant("next_recurring_date"),
    lastProcessed: instant("last_processed"),

    status: text("status", { enum: TRANSACTION_STATUSES })
      .notNull()
      .default(TransactionStatusEnum.COMPLETED),
    paymentMethod: text("payment_method", { enum: PAYMENT_METHODS })
      .notNull()
      .default(PaymentMethodEnum.CASH),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // Carried over verbatim from the mongoose model, where the comment records
    // that this collection previously had NO indexes and every list/analytics
    // query was a full scan. list = filter by user + sort by createdAt desc.
    index("transactions_user_id_created_at_idx").on(
      table.userId,
      table.createdAt.desc(),
    ),
    // analytics/reports = match user + date range.
    index("transactions_user_id_date_idx").on(table.userId, table.date.desc()),
    /**
     * The daily recurring cron scans for due rows across ALL users. Mongo used
     * a partial index over `{ isRecurring: true }`; Postgres expresses the same
     * thing with a WHERE predicate, keeping the index tiny and the write cost
     * near zero.
     */
    index("transactions_next_recurring_date_idx")
      .on(table.nextRecurringDate)
      .where(sql`is_recurring = true`),
  ],
);

export type TransactionRow = typeof transactions.$inferSelect;
export type NewTransactionRow = typeof transactions.$inferInsert;
