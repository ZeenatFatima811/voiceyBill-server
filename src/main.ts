import "reflect-metadata";
import "dotenv/config";

import { NestFactory } from "@nestjs/core";
import {
  ExpressAdapter,
  type NestExpressApplication,
} from "@nestjs/platform-express";
import cors from "cors";
import express, { type Express } from "express";
import passport from "passport";

import { AppModule } from "./app.module";
import { Env } from "./config/env.config";
import { errorHandler } from "./middlewares/errorHandler.middleware";
import { performanceLogger } from "./middlewares/performanceLogger.middleware";

// The set of browser origins allowed to call this API. Kept as a Set so the
// per-request lookup below is O(1).
const allowedOrigins = new Set(
  [
    "http://localhost:5173",
    "https://voiceybill.vercel.app",
    "https://voiceybill.com",
    "https://www.voiceybill.com",
    Env.FRONTEND_ORIGIN,
  ].filter(Boolean),
);

const corsOptions = {
  origin: (
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void,
  ) => {
    if (!origin) {
      return callback(null, true);
    }

    if (allowedOrigins.has(origin)) {
      return callback(null, true);
    }

    callback(new Error(`Not allowed by CORS: ${origin}`));
  },
  credentials: true,
};

const applyCorsHeaders = (
  origin: string | undefined,
  setHeader: (name: string, value: string) => void,
) => {
  if (!origin || !allowedOrigins.has(origin)) {
    return;
  }

  setHeader("Access-Control-Allow-Origin", origin);
  setHeader("Access-Control-Allow-Credentials", "true");
  setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS, PATCH",
  );
  setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, Accept, Origin, X-Requested-With",
  );
  setHeader("Vary", "Origin");
};

/**
 * Registers the platform-level (pre-router) middleware stack.
 *
 * ORDER IS LOAD-BEARING and mirrors the previous Express `src/index.ts`
 * one-for-one. Everything registered here runs before Nest's router, which is
 * mounted during `app.init()`; the route-scoped middleware declared in
 * `AppModule.configure()` runs after it.
 */
const applyGlobalMiddleware = (server: Express) => {
  // Behind Vercel's proxy, req.ip is the load balancer unless trust proxy is
  // set — which made the per-IP rate limiters share one bucket across unrelated
  // users (legitimate 429 lockouts) while under-counting real clients.
  server.set("trust proxy", 1);

  // PERF: response-time instrumentation must wrap every request — register first,
  // before body parsing and routes, so it captures the full request lifetime.
  server.use(performanceLogger);

  // 2mb (default 100kb) so bulk transaction imports of a few hundred rows don't
  // fail with an opaque 413. Nest's own body parser is disabled (see
  // `bodyParser: false` below) so these keep their place in the ordering.
  server.use(express.json({ limit: "2mb" }));
  server.use(express.urlencoded({ extended: true, limit: "2mb" }));

  server.use(passport.initialize());

  server.use((req, res, next) => {
    applyCorsHeaders(req.headers.origin, (name, value) =>
      res.header(name, value),
    );

    next();
  });

  server.use(cors(corsOptions));
  server.options("*", (req, res) => {
    applyCorsHeaders(req.headers.origin, (name, value) =>
      res.header(name, value),
    );

    res.sendStatus(204);
  });
};

/**
 * Builds and initialises the Nest application on top of an Express instance.
 *
 * Returns both handles: the Nest app (for lifecycle control) and the raw
 * Express instance (which is what the serverless entry point invokes).
 */
export const createNestApp = async (server: Express = express()) => {
  applyGlobalMiddleware(server);

  const app = await NestFactory.create<NestExpressApplication>(
    AppModule,
    new ExpressAdapter(server),
    {
      // Body parsing is registered manually above so it keeps its original
      // position relative to the performance logger.
      bodyParser: false,
      // Keep stdout to the same signal the Express app produced; Nest's
      // informational bootstrap/route-mapping lines are suppressed.
      logger: ["error", "warn"],
    },
  );

  // Mounts Nest's router and the route-scoped middleware from AppModule.
  await app.init();

  // Terminal Express error handler. Nest's global exception filter already
  // formats everything thrown inside a controller; this catches failures raised
  // by pre-router and route-scoped middleware (multer, CORS rejection, the
  // per-request database connect) which never enter Nest's execution context.
  server.use(errorHandler);

  return { app, server };
};
