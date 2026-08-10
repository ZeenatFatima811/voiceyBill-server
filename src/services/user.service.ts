/**
 * User service — ported from mongoose to the Postgres repository layer.
 *
 * Signatures and returned shapes are unchanged; only the data access moved.
 *
 * Two mongoose behaviours had to be reproduced explicitly:
 *
 *  • `omitPassword()` — now `users.findById`, which returns the safe projection
 *    by construction. The OTP flows use `findByIdWithSecrets`, the only way to
 *    reach a hash.
 *
 *  • `user.set({ password }); user.save()` fired the `pre("save")` bcrypt hook.
 *    That is `users.setPassword`, the only path allowed to write the column.
 */
import { transactions, users, withTransaction } from "../db/repositories";
import { ErrorCodeEnum } from "../enums/error-code.enum";
import { sendAccountDeletionOtpEmail } from "../mailers/account-deletion.mailer";
import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from "../utils/app-error";
import { compareValue } from "../utils/bcrypt";
import { compareOtp, generateOtp, getOtpExpiresAt, hashOtp } from "../utils/otp";
import type {
  ChangePasswordType,
  DeleteAccountType,
  UpdateUserType,
} from "../validators/user.validator";

import { exchangeRateService } from "./exchange-rate.service";

/**
 * Returns `undefined` — not null — when the user is missing.
 *
 * The original was `user?.omitPassword()`, so a missing user produced
 * `undefined`, and the controller's response shape follows from that. The
 * controller.  Returning null here would change that response shape.
 */
export const findByIdUserService = async (userId: string) => {
  const user = await users.findById(userId);
  return user ?? undefined;
};

export const updateUserService = async (
  userId: string,
  body: UpdateUserType,
  profilePic?: Express.Multer.File,
) => {
  const user = await users.findById(userId);
  if (!user) throw new NotFoundException("User not found");

  const previousBaseCurrency = user.baseCurrency || "USD";
  const nextBaseCurrency = body.baseCurrency?.toUpperCase();

  if (nextBaseCurrency && nextBaseCurrency !== previousBaseCurrency) {
    await rebaseTransactionsToCurrency(userId, previousBaseCurrency, nextBaseCurrency);
  }

  const updated = await users.update(userId, {
    ...(profilePic && { profilePicture: profilePic.path }),
    ...(body.name && { name: body.name }),
    ...(nextBaseCurrency && { baseCurrency: nextBaseCurrency }),
    ...(body.customCategories && { customCategories: body.customCategories }),
  });

  if (!updated) throw new NotFoundException("User not found");
  return updated;
};

export const changePasswordService = async (
  userId: string,
  body: ChangePasswordType,
) => {
  const user = await users.findByIdWithSecrets(userId);
  if (!user) throw new NotFoundException("User not found");

  // `comparePassword` on the document; false when no password is set at all,
  // which is the case for Google accounts.
  const isCurrentPasswordValid = user.password
    ? await compareValue(body.currentPassword, user.password)
    : false;

  if (!isCurrentPasswordValid) {
    throw new UnauthorizedException(
      "Current password is incorrect",
      ErrorCodeEnum.ACCESS_UNAUTHORIZED,
    );
  }

  await users.setPassword(userId, body.newPassword);

  return { message: "Password changed successfully" };
};

export const sendDeleteAccountOtpService = async (userId: string) => {
  const user = await users.findByIdWithSecrets(userId);
  if (!user) throw new NotFoundException("User not found");

  const otp = generateOtp();
  await users.update(userId, {
    emailVerificationOtpHash: await hashOtp(otp),
    emailVerificationOtpExpiresAt: getOtpExpiresAt(),
  });

  await sendAccountDeletionOtpEmail({
    email: user.email,
    username: user.name,
    otp,
  });
};

