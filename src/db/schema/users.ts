/**
 * users — ports `src/models/user.model.ts`.
 *
 * Two mongoose behaviours have no Postgres equivalent and move into code:
 *
 *  • `select: false` on the OTP fields. Mongoose omitted them from every query
 *    unless explicitly asked for. Postgres has no column-level projection
 *    default, so `src/db/mappers/user.mapper.ts` owns that split: the default
 *    column list excludes them and only the OTP flows select them.
 *  • The `pre("save")` bcrypt hook. Hashing moves to the user repository so it
 *    happens on exactly the paths that previously triggered `isModified`.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { createdAt, instant, objectIdPk, updatedAt } from "./columns";

/** Mirrors `AuthProvider` in the mongoose model. */
export const AUTH_PROVIDERS = ["local", "google"] as const;
export type AuthProvider = (typeof AUTH_PROVIDERS)[number];

/**
 * `customCategories` was an embedded array of `{ value, label }` subdocuments
 * with `_id` suppressed. It stays denormalised as jsonb rather than becoming a
 * child table: it is only ever read and written as a whole array, never queried
 * by element, and jsonb reproduces the array's ordering and JSON shape exactly.
 */
export type CustomCategory = { value: string; label: string };

export const users = pgTable(
  "users",
  {
    id: objectIdPk(),

    name: text("name").notNull(),
    /**
     * Stored already lowercased and trimmed, as the mongoose `lowercase`/`trim`
     * options did. Normalisation is the mapper's job so a caller cannot bypass
     * it by writing raw SQL.
     */
    email: text("email").notNull(),
    password: text("password"),
    profilePicture: text("profile_picture"),
    baseCurrency: text("base_currency").notNull().default("USD"),

    isVerified: boolean("is_verified").notNull().default(false),
    provider: text("provider", { enum: AUTH_PROVIDERS }).notNull().default("local"),
    providerId: text("provider_id"),

    // `select: false` in mongoose — never included in default projections.
    emailVerificationOtpHash: text("email_verification_otp_hash"),
    emailVerificationOtpExpiresAt: instant("email_verification_otp_expires_at"),
    passwordResetOtpHash: text("password_reset_otp_hash"),
    passwordResetOtpExpiresAt: instant("password_reset_otp_expires_at"),
    lastOtpResentAt: instant("last_otp_resent_at"),

    /**
     * Refresh-token generation counter. Bumping it invalidates every refresh
     * token issued earlier (used on password reset/change).
     */
    tokenVersion: integer("token_version").notNull().default(0),

    customCategories: jsonb("custom_categories")
      .$type<CustomCategory[]>()
      .notNull()
      .default([]),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // `unique: true` on the mongoose path.
    uniqueIndex("users_email_key").on(table.email),
    /**
     * `{ sparse: true, index: true }` in mongoose — indexed but NOT unique, and
     * skipping the (many) local-auth rows where providerId is null. The partial
     * predicate reproduces the sparseness.
     *
     * Deliberately left non-unique to match current behaviour exactly. A unique
     * constraint on (provider, provider_id) is arguably the correct model for
     * OAuth identities, but adding one here would be a behaviour change that
     * could also fail the data backfill on pre-existing duplicates. Worth doing
     * as a separate, deliberate migration after the cutover.
     */
    index("users_provider_id_idx")
      .on(table.providerId)
      .where(sql`provider_id is not null`),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
