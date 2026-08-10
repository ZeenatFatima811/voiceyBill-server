/**
 * Auth service — ported from mongoose to the Postgres repository layer.
 *
 * Signatures and returned shapes are unchanged; only the data access moved.
 *
 * Notes on the port:
 *
 *  • `session.withTransaction` becomes `withTransaction`, and every repository
 *    call inside it takes the transaction as its trailing argument. Forgetting
 *    one runs that statement outside the transaction, exactly as forgetting
 *    `{ session }` did under mongoose.
 *
 *  • Registration keeps its "build the email payload inside, send it after"
 *    shape. Sending inside would put a network call in the transaction's
 *    critical path, and a rolled-back registration would still have emailed an
 *    OTP for an account that does not exist.
 *
 *  • The OTP columns are `select: false` under mongoose, so every read that
 *    needs one goes through a `*WithSecrets` reader. `omitPassword()` is the
 *    default projection now, so the safe shape is what a caller gets unless it
 *    explicitly asks otherwise.
 */
import jwt from "jsonwebtoken";

import { stripSecrets, type UserApi } from "../db/mappers/user.mapper";
import { reports, users, withTransaction, type Executor } from "../db/repositories";
import { ReportFrequencyEnum } from "../enums/domain.enum";
import { ErrorCodeEnum } from "../enums/error-code.enum";
import { sendPasswordResetEmail } from "../mailers/password-reset.mailer";
import { sendVerificationOtpEmail } from "../mailers/verification.mailer";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from "../utils/app-error";
import { compareValue } from "../utils/bcrypt";
import { calculateNextReportDate } from "../utils/helper";
import { signJwtToken, signRefreshToken, verifyRefreshToken } from "../utils/jwt";
import { compareOtp, generateOtp, getOtpExpiresAt, hashOtp } from "../utils/otp";
import type {
  ForgotPasswordSchemaType,
  LoginSchemaType,
  RegisterSchemaType,
  ResendOtpSchemaType,
  ResetPasswordSchemaType,
  VerifyOtpSchemaType,
} from "../validators/auth.validator";

const OTP_RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds

const createDefaultReportSetting = async (userId: string, exec?: Executor) => {
  const existing = await reports.findSettingByUser(userId, exec);
  if (existing) return existing;

  return reports.createSetting(
    {
      userId,
      frequency: ReportFrequencyEnum.MONTHLY,
      isEnabled: true,
      nextReportDate: calculateNextReportDate(),
      lastSentDate: null,
    },
    exec,
  );
};

/**
 * Issues a fresh verification OTP and stores its hash.
 *
 * Returns the plaintext OTP alongside the updated user, so the caller does not
 * have to re-read the row it just wrote.
 */
const issueVerificationOtp = async (
  userId: string,
  exec?: Executor,
): Promise<{ otp: string; user: UserApi }> => {
  const otp = generateOtp();

  const user = await users.update(
    userId,
    {
      emailVerificationOtpHash: await hashOtp(otp),
      emailVerificationOtpExpiresAt: getOtpExpiresAt(),
    },
    exec,
  );

  // The row was read moments earlier on this same transaction, so a null here
  // means it was deleted concurrently rather than that the id was wrong.
  if (!user) throw new NotFoundException("Account not found");

  return { otp, user };
};

export const registerService = async (body: RegisterSchemaType) => {
  let verificationEmailPayload:
    | { email: string; username: string; otp: string }
    | undefined;

  const response = await withTransaction(async (tx) => {
    const existingUser = await users.findByEmailWithSecrets(body.email, tx);

    if (existingUser?.isVerified) {
      throw new ConflictException(
        "An account with this email already exists. Please sign in instead.",
        ErrorCodeEnum.AUTH_EMAIL_ALREADY_EXISTS,
      );
    }

    if (existingUser && !existingUser.isVerified) {
      const { otp, user } = await issueVerificationOtp(existingUser._id, tx);

      verificationEmailPayload = {
        email: existingUser.email,
        username: existingUser.name,
        otp,
      };

      return { user, verificationRequired: true };
    }

    const created = await users.create({ ...body, isVerified: false }, tx);
    const { otp, user } = await issueVerificationOtp(created._id, tx);

    verificationEmailPayload = {
      email: created.email,
      username: created.name,
      otp,
    };

    return { user, verificationRequired: true };
  });

  // Outside the transaction: a rolled-back registration must not have emailed
  // an OTP for an account that no longer exists.
  if (verificationEmailPayload) {
    await sendVerificationOtpEmail(verificationEmailPayload);
  }

  return response;
};

