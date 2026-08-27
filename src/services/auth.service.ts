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
import { markUserLoggedOut } from "../utils/auth-session";
import {
  storeVerificationOtp,
  getVerificationOtp,
  deleteVerificationOtp,
  storePasswordResetOtp,
  getPasswordResetOtp,
  deletePasswordResetOtp,
} from "../utils/otp-redis";

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
): Promise<{ otp: string; otpHash: string; user: UserApi }> => {
  const otp = generateOtp();
  const otpHash = await hashOtp(otp);

  const user = await users.update(
    userId,
    {
      emailVerificationOtpHash: null,
      emailVerificationOtpExpiresAt: null,
    },
    exec,
  );

  if (!user) throw new NotFoundException("Account not found");

  return { otp, otpHash, user };
};

export const registerService = async (body: RegisterSchemaType) => {
  const transactionResult = await withTransaction(async (tx) => {
    const existingUser = await users.findByEmailWithSecrets(body.email, tx);

    if (existingUser?.isVerified) {
      throw new ConflictException(
        "An account with this email already exists. Please sign in instead.",
        ErrorCodeEnum.AUTH_EMAIL_ALREADY_EXISTS,
      );
    }

    if (existingUser && !existingUser.isVerified) {
      const { otp, otpHash, user } = await issueVerificationOtp(
        existingUser._id,
        tx,
      );

      return {
        user,
        verificationRequired: true,
        otpHash,
        email: existingUser.email,
        username: existingUser.name,
        otp,
      };
    }

    const created = await users.create(
      { ...body, isVerified: false },
      tx,
    );

    const { otp, otpHash, user } = await issueVerificationOtp(
      created._id,
      tx,
    );

    return {
      user,
      verificationRequired: true,
      otpHash,
      email: created.email,
      username: created.name,
      otp,
    };
  });

  // PostgreSQL transaction has successfully committed.
  // Now store the OTP in Redis with its 10-minute TTL.
  await storeVerificationOtp(
    transactionResult.user._id,
    transactionResult.otpHash,
  );

  // Send the plaintext OTP only after both DB and Redis operations succeed.
  await sendVerificationOtpEmail({
    email: transactionResult.email,
    username: transactionResult.username,
    otp: transactionResult.otp,
  });

  return {
    user: transactionResult.user,
    verificationRequired: true,
  };
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
      user: stripSecrets(user),
      verified: true,
    };
  }

  // OTP is now stored in Redis with a 10-minute TTL.
  const otpHash = await getVerificationOtp(user._id);

  if (!otpHash) {
    throw new BadRequestException(
      "Verification code not found or has expired. Please request a new code.",
      ErrorCodeEnum.AUTH_OTP_INVALID,
    );
  }

  const isOtpValid = await compareOtp(otp, otpHash);

  if (!isOtpValid) {
    throw new UnauthorizedException(
      "Invalid verification code",
      ErrorCodeEnum.AUTH_OTP_INVALID,
    );
  }

  /**
   * Verification and the default report setting commit together.
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

    if (!updated) throw new NotFoundException("Account not found");

    await createDefaultReportSetting(user._id, tx);
    return updated;
  });

  // OTP is one-time-use: delete it immediately after successful verification.
  await deleteVerificationOtp(user._id);

  // Auto-login
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

  // Enforce cooldown between resend requests.
  if (user.lastOtpResentAt) {
    const elapsed = Date.now() - user.lastOtpResentAt.getTime();

    if (elapsed < OTP_RESEND_COOLDOWN_MS) {
      const retryAfterSeconds = Math.ceil(
        (OTP_RESEND_COOLDOWN_MS - elapsed) / 1000,
      );

      throw new BadRequestException(
        `Please wait ${retryAfterSeconds} second(s) before requesting a new code.`,
        ErrorCodeEnum.AUTH_TOO_MANY_ATTEMPTS,
      );
    }
  }

  const otp = generateOtp();
  const otpHash = await hashOtp(otp);

  // Store OTP hash in Redis with automatic 10-minute expiration.
  await storeVerificationOtp(user._id, otpHash);

  // Keep only resend cooldown information in the database.
  await users.update(user._id, {
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

export const forgotPasswordService = async (
  body: ForgotPasswordSchemaType,
) => {
  const { email } = body;

  const user = await users.findByEmailWithSecrets(email);

  if (!user) {
    return {
      message: "If the email exists, a reset code has been sent",
    };
  }

  const otp = generateOtp();
  const otpHash = await hashOtp(otp);

  // Store password reset OTP in Redis with a 10-minute TTL.
  await storePasswordResetOtp(user._id, otpHash);

  await sendPasswordResetEmail({
    email: user.email,
    username: user.name,
    otp,
  });

  return {
    message: "If the email exists, a reset code has been sent",
  };
};

export const resetPasswordService = async (
  body: ResetPasswordSchemaType,
) => {
  const { email, otp, password } = body;

  const user = await users.findByEmailWithSecrets(email);
  if (!user) throw new NotFoundException("Account not found");

  // OTP is stored in Redis and expires automatically after 10 minutes.
  const otpHash = await getPasswordResetOtp(user._id);

  if (!otpHash) {
    throw new BadRequestException(
      "Reset code not found or has expired. Please request a new code.",
      ErrorCodeEnum.AUTH_OTP_INVALID,
    );
  }

  const isOtpValid = await compareOtp(otp, otpHash);

  if (!isOtpValid) {
    throw new UnauthorizedException(
      "Invalid reset code",
      ErrorCodeEnum.AUTH_OTP_INVALID,
    );
  }

  /**
   * Password update and token-version bump commit together.
   */
  await withTransaction(async (tx) => {
    await users.setPassword(user._id, password, tx);

    await users.bumpTokenVersion(user._id, tx);
  });

  // OTP is one-time-use.
  await deletePasswordResetOtp(user._id);

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

export const logoutService = async (userId: string) => {
  await markUserLoggedOut(userId);
  await users.bumpTokenVersion(userId);
};
