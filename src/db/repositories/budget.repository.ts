/**
 * budgets repository.
 *
 * Every amount crossing this boundary is in DOLLARS; the mapper converts to and
 * from the cents actually stored, including inside the `categoryLimits` jsonb
 * array. Nothing here should ever see a cents value.
 */
import { and, asc, eq } from "drizzle-orm";

import {
  toBudgetApi,
  toBudgetApiList,
  toBudgetRow,
  toBudgetUpdate,
  type BudgetApi,
  type BudgetInput,
} from "../mappers/budget.mapper";
import { newObjectId, toObjectId } from "../object-id";
import { budgets } from "../schema/budgets";
import { executor, type Executor } from "../unit-of-work";

const one = <T>(rows: T[]): T | null => rows[0] ?? null;
const validId = (id: string): string | null => toObjectId(id);

export const findByMonth = async (
  userId: string,
  month: number,
  year: number,
  exec?: Executor,
): Promise<BudgetApi | null> => {
  const owner = validId(userId);
  if (!owner) return null;

  const rows = await executor(exec)
    .select()
    .from(budgets)
    .where(
      and(eq(budgets.userId, owner), eq(budgets.month, month), eq(budgets.year, year)),
    );
  const row = one(rows);
  return row ? toBudgetApi(row) : null;
};

export const listByUser = async (
  userId: string,
  exec?: Executor,
): Promise<BudgetApi[]> => {
  const owner = validId(userId);
  if (!owner) return [];

  return toBudgetApiList(
    await executor(exec)
      .select()
      .from(budgets)
      .where(eq(budgets.userId, owner))
      .orderBy(asc(budgets.year), asc(budgets.month)),
  );
};

export type CreateBudgetInput = Omit<BudgetInput, "id"> & { id?: string };

/**
 * Creates or replaces the budget for a user's month.
 *
 * A single `ON CONFLICT` upsert against the unique `(user_id, month, year)`
 * index, rather than the read-then-branch the Mongo version performed. That
 * closes a real race: two concurrent saves for the same month could both find
 * nothing and both insert, and only the unique index stopped the second — as an
 * error, not a merge.
 */
export const upsert = async (
  input: CreateBudgetInput,
  exec?: Executor,
): Promise<BudgetApi> => {
  const row = toBudgetRow({ ...input, id: input.id ?? newObjectId() } as BudgetInput);

  const [saved] = await executor(exec)
    .insert(budgets)
    .values(row)
    .onConflictDoUpdate({
      target: [budgets.userId, budgets.month, budgets.year],
      set: {
        totalBudget: row.totalBudget,
        categoryLimits: row.categoryLimits,
        // Must be listed explicitly. On the conflict path `updated_at` would
        // otherwise keep its old value, the `set_updated_at` trigger would see
        // it unchanged, and it would be stamped from the DATABASE clock — the
        // exact thing migration 0002 exists to prevent.
        updatedAt: row.updatedAt,
      },
    })
    .returning();

  return toBudgetApi(saved);
};

export const update = async (
  userId: string,
  month: number,
  year: number,
  patch: Partial<BudgetInput>,
  exec?: Executor,
): Promise<BudgetApi | null> => {
  const owner = validId(userId);
  if (!owner) return null;

  const values = toBudgetUpdate(patch);
  if (Object.keys(values).length === 0) return findByMonth(owner, month, year, exec);

  const [row] = await executor(exec)
    .update(budgets)
    .set(values)
    .where(
      and(eq(budgets.userId, owner), eq(budgets.month, month), eq(budgets.year, year)),
    )
    .returning();
  return row ? toBudgetApi(row) : null;
};

export const remove = async (
  userId: string,
  month: number,
  year: number,
  exec?: Executor,
): Promise<BudgetApi | null> => {
  const owner = validId(userId);
  if (!owner) return null;

  const [row] = await executor(exec)
    .delete(budgets)
    .where(
      and(eq(budgets.userId, owner), eq(budgets.month, month), eq(budgets.year, year)),
    )
    .returning();
  return row ? toBudgetApi(row) : null;
};
