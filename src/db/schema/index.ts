/**
 * The full Postgres schema, ported one-for-one from `src/models/`.
 *
 * Table-to-model map:
 *   users                     <- user.model.ts
 *   transactions              <- transaction.model.ts
 *   budgets                   <- budget.model.ts
 *   categories                <- category.model.ts
 *   reports                   <- report.model.ts
 *   report_settings           <- report-setting.model.ts
 *   exchange_rate_cache       <- exchange-rate-cache.model.ts
 *   supported_currency_cache  <- supported-currency-cache.model.ts
 *
 * drizzle-kit reads this module to generate migrations, so every table must be
 * re-exported here or it will be silently dropped from the generated SQL.
 */
export * from "./columns";
export * from "./users";
export * from "./transactions";
export * from "./budgets";
export * from "./categories";
export * from "./reports";
export * from "./currency-cache";