export const deleteUserService = async (userId: string, body: DeleteAccountType) => {
  const user = await users.findByIdWithSecrets(userId);
  if (!user) throw new NotFoundException("User not found");

  if (!user.emailVerificationOtpHash) {
    throw new BadRequestException(
      "OTP verification is required before deleting your account",
      ErrorCodeEnum.ACCESS_UNAUTHORIZED,
    );
  }

  if (
    !user.emailVerificationOtpExpiresAt ||
    user.emailVerificationOtpExpiresAt.getTime() < Date.now()
  ) {
    await users.update(userId, {
      emailVerificationOtpHash: null,
      emailVerificationOtpExpiresAt: null,
    });

    throw new UnauthorizedException(
      "OTP code has expired. Please request a new code.",
      ErrorCodeEnum.AUTH_OTP_EXPIRED,
    );
  }

  const isOtpValid = await compareOtp(body.otp, user.emailVerificationOtpHash);

  if (!isOtpValid) {
    throw new UnauthorizedException("Invalid OTP code", ErrorCodeEnum.AUTH_OTP_INVALID);
  }

  /**
   * One statement, not five.
   *
   * The Mongo version deleted transactions, reports, report settings and
   * budgets by hand and then the user. Here the foreign keys carry ON DELETE
   * CASCADE, so removing the user takes its children with it atomically —
   * where the original could fail between two of its five deletes and leave a
   * half-deleted account behind.
   *
   * NOTE one genuine difference: the Mongo version did NOT delete the user's
   * categories, so they were orphaned. The cascade removes them. Accepted
   * because it is invisible through the API — every category query filters by
   * `userId` and the user is gone, so the rows were unreachable garbage — and
   * preserving the old behaviour would mean dropping the foreign key, which
   * would then block account deletion outright.
   */
  await users.remove(userId);

  return { message: "User deleted successfully" };
};

/**
 * Re-denominates every transaction into a new base currency.
 *
 * Runs in ONE transaction, where the Mongo version issued an unordered
 * `bulkWrite`. That is a deliberate tightening: a partial failure previously
 * left an account with some transactions in the old currency and some in the
 * new, with no record of which. Either the whole rebase lands or none of it
 * does.
 */
async function rebaseTransactionsToCurrency(
  userId: string,
  previousBaseCurrency: string,
  nextBaseCurrency: string,
) {
  const userTransactions = await transactions.list({ userId });

  // cache exchange rate per currency pair — avoids N API calls
  const rateCache = new Map<string, number>();

  const updates: { id: string; patch: Record<string, unknown> }[] = [];
  const errors: string[] = [];

  for (const transaction of userTransactions) {
    try {
      // Amounts here are DOLLARS on both sides — the repository converts.
      const sourceAmount =
        transaction.originalAmount != null
          ? transaction.originalAmount
          : transaction.amount;
      const sourceCurrency =
        transaction.originalCurrency ||
        transaction.baseCurrencyAtTime ||
        previousBaseCurrency;

      const cacheKey = `${sourceCurrency}->${nextBaseCurrency}`;

      if (!rateCache.has(cacheKey)) {
        const rateResult = await exchangeRateService.getRate(
          sourceCurrency.toUpperCase(),
          nextBaseCurrency.toUpperCase(),
        );
        rateCache.set(cacheKey, rateResult.rate);
      }

      const rate = rateCache.get(cacheKey)!;
      const convertedAmount = Number(sourceAmount) * rate;

      updates.push({
        id: transaction._id,
        patch: {
          amount: convertedAmount,
          originalAmount: sourceAmount,
          originalCurrency: sourceCurrency.toUpperCase(),
          baseCurrencyAtTime: nextBaseCurrency.toUpperCase(),
          exchangeRate: rate,
          rateSource: "cached",
          exchangeRateFetchedAt: new Date(),
        },
      });
    } catch (error: any) {
      errors.push(`Transaction ${transaction._id}: ${error.message}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Currency rebase failed for ${errors.length} transactions: ${errors.join(", ")}`,
    );
  }

  if (updates.length > 0) {
    await withTransaction(async (tx) => {
      for (const { id, patch } of updates) {
        await transactions.update(id, patch, undefined, tx);
      }
    });
  }
}