export const loginService = async (body: LoginSchemaType) => {
  const { email, password } = body;
  const user = await users.findByEmailWithSecrets(email);
  if (!user) throw new NotFoundException("Email/password not found");

  if (user.isVerified === false) {
    throw new UnauthorizedException(
      "Account is not verified. Please verify your email first.",
      ErrorCodeEnum.AUTH_EMAIL_NOT_VERIFIED,
    );
  }

  // `comparePassword` returned false outright when no password was set, which
  // is the case for Google accounts.
  const isPasswordValid = user.password
    ? await compareValue(password, user.password)
    : false;

  if (!isPasswordValid) {
    throw new UnauthorizedException("Invalid email/password");
  }

  const { token, expiresAt } = signJwtToken({ userId: user._id });
  const refreshToken = signRefreshToken({
    userId: user._id,
    tokenVersion: user.tokenVersion ?? 0,
  });

  const reportSetting = await reports.findSettingSummaryByUser(user._id);

  return {
    // The safe projection of the row already in hand — `stripSecrets` is
    // `omitPassword()`. Re-reading it would be a second round trip on the
    // hottest path in the API, and would make the field nullable for a row that
    // demonstrably exists.
    user: stripSecrets(user),
    accessToken: token,
    refreshToken,
    expiresAt,
    reportSetting,
  };
};

export const verifyOtpService = async (body: VerifyOtpSchemaType) => {
  const { email, otp } = body;

  const user = await users.findByEmailWithSecrets(email);
  if (!user) throw new NotFoundException("Account not found");

  if (user.isVerified) {
    return {
      // Already-verified short circuit: the row is in hand and unmodified, so
      // the safe projection of it is exactly what `omitPassword()` returned.
      user: stripSecrets(user),
      verified: true,
    };
  }

  if (!user.emailVerificationOtpHash) {
    throw new BadRequestException(
      "Verification code not found. Please request a new code.",
      ErrorCodeEnum.AUTH_OTP_INVALID,
    );
  }

  if (
    !user.emailVerificationOtpExpiresAt ||
    user.emailVerificationOtpExpiresAt.getTime() < Date.now()
  ) {
    await users.update(user._id, {
      emailVerificationOtpHash: null,
      emailVerificationOtpExpiresAt: null,
    });

    throw new UnauthorizedException(
      "Verification code has expired. Please request a new code.",
      ErrorCodeEnum.AUTH_OTP_EXPIRED,
    );
  }

  const isOtpValid = await compareOtp(otp, user.emailVerificationOtpHash);

  if (!isOtpValid) {
    throw new UnauthorizedException(
      "Invalid verification code",
      ErrorCodeEnum.AUTH_OTP_INVALID,
    );
  }

  /**
   * Verification and the default report setting commit together.
   *
   * The mongoose version saved the user, then created the setting in a separate
   * statement with no session, so a failure in between left a verified account
   * with no report setting and nothing to repair it.
   */
  const verified = await withTransaction(async (tx) => {
    const updated = await users.update(
      user._id,
      {
        isVerified: true,
        emailVerificationOtpHash: null,
        emailVerificationOtpExpiresAt: null,
      },
      tx,
    );

    // Deleted concurrently is the only way this is null — the row was read at
    // the top of this function.
    if (!updated) throw new NotFoundException("Account not found");

    await createDefaultReportSetting(user._id, tx);
    return updated;
  });

  // Auto-login: Generate JWT tokens
  const { token, expiresAt } = signJwtToken({ userId: verified._id });
  const refreshToken = signRefreshToken({
    userId: verified._id,
    tokenVersion: user.tokenVersion ?? 0,
  });

  const reportSetting = await reports.findSettingSummaryByUser(verified._id);

  return {
    user: verified,
    accessToken: token,
    refreshToken,
    expiresAt,
    reportSetting,
    verified: true,
  };
};

export const resendOtpService = async (body: ResendOtpSchemaType) => {
  const { email } = body;

  const user = await users.findByEmailWithSecrets(email);
  if (!user) throw new NotFoundException("Account not found");

  if (user.isVerified) {
    throw new ConflictException("Account is already verified");
  }

  // Enforce cooldown between resend requests (per-email rate limiting)
  if (user.lastOtpResentAt) {
    const elapsed = Date.now() - user.lastOtpResentAt.getTime();
    if (elapsed < OTP_RESEND_COOLDOWN_MS) {
      const retryAfterSeconds = Math.ceil((OTP_RESEND_COOLDOWN_MS - elapsed) / 1000);
      throw new BadRequestException(
        `Please wait ${retryAfterSeconds} second(s) before requesting a new code.`,
        ErrorCodeEnum.AUTH_TOO_MANY_ATTEMPTS,
      );
    }
  }

  const otp = generateOtp();
  await users.update(user._id, {
    emailVerificationOtpHash: await hashOtp(otp),
    emailVerificationOtpExpiresAt: getOtpExpiresAt(),
    lastOtpResentAt: new Date(),
  });

  await sendVerificationOtpEmail({
    email: user.email,
    username: user.name,
    otp,
  });

  return {
    message: "Verification code resent successfully",
  };
};

