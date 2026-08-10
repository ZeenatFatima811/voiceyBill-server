/**
 * categories repository.
 *
 * The duplicate check is the interesting part. Mongo used
 * `{ $regex: new RegExp('^' + name + '$', 'i') }` — anchored and
 * case-insensitive — so "Food" and "fOOd" collided. The unique index on
 * `(user_id, name)` is case-SENSITIVE and would let both exist, so the check
 * has to be explicit: `lower(name) = lower($1)`.
 *
 * Covered by `category.create.duplicate-case-insensitive`.
 */
import { and, asc, desc, eq, inArray, ne, sql, type SQL } from "drizzle-orm";

import {
  toCategoryApi,
  toCategoryApiList,
  toCategoryRow,
  toCategoryUpdate,
  type CategoryApi,
  type CategoryInput,
} from "../mappers/misc.mapper";
import { newObjectId, toObjectId } from "../object-id";
import { categories } from "../schema/categories";
import { executor, type Executor } from "../unit-of-work";

const one = <T>(rows: T[]): T | null => rows[0] ?? null;
const validId = (id: string): string | null => toObjectId(id);

/**
 * A user's categories, ordered defaults-first then by name.
 *
 * Reproduces `.sort({ isDefault: -1, name: 1 })` from getCategoriesService.
 * `isDefault` descending puts the seeded set above the user's own, which is the
 * order the settings screens render — so this is contractual, not incidental.
 */
export const listByUser = async (
  userId: string,
  exec?: Executor,
): Promise<CategoryApi[]> => {
  const owner = validId(userId);
  if (!owner) return [];

  return toCategoryApiList(
    await executor(exec)
      .select()
      .from(categories)
      .where(eq(categories.userId, owner))
      .orderBy(desc(categories.isDefault), asc(categories.name), asc(categories.id)),
  );
};

/** Bulk delete by id — the junk-category self-heal in getCategoriesService. */
export const removeByIds = async (ids: string[], exec?: Executor): Promise<number> => {
  const keys = ids.map(validId).filter((key): key is string => key !== null);
  if (keys.length === 0) return 0;

  const rows = await executor(exec)
    .delete(categories)
    .where(inArray(categories.id, keys))
    .returning();
  return rows.length;
};

export const findById = async (
  id: string,
  userId?: string,
  exec?: Executor,
): Promise<CategoryApi | null> => {
  const key = validId(id);
  if (!key) return null;

  const clauses: SQL[] = [eq(categories.id, key)];
  if (userId) {
    const owner = validId(userId);
    if (!owner) return null;
    clauses.push(eq(categories.userId, owner));
  }

  const rows = await executor(exec)
    .select()
    .from(categories)
    .where(and(...clauses));
  const row = one(rows);
  return row ? toCategoryApi(row) : null;
};

/**
 * Case-insensitive name lookup, reproducing the anchored regex.
 *
 * `excludeId` supports the rename path, which must ignore the row being renamed
 * when checking for a clash.
 */
export const findByName = async (
  userId: string,
  name: string,
  excludeId?: string,
  exec?: Executor,
): Promise<CategoryApi | null> => {
  const owner = validId(userId);
  if (!owner) return null;

  const clauses: SQL[] = [
    eq(categories.userId, owner),
    sql`lower(${categories.name}) = lower(${name})`,
  ];

  if (excludeId) {
    const key = validId(excludeId);
    if (key) clauses.push(ne(categories.id, key));
  }

  const rows = await executor(exec)
    .select()
    .from(categories)
    .where(and(...clauses));
  const row = one(rows);
  return row ? toCategoryApi(row) : null;
};

export type CreateCategoryInput = Omit<CategoryInput, "id"> & { id?: string };

export const create = async (
  input: CreateCategoryInput,
  exec?: Executor,
): Promise<CategoryApi> => {
  const row = toCategoryRow({ ...input, id: input.id ?? newObjectId() } as CategoryInput);
  const [created] = await executor(exec).insert(categories).values(row).returning();
  return toCategoryApi(created);
};

/** Seeds the default set for a new user; ignores any that already exist. */
export const createManyIgnoringConflicts = async (
  inputs: CreateCategoryInput[],
  exec?: Executor,
): Promise<CategoryApi[]> => {
  if (inputs.length === 0) return [];

  const rows = inputs.map((input) =>
    toCategoryRow({ ...input, id: input.id ?? newObjectId() } as CategoryInput),
  );

  return toCategoryApiList(
    await executor(exec)
      .insert(categories)
      .values(rows)
      .onConflictDoNothing({ target: [categories.userId, categories.name] })
      .returning(),
  );
};

export const update = async (
  id: string,
  userId: string,
  patch: Partial<CategoryInput>,
  exec?: Executor,
): Promise<CategoryApi | null> => {
  const key = validId(id);
  const owner = validId(userId);
  if (!key || !owner) return null;

  const values = toCategoryUpdate(patch);
  if (Object.keys(values).length === 0) return findById(key, owner, exec);

  const [row] = await executor(exec)
    .update(categories)
    .set(values)
    .where(and(eq(categories.id, key), eq(categories.userId, owner)))
    .returning();
  return row ? toCategoryApi(row) : null;
};

export const remove = async (
  id: string,
  userId: string,
  exec?: Executor,
): Promise<CategoryApi | null> => {
  const key = validId(id);
  const owner = validId(userId);
  if (!key || !owner) return null;

  const [row] = await executor(exec)
    .delete(categories)
    .where(and(eq(categories.id, key), eq(categories.userId, owner)))
    .returning();
  return row ? toCategoryApi(row) : null;
};

export const removeByUser = async (userId: string, exec?: Executor): Promise<number> => {
  const owner = validId(userId);
  if (!owner) return 0;
  const rows = await executor(exec)
    .delete(categories)
    .where(eq(categories.userId, owner))
    .returning();
  return rows.length;
};
