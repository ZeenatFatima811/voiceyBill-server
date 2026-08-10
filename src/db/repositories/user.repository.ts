/**
 * users repository.
 *
 * Replaces the `UserModel.*` calls in auth, google-auth, user, budget,
 * transaction and report services.
 *
 * Two mongoose behaviours are reproduced here rather than in the mapper, since
 * both are conditional on what is being written:
 *
 *  • The `pre("save")` bcrypt hook, which hashed the password ONLY when that
 *    path was modified. `create` and `setPassword` hash; no other update path
 *    touches it. Hashing in the mapper would re-hash an already-hashed value on
 *    every unrelated update and lock the user out.
 *
 *  • The `select: false` projection. Reads return the safe shape by default;
 *    the OTP and password fields are reachable only through the `*WithSecrets`
 *    functions, which are named so the risk is visible at the call site.
 */
import { and, eq, sql } from "drizzle-orm";

import { hashValue } from "../../utils/bcrypt";
import { normaliseEmail } from "../mappers/common";
import {
  stripSecrets,
  toUserApi,
  toUserRow,
  toUserUpdate,
  toUserWithSecrets,
  type UserApi,
  type UserInput,
  type UserSecrets,
  type UserWithSecrets,
} from "../mappers/user.mapper";
import { newObjectId, toObjectId } from "../object-id";
import { users } from "../schema/users";
import { executor, type Executor } from "../unit-of-work";

const one = <T>(rows: T[]): T | null => rows[0] ?? null;

/**
 * Guards every id lookup.
 *
 * Mongo threw a CastError on a malformed ObjectId, which surfaced as a 4xx.
 * Postgres would instead compare the string against a `char(24)` column and
 * simply match nothing — a different status code for the same input. Returning
 * null early keeps the "not found" behaviour the clients already handle; see
 * callers that pass an unvalidated route param.
 */
const validId = (id: string): string | null => toObjectId(id);

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export const findById = async (
  id: string,
  exec?: Executor,
): Promise<UserApi | null> => {
  const key = validId(id);
  if (!key) return null;
  const rows = await executor(exec).select().from(users).where(eq(users.id, key));
  const row = one(rows);
  return row ? toUserApi(row) : null;
};

export const findByIdWithSecrets = async (
  id: string,
  exec?: Executor,
): Promise<UserWithSecrets | null> => {
  const key = validId(id);
  if (!key) return null;
  const rows = await executor(exec).select().from(users).where(eq(users.id, key));
  const row = one(rows);
  return row ? toUserWithSecrets(row) : null;
};

/**
 * Email lookup.
 *
 * Normalises the argument the same way the write path does. Mongoose's
 * `lowercase: true` applied to QUERIES as well as writes, so `findOne({ email:
 * "Main@X.io" })` matched a row stored lowercase. Without this a mixed-case
 * login would simply fail to find the account.
 */
export const findByEmailWithSecrets = async (
  email: string,
  exec?: Executor,
): Promise<UserWithSecrets | null> => {
  const rows = await executor(exec)
    .select()
    .from(users)
    .where(eq(users.email, normaliseEmail(email)));
  const row = one(rows);
  return row ? toUserWithSecrets(row) : null;
};

export const findByProviderId = async (
  provider: string,
  providerId: string,
  exec?: Executor,
): Promise<UserWithSecrets | null> => {
  const rows = await executor(exec)
    .select()
    .from(users)
    .where(and(eq(users.provider, provider as "local" | "google"), eq(users.providerId, providerId)));
  const row = one(rows);
  return row ? toUserWithSecrets(row) : null;
};

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface CreateUserInput extends Omit<UserInput, "id"> {
  id?: string;
}

/**
 * Inserts a user, hashing the password exactly as the `pre("save")` hook did.
 */
export const create = async (
  input: CreateUserInput,
  exec?: Executor,
): Promise<UserWithSecrets> => {
  const password = input.password ? await hashValue(input.password) : null;

  const row = toUserRow({
    ...input,
    id: input.id ?? newObjectId(),
    password,
  } as UserInput);

  const [created] = await executor(exec).insert(users).values(row).returning();
  return toUserWithSecrets(created);
};

/**
 * Partial update.
 *
 * Never touches `password` — use `setPassword`, which hashes. Fields the caller
 * omitted are left alone rather than nulled; see `definedOnly`.
 */
export const update = async (
  id: string,
  patch: Partial<UserInput> & Partial<Omit<UserSecrets, "password">>,
  exec?: Executor,
): Promise<UserApi | null> => {
  const key = validId(id);
  if (!key) return null;

  const values = toUserUpdate(patch);
  if (Object.keys(values).length === 0) return findById(key, exec);

  const [row] = await executor(exec)
    .update(users)
    .set(values)
    .where(eq(users.id, key))
    .returning();
  return row ? toUserApi(row) : null;
};

/** Hashes and stores a new password. The only path that may write the column. */
export const setPassword = async (
  id: string,
  plainPassword: string,
  exec?: Executor,
): Promise<UserApi | null> => {
  const key = validId(id);
  if (!key) return null;

  const [row] = await executor(exec)
    .update(users)
    // Explicit updatedAt: this bypasses the mapper (see renameCategory).
    .set({ password: await hashValue(plainPassword), updatedAt: new Date() })
    .where(eq(users.id, key))
    .returning();
  return row ? toUserApi(row) : null;
};

/**
 * Increments `tokenVersion`, invalidating every refresh token issued earlier.
 *
 * Done as a SQL increment rather than read-modify-write so two concurrent
 * password resets cannot both read the same value and write the same bump,
 * leaving one of the sessions alive.
 */
export const bumpTokenVersion = async (
  id: string,
  exec?: Executor,
): Promise<number | null> => {
  const key = validId(id);
  if (!key) return null;

  const [row] = await executor(exec)
    .update(users)
    .set({ tokenVersion: sql`${users.tokenVersion} + 1`, updatedAt: new Date() })
    .where(eq(users.id, key))
    .returning();
  return row ? row.tokenVersion : null;
};

/**
 * Deletes the user.
 *
 * The child tables carry ON DELETE CASCADE, so transactions, budgets,
 * categories, reports and report settings go with it in one statement — where
 * the Mongo implementation issued five explicit `deleteMany` calls first. The
 * cascade means the counts come out the same either way.
 */
export const remove = async (id: string, exec?: Executor): Promise<UserApi | null> => {
  const key = validId(id);
  if (!key) return null;

  const [row] = await executor(exec).delete(users).where(eq(users.id, key)).returning();
  return row ? toUserApi(row) : null;
};

export { stripSecrets };
