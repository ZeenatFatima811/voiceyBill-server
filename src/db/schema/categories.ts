/**
 * categories — ports `src/models/category.model.ts`.
 *
 * Note this table is distinct from `users.custom_categories`. The two coexist
 * in the current implementation and `src/services/category.service.ts` reads
 * from both; the migration preserves that split rather than unifying them,
 * which would be a behaviour change.
 */
import { boolean, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";

import { createdAt, objectIdPk, objectIdRef, updatedAt } from "./columns";
import { users } from "./users";

export const categories = pgTable(
  "categories",
  {
    id: objectIdPk(),

    userId: objectIdRef("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    /** `trim: true` in mongoose; normalised in the mapper. */
    name: text("name").notNull(),
    color: text("color").notNull().default("#6B7280"),
    isDefault: boolean("is_default").notNull().default(false),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex("categories_user_id_name_key").on(table.userId, table.name)],
);

export type CategoryRow = typeof categories.$inferSelect;
export type NewCategoryRow = typeof categories.$inferInsert;
