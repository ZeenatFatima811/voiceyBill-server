/**
 * users <-> API shape.
 *
 * This mapper carries the migration's biggest security-shaped risk. Mongoose
 * marked the OTP fields `select: false`, so they were absent from every query
 * unless explicitly asked for, and `omitPassword()` stripped the password and
 * `tokenVersion` on top. Postgres has no column-level projection default: a
 * `select *` port ships password hashes and OTP hashes straight to clients.
 *
 * So the safe shape is the DEFAULT here. `toUserApi` is the only thing
 * repositories hand back for user reads, and the sensitive fields are reachable
 * only through the explicitly named `toUserWithSecrets`.
 *
 * Reference payload — note the absence of `id`, `password`, `tokenVersion` and
 * every `*Otp*` field:
 *
 *   { "_id": "…a1", "baseCurrency": "USD", "createdAt": …,
 *     "customCategories": [{ "label": "Side Hustle", "value": "side-hustle" }],
 *     "email": "user@example.com", "isVerified": true, "name": "Example User",
 *     "profilePicture": null, "provider": "local", "providerId": null,
 *     "updatedAt": … }
 */
import type { CustomCategory, NewUserRow, UserRow } from "../schema/users";

import {
  definedOnly,
  insertStamps,
  normaliseCurrency,
  normaliseEmail,
  normaliseTrimmed,
  updateStamp,
  withMongoId,
} from "./common";

/**
 * What `omitPassword()` returned. No `id` virtual: the user schema declares no
 * `toJSON` options, and `omitPassword` goes through `toObject()`.
 */
export interface UserApi {
  _id: string;
  name: string;
  email: string;
  profilePicture: string | null;
  baseCurrency: string;
  isVerified: boolean;
  provider: string;
  providerId: string | null;
  customCategories: CustomCategory[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The fields mongoose hid behind `select: false`, plus the two `omitPassword`
 * deleted. Named so that a reviewer sees the risk at the call site.
 */
export interface UserSecrets {
  password: string | null;
  tokenVersion: number;
  emailVerificationOtpHash: string | null;
  emailVerificationOtpExpiresAt: Date | null;
  passwordResetOtpHash: string | null;
  passwordResetOtpExpiresAt: Date | null;
  lastOtpResentAt: Date | null;
}

export type UserWithSecrets = UserApi & UserSecrets;

/**
 * The safe projection. Everything sensitive is dropped by construction rather
 * than by a deny-list, so a column added to the table later cannot leak by
 * default — it simply will not appear until someone adds it here.
 */
export const toUserApi = (row: UserRow): UserApi => {
  const doc = withMongoId(row);
  return {
    _id: doc._id,
    name: doc.name,
    email: doc.email,
    profilePicture: doc.profilePicture,
    baseCurrency: doc.baseCurrency,
    isVerified: doc.isVerified,
    provider: doc.provider,
    providerId: doc.providerId,
    customCategories: doc.customCategories ?? [],
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
};

export const toUserApiList = (rows: UserRow[]): UserApi[] => rows.map(toUserApi);

/**
 * The full row, secrets included.
 *
 * ONLY for the auth and OTP flows that genuinely need to compare a hash or bump
 * `tokenVersion`. Never return this from a controller — pass it through
 * `stripSecrets` first.
 */
export const toUserWithSecrets = (row: UserRow): UserWithSecrets => ({
  ...toUserApi(row),
  password: row.password,
  tokenVersion: row.tokenVersion,
  emailVerificationOtpHash: row.emailVerificationOtpHash,
  emailVerificationOtpExpiresAt: row.emailVerificationOtpExpiresAt,
  passwordResetOtpHash: row.passwordResetOtpHash,
  passwordResetOtpExpiresAt: row.passwordResetOtpExpiresAt,
  lastOtpResentAt: row.lastOtpResentAt,
});

/** The `omitPassword()` equivalent, for when only the secrets-bearing object is in hand. */
export const stripSecrets = (user: UserWithSecrets): UserApi => {
  const {
    password: _password,
    tokenVersion: _tokenVersion,
    emailVerificationOtpHash: _evh,
    emailVerificationOtpExpiresAt: _eve,
    passwordResetOtpHash: _prh,
    passwordResetOtpExpiresAt: _pre,
    lastOtpResentAt: _lor,
    ...safe
  } = user;
  return safe;
};

export interface UserInput {
  id: string;
  name: string;
  email: string;
  password?: string | null;
  profilePicture?: string | null;
  baseCurrency?: string;
  isVerified?: boolean;
  provider?: string;
  providerId?: string | null;
  tokenVersion?: number;
  customCategories?: CustomCategory[];
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * Applies the mongoose path options: `lowercase`/`trim` on email, `uppercase`/
 * `trim` on baseCurrency, `trim` on name and on every custom-category field.
 *
 * The database re-checks the email and currency cases, so a path that skips
 * this mapper fails loudly instead of writing a row that lookups can never find.
 *
 * NOTE: password hashing is NOT done here. It lived in a `pre("save")` hook
 * that fired only when the path was modified, and the user repository
 * reproduces that condition — doing it in the mapper would re-hash an already
 * hashed value on every update.
 */
export const toUserRow = (input: UserInput): NewUserRow =>
  ({
    ...input,
    ...insertStamps(input),
    name: normaliseTrimmed(input.name),
    email: normaliseEmail(input.email),
    baseCurrency:
      input.baseCurrency === undefined
        ? undefined
        : normaliseCurrency(input.baseCurrency),
    customCategories: input.customCategories?.map((category) => ({
      value: normaliseTrimmed(category.value),
      label: normaliseTrimmed(category.label),
    })),
  }) as NewUserRow;

export const toUserUpdate = (
  patch: Partial<UserInput> & Partial<UserSecrets>,
): Partial<NewUserRow> => {
  const mapped: Record<string, unknown> = { ...patch };

  if (patch.name !== undefined) mapped.name = normaliseTrimmed(patch.name);
  if (patch.email !== undefined) mapped.email = normaliseEmail(patch.email);
  if (patch.baseCurrency !== undefined) {
    mapped.baseCurrency = normaliseCurrency(patch.baseCurrency);
  }
  if (patch.customCategories !== undefined) {
    mapped.customCategories = patch.customCategories?.map((category) => ({
      value: normaliseTrimmed(category.value),
      label: normaliseTrimmed(category.label),
    }));
  }

  return { ...definedOnly(mapped), ...updateStamp(patch) } as Partial<NewUserRow>;
};
