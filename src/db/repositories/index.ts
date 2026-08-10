/**
 * The repository layer.
 *
 * Namespaced rather than flattened, so a call site reads `users.findById(...)`
 * and `transactions.findById(...)` — unambiguous, and close enough to the
 * `UserModel.findById` it replaces that a port stays reviewable side by side.
 *
 * Every function takes an optional trailing `Executor`. Inside
 * `withTransaction`, pass the transaction to each call; that is the equivalent
 * of mongoose's `{ session }`, and omitting it has the same meaning — the
 * statement runs outside the transaction.
 */
export * as users from "./user.repository";
export * as transactions from "./transaction.repository";
export * as budgets from "./budget.repository";
export * as categories from "./category.repository";
export * as reports from "./report.repository";
export * as currency from "./currency.repository";

export { withTransaction, executor, type Executor, type Transaction } from "../unit-of-work";
