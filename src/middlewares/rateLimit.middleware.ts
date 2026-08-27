// import rateLimit from "express-rate-limit";

// export const otpLimiter = rateLimit({
//   windowMs: 10 * 60 * 1000, // 10 minutes
//   max: 6, // limit to 6 requests per window per IP
//   standardHeaders: true,
//   legacyHeaders: false,
//   message: { message: "Too many requests, please try again later." },
// });

// export const authLimiter = rateLimit({
//   windowMs: 60 * 60 * 1000, // 1 hour
//   max: 20,
//   standardHeaders: true,
//   legacyHeaders: false,
//   message: { message: "Too many authentication attempts, please try again later." },
// });

// export default { otpLimiter, authLimiter };


import { Ratelimit } from "@upstash/ratelimit";

import { redis } from "../config/redis.config";

const createRateLimiter = (
  requests: number,
  window: Parameters<typeof Ratelimit.slidingWindow>[1],
  prefix: string,
) => {
  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(requests, window),
    prefix,
  });
};

const otpRateLimiter = createRateLimiter(
  6,
  "10 m",
  "ratelimit:otp",
);

const authRateLimiter = createRateLimiter(
  20,
  "1 h",
  "ratelimit:auth",
);

const getClientIp = (req: any): string => {
  return (
    req.ip ||
    req.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() ||
    "unknown"
  );
};

export const otpLimiter = async (req: any, res: any, next: any) => {
  const identifier = getClientIp(req);

  const result = await otpRateLimiter.limit(identifier);

  if (!result.success) {
    res.setHeader(
      "Retry-After",
      String(Math.ceil((result.reset - Date.now()) / 1000)),
    );
    return res.status(429).json({
      message: "Too many requests, please try again later.",
    });
  }

  next();
};

export const authLimiter = async (req: any, res: any, next: any) => {
  const identifier = getClientIp(req);

  const result = await authRateLimiter.limit(identifier);

  if (!result.success) {
    res.setHeader(
      "Retry-After",
      String(Math.ceil((result.reset - Date.now()) / 1000)),
    );
    return res.status(429).json({
      message:
        "Too many authentication attempts, please try again later.",
    });
  }

  next();
};

export default { otpLimiter, authLimiter };
