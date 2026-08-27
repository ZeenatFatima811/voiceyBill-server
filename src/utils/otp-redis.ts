import { redis } from "../config/redis.config";

const OTP_TTL_SECONDS = 10 * 60;

const getVerificationOtpKey = (userId: string) =>
  `otp:email-verification:${userId}`;

const getPasswordResetOtpKey = (userId: string) =>
  `otp:password-reset:${userId}`;

const getDeleteAccountOtpKey = (userId: string) =>
  `otp:delete-account:${userId}`;

export const storeVerificationOtp = async (
  userId: string,
  otpHash: string,
): Promise<void> => {
  await redis.set(getVerificationOtpKey(userId), otpHash, {
    ex: OTP_TTL_SECONDS,
  });
};

export const getVerificationOtp = async (
  userId: string,
): Promise<string | null> => {
  return redis.get<string>(getVerificationOtpKey(userId));
};

export const deleteVerificationOtp = async (
  userId: string,
): Promise<void> => {
  await redis.del(getVerificationOtpKey(userId));
};

export const storePasswordResetOtp = async (
  userId: string,
  otpHash: string,
): Promise<void> => {
  await redis.set(getPasswordResetOtpKey(userId), otpHash, {
    ex: OTP_TTL_SECONDS,
  });
};

export const getPasswordResetOtp = async (
  userId: string,
): Promise<string | null> => {
  return redis.get<string>(getPasswordResetOtpKey(userId));
};

export const deletePasswordResetOtp = async (
  userId: string,
): Promise<void> => {
  await redis.del(getPasswordResetOtpKey(userId));
};

export const storeDeleteAccountOtp = async (
  userId: string,
  otpHash: string,
): Promise<void> => {
  await redis.set(getDeleteAccountOtpKey(userId), otpHash, {
    ex: OTP_TTL_SECONDS,
  });
};

export const getDeleteAccountOtp = async (
  userId: string,
): Promise<string | null> => {
  return redis.get<string>(getDeleteAccountOtpKey(userId));
};

export const deleteDeleteAccountOtp = async (
  userId: string,
): Promise<void> => {
  await redis.del(getDeleteAccountOtpKey(userId));
};
