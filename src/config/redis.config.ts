import { Redis } from "@upstash/redis";

import { Env } from "./env.config";

export const redis = new Redis({
  url: Env.UPSTASH_REDIS_REST_URL,
  token: Env.UPSTASH_REDIS_REST_TOKEN,
});
