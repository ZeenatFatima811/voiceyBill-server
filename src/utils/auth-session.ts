import { redis } from "../config/redis.config";

const LOGOUT_KEY_PREFIX = "auth:logout:";

const getLogoutKey = (userId: string) =>
  `${LOGOUT_KEY_PREFIX}${userId}`;

/**
 * Marks all currently issued tokens for this user as logged out.
 *
 * The timestamp is stored in Unix seconds because JWT `iat`
 * is also represented in seconds.
 *
 * TTL is 7 days + 1 hour, which is slightly longer than the
 * current refresh-token lifetime.
 */
export const markUserLoggedOut = async (userId: string): Promise<void> => {
  const logoutAt = Math.floor(Date.now() / 1000);

  await redis.set(getLogoutKey(userId), logoutAt, {
    ex: 7 * 24 * 60 * 60 + 60 * 60,
  });
};

/**
 * Returns the timestamp at which the user last logged out.
 *
 * Returns null when no logout marker exists.
 */
export const getUserLogoutAt = async (
  userId: string,
): Promise<number | null> => {
  const logoutAt = await redis.get<number>(getLogoutKey(userId));

  return logoutAt ?? null;
};

/**
 * Checks whether a token was issued before the user's latest logout.
 */
export const isTokenInvalidatedByLogout = async (
  userId: string,
  issuedAt?: number,
): Promise<boolean> => {
  if (!issuedAt) {
    return false;
  }

  const logoutAt = await getUserLogoutAt(userId);

  if (logoutAt === null) {
    return false;
  }

  return issuedAt <= logoutAt;
};
