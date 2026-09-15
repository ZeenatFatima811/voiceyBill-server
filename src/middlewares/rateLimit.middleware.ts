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
import type { NextFunction, Request, Response } from "express";

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

const getClientIp = (req: Request): string => {
  const forwardedFor = req.headers["x-forwarded-for"];
  const forwardedIp = Array.isArray(forwardedFor)
    ? forwardedFor[0]
    : forwardedFor?.split(",")[0]?.trim();

  return req.ip || forwardedIp || "unknown";
};

export const otpLimiter = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const identifier = getClientIp(req);

  const result = await otpRateLimiter.limit(identifier);

  res.setHeader("RateLimit-Limit", String(result.limit));
  res.setHeader("RateLimit-Remaining", String(Math.max(0, result.remaining)));
  res.setHeader(
    "RateLimit-Reset",
    String(Math.max(0, Math.ceil((result.reset - Date.now()) / 1000))),
  );

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

export const authLimiter = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const identifier = getClientIp(req);

  const result = await authRateLimiter.limit(identifier);

  res.setHeader("RateLimit-Limit", String(result.limit));
  res.setHeader("RateLimit-Remaining", String(Math.max(0, result.remaining)));
  res.setHeader(
    "RateLimit-Reset",
    String(Math.max(0, Math.ceil((result.reset - Date.now()) / 1000))),
  );

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