export const forgotPasswordService = async (body: ForgotPasswordSchemaType) => {
  const { email } = body;

  const user = await users.findByEmailWithSecrets(email);
  if (!user) {
    // Deliberately indistinguishable from success — the response must not
    // reveal whether an account exists.
    return {
      message: "If the email exists, a reset code has been sent",
    };
  }

  const otp = generateOtp();
  await users.update(user._id, {
    passwordResetOtpHash: await hashOtp(otp),
    passwordResetOtpExpiresAt: getOtpExpiresAt(),
  });

  await sendPasswordResetEmail({
    email: user.email,
    username: user.name,
    otp,
  });

  return {
    message: "If the email exists, a reset code has been sent",
  };
};

export const resetPasswordService = async (body: ResetPasswordSchemaType) => {
  const { email, otp, password } = body;

  const user = await users.findByEmailWithSecrets(email);
  if (!user) throw new NotFoundException("Account not found");

  if (!user.passwordResetOtpHash) {
    throw new BadRequestException(
      "Reset code not found. Please request a new code.",
      ErrorCodeEnum.AUTH_OTP_INVALID,
    );
  }

  if (
    !user.passwordResetOtpExpiresAt ||
    user.passwordResetOtpExpiresAt.getTime() < Date.now()
  ) {
    await users.update(user._id, {
      passwordResetOtpHash: null,
      passwordResetOtpExpiresAt: null,
    });

    throw new UnauthorizedException(
      "Reset code has expired. Please request a new code.",
      ErrorCodeEnum.AUTH_OTP_EXPIRED,
    );
  }

  const isOtpValid = await compareOtp(otp, user.passwordResetOtpHash);

  if (!isOtpValid) {
    throw new UnauthorizedException("Invalid reset code", ErrorCodeEnum.AUTH_OTP_INVALID);
  }

  /**
   * The new password, the cleared OTP and the token-version bump commit
   * together. A partial apply here is a security bug: clearing the OTP without
   * bumping the version would leave every stolen refresh token alive.
   *
   * The bump is `token_version + 1` computed IN SQL rather than read-then-write,
   * so two concurrent resets cannot both read the same value and write the same
   * bump — which would revoke one fewer generation than intended.
   */
  await withTransaction(async (tx) => {
    await users.setPassword(user._id, password, tx);
    await users.update(
      user._id,
      {
        passwordResetOtpHash: null,
        passwordResetOtpExpiresAt: null,
      },
      tx,
    );
    await users.bumpTokenVersion(user._id, tx);
  });

  return {
    message: "Password reset successfully",
  };
};

export const refreshTokenService = async (refreshToken: string) => {
  let payload: { userId: string; tokenVersion?: number };
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new UnauthorizedException(
        "Refresh token expired. Please sign in again.",
        ErrorCodeEnum.AUTH_REFRESH_TOKEN_INVALID,
      );
    }
    throw new UnauthorizedException(
      "Invalid refresh token",
      ErrorCodeEnum.AUTH_REFRESH_TOKEN_INVALID,
    );
  }

  const user = await users.findByIdWithSecrets(payload.userId);
  if (!user || user.isVerified === false) {
    throw new UnauthorizedException(
      "Account no longer eligible to refresh",
      ErrorCodeEnum.AUTH_REFRESH_TOKEN_INVALID,
    );
  }

  // Tokens signed before the version bump (e.g. before a password reset) are
  // revoked. Tokens issued before this field existed carry no claim — treat
  // them as version 0 so existing sessions keep working.
  if ((payload.tokenVersion ?? 0) !== (user.tokenVersion ?? 0)) {
    throw new UnauthorizedException(
      "Refresh token has been revoked. Please sign in again.",
      ErrorCodeEnum.AUTH_REFRESH_TOKEN_INVALID,
    );
  }

  const { token: accessToken, expiresAt } = signJwtToken({ userId: user._id });
  const nextRefreshToken = signRefreshToken({
    userId: user._id,
    tokenVersion: user.tokenVersion ?? 0,
  });

  const reportSetting = await reports.findSettingSummaryByUser(user._id);

  return {
    // As in `loginService`: the safe projection of the row already read.
    user: stripSecrets(user),
    accessToken,
    refreshToken: nextRefreshToken,
    expiresAt,
    reportSetting,
  };
};
