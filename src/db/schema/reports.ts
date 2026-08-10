/**
 * reports and report_settings — port `src/models/report.model.ts` and
 * `src/models/report-setting.model.ts`.
 */
import { sql } from "drizzle-orm";
import { boolean, index, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";

import { ReportFrequencyEnum, ReportStatusEnum } from "../../enums/domain.enum";

import { createdAt, instant, objectIdPk, objectIdRef, updatedAt } from "./columns";
import { users } from "./users";

const REPORT_STATUSES = Object.values(ReportStatusEnum) as [string, ...string[]];
const REPORT_FREQUENCIES = Object.values(ReportFrequencyEnum) as [string, ...string[]];

/**
 * `currencySummary` is declared in the mongoose schema as a bare object literal
 * — `{ currency: {...}, transactionCount: {...} }` — while the TypeScript
 * interface types it as an ARRAY of those objects. Mongoose therefore treats it
 * as a single nested subdocument, and the declared type is a lie.
 *
 * jsonb is used precisely because it reproduces whatever shape is actually in
 * the data, array or object, without forcing a decision that would change
 * behaviour. Reconciling the schema with the interface is a follow-up fix, not
 * something to silently change during a database migration.
 */
export type ReportCurrencySummaryEntry = {
  currency: string;
  transactionCount: number;
};
export type ReportCurrencySummary =
  | ReportCurrencySummaryEntry
  | ReportCurrencySummaryEntry[]
  | null;

export const reports = pgTable(
  "reports",
  {
    id: objectIdPk(),

    userId: objectIdRef("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    period: text("period").notNull(),
    sentDate: instant("sent_date").notNull(),
    startDate: instant("start_date").notNull(),
    endDate: instant("end_date").notNull(),

    status: text("status", { enum: REPORT_STATUSES })
      .notNull()
      .default(ReportStatusEnum.PENDING),
    baseCurrency: text("base_currency").notNull().default("USD"),

    currencySummary: jsonb("currency_summary").$type<ReportCurrencySummary>(),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    /**
     * Not present in the mongoose model — `getAllReportsService` paginates by
     * user and `report.job.ts` upserts per user, both of which were full scans.
     * Added here because an unindexed FK is a Postgres-specific hazard: it also
     * makes the ON DELETE CASCADE from `users` scan this whole table.
     */
    index("reports_user_id_created_at_idx").on(table.userId, table.createdAt.desc()),
  ],
);

export const reportSettings = pgTable(
  "report_settings",
  {
    id: objectIdPk(),

    /**
     * UNIQUE, as of migration 0003.
     *
     * Mongoose declared no unique index here, so the migration deliberately
     * shipped without one to keep behaviour identical. Tightened afterwards, as
     * its own change, because every code path already treats this as
     * one-setting-per-user and the absence of the constraint was reachable:
     * `createDefaultReportSetting` guards with a read-then-insert, which two
     * concurrent verify-OTP or Google sign-ins can both pass under READ
     * COMMITTED, leaving two rows and no rule about which one wins.
     *
     * `createSetting` upserts against this index rather than relying on the
     * guard, so that race now resolves to one row with both callers succeeding.
     */
    userId: objectIdRef("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    frequency: text("frequency", { enum: REPORT_FREQUENCIES })
      .notNull()
      .default(ReportFrequencyEnum.MONTHLY),
    isEnabled: boolean("is_enabled").notNull().default(false),

    nextReportDate: instant("next_report_date"),
    lastSentDate: instant("last_sent_date"),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // Unique, so `createSetting` has something to ON CONFLICT against. Also
    // serves the plain user lookup this replaced — a unique index is still an
    // index.
    uniqueIndex("report_settings_user_id_key").on(table.userId),
    /**
     * The monthly cron selects enabled settings whose nextReportDate is due,
     * across all users. Partial, because only enabled rows are ever scanned.
     */
    index("report_settings_next_report_date_idx")
      .on(table.nextReportDate)
      .where(sql`is_enabled = true`),
  ],
);

export type ReportRow = typeof reports.$inferSelect;
export type NewReportRow = typeof reports.$inferInsert;
export type ReportSettingRow = typeof reportSettings.$inferSelect;
export type NewReportSettingRow = typeof reportSettings.$inferInsert;
