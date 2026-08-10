/**
 * Category service — ported from mongoose to the Postgres repository layer.
 *
 * The signatures and the returned shapes are unchanged; only the data access
 * moved.
 *
 * Three regex translations were needed:
 *
 *   Mongo                                          Postgres
 *   ------------------------------------------     --------------------------
 *   { $regex: new RegExp('^'+name+'$', 'i') }       lower(name) = lower($1)
 *   .sort({ isDefault: -1, name: 1 })               order by is_default desc, name
 *   updateMany({ category: /^name$/i })             lower(category) = lower($1)
 *
 * The anchors matter: an unanchored ILIKE would also rewrite "Fast Food" when
 * renaming "Food". See the note on `transactions.renameCategory`.
 */
import { categories, transactions } from "../db/repositories";
import { ConflictException, NotFoundException } from "../utils/app-error";
import {
  type CreateCategoryType,
  type UpdateCategoryType,
} from "../validators/category.validator";

// Junk values that should never be treated as a real category.
const RESERVED_CATEGORY_NAMES = ["undefined", "null", "uncategorized"];

const isValidCategoryName = (name?: string | null): boolean => {
  const normalized = (name ?? "").trim().toLowerCase();
  return normalized.length > 0 && !RESERVED_CATEGORY_NAMES.includes(normalized);
};

const DEFAULT_CATEGORIES = [
  { name: "Groceries", color: "#22C55E" },
  { name: "Dining & Restaurants", color: "#F97316" },
  { name: "Transportation", color: "#3B82F6" },
  { name: "Utilities", color: "#8B5CF6" },
  { name: "Entertainment", color: "#EC4899" },
  { name: "Shopping", color: "#F59E0B" },
  { name: "Healthcare", color: "#EF4444" },
  { name: "Travel", color: "#06B6D4" },
  { name: "Housing & Rent", color: "#6366F1" },
  { name: "Income", color: "#10B981" },
  { name: "Investments", color: "#0EA5E9" },
  { name: "Other", color: "#6B7280" },
];

export const getCategoriesService = async (userId: string) => {
  // PERF: fetch first and seed only when the user has no categories at all,
  // so the common case is a single indexed query instead of count + find.
  // This path also runs inside the voice/receipt AI flows, so it's hot.
  let userCategories = await categories.listByUser(userId);

  if (userCategories.length === 0) {
    /**
     * `onConflictDoNothing` on (user_id, name) rather than a plain insert.
     *
     * Two concurrent first-time requests — which the voice and receipt flows
     * make likely, since both call this — would otherwise race between the
     * emptiness check and the insert, and the loser would get a unique-index
     * error instead of a category list. Mongo's `insertMany` had the same race
     * and the same failure; this closes it.
     */
    await categories.createManyIgnoringConflicts(
      DEFAULT_CATEGORIES.map((cat) => ({
        userId,
        name: cat.name,
        color: cat.color,
        isDefault: true,
      })),
    );
    userCategories = await categories.listByUser(userId);
  }

  // Self-heal: purge any junk categories that leaked in from older clients
  // (e.g. a category literally named "undefined") so they never show again.
  const junkIds = userCategories
    .filter((cat) => !isValidCategoryName(cat.name))
    .map((cat) => cat._id);

  if (junkIds.length) {
    await categories.removeByIds(junkIds);
  }

  return userCategories.filter((cat) => isValidCategoryName(cat.name));
};

/**
 * Returns the user's category names (default + custom), seeding defaults if the
 * user has none yet. Used to feed the voice/receipt AI classifier so it maps
 * transactions to the user's real categories instead of a hardcoded list.
 */
export const getUserCategoryNames = async (userId: string): Promise<string[]> => {
  const userCategories = await getCategoriesService(userId);
  return userCategories.map((cat) => cat.name);
};

export const createCategoryService = async (
  userId: string,
  body: CreateCategoryType,
) => {
  const existing = await categories.findByName(userId, body.name);

  if (existing) {
    throw new ConflictException(`Category "${body.name}" already exists`);
  }

  return categories.create({ userId, ...body, isDefault: false });
};

export const updateCategoryService = async (
  userId: string,
  categoryId: string,
  body: UpdateCategoryType,
) => {
  const category = await categories.findById(categoryId, userId);
  if (!category) throw new NotFoundException("Category not found");

  if (body.name && body.name !== category.name) {
    const duplicate = await categories.findByName(userId, body.name, categoryId);
    if (duplicate) {
      throw new ConflictException(`Category "${body.name}" already exists`);
    }

    await transactions.renameCategory(userId, category.name, body.name);
  }

  const updated = await categories.update(categoryId, userId, body);
  // The row was read a moment ago, so a null here means it was deleted
  // concurrently; the original surfaced the same situation as a missing category.
  if (!updated) throw new NotFoundException("Category not found");
  return updated;
};

export const deleteCategoryService = async (userId: string, categoryId: string) => {
  const category = await categories.findById(categoryId, userId);
  if (!category) throw new NotFoundException("Category not found");

  await transactions.renameCategory(userId, category.name, "Uncategorized");
  await categories.remove(categoryId, userId);

  return { message: "Category deleted successfully" };
};
