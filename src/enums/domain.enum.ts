/**
 * Domain enums.
 *
 * These lived in `src/models/*.model.ts` alongside the mongoose schemas, so
 * every consumer — validators, DTOs, prompts, the Drizzle schema — imported a
 * mongoose file to read a string union. That made `src/models/` impossible to
 * delete at cutover even though nothing needed the schemas any more.
 *
 * The values are unchanged. They are the same strings the CHECK constraints in
 * drizzle/0001_constraints_and_triggers.sql enforce, and changing one here
 * without changing the constraint would let the application write a value the
 * database rejects.
 */

export enum TransactionStatusEnum {
  PENDING = "PENDING",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
}

export enum RecurringIntervalEnum {
  DAILY = "DAILY",
  WEEKLY = "WEEKLY",
  MONTHLY = "MONTHLY",
  YEARLY = "YEARLY",
}

export enum TransactionTypeEnum {
  INCOME = "INCOME",
  EXPENSE = "EXPENSE",
}

export enum PaymentMethodEnum {
  CARD = "CARD",
  BANK_TRANSFER = "BANK_TRANSFER",
  MOBILE_PAYMENT = "MOBILE_PAYMENT",
  AUTO_DEBIT = "AUTO_DEBIT",
  CASH = "CASH",
  OTHER = "OTHER",
}

export enum ReportStatusEnum {
  SENT = "SENT",
  PENDING = "PENDING",
  FAILED = "FAILED",
  NO_ACTIVITY = "NO_ACTIVITY",
}

export enum ReportFrequencyEnum {
  MONTHLY = "MONTHLY",
}

/** How an account authenticates. Mirrors `users_provider_check`. */
export type AuthProvider = "local" | "google";
