import { redis } from "../config/redis.config";

export const invalidateAnalyticsCache = async (userId: string) => {
  const patterns = [
    `analytics:summary:${userId}:*`,
    `analytics:chart:${userId}:*`,
    `analytics:expense-breakdown:${userId}:*`,
  ];

  try {
    const keys = (
      await Promise.all(
        patterns.map((pattern) => redis.keys(pattern))
      )
    ).flat();

    if (keys.length === 0) {
      console.log(`No analytics cache keys found for user: ${userId}`);
      return;
    }

    await redis.del(...keys);

    console.log(
      `Invalidated ${keys.length} analytics cache keys for user: ${userId}`
    );
  } catch (error: any) {
    console.warn(
      "Analytics cache invalidation failed:",
      error?.message || error
    );
  }
};
