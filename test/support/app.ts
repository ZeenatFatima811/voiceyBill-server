/**
 * Boots the real application for the e2e suite.
 *
 * `createNestApp` from `src/main.ts` is used unchanged, so what is under test is
 * the production bootstrap: the pre-router middleware order, `AppModule`'s
 * route-scoped middleware, Nest's router and not-found handler, the real
 * `JwtStrategy`, the real Zod validators, the real Multer instances and the real
 * `errorHandler` behind `AllExceptionsFilter`.
 */
import type { Server } from "http";
import http from "http";

import type { Express } from "express";
import jwt from "jsonwebtoken";

import * as fakes from "./fakes";
import { recorder, stubModule, stubPackage } from "./stub";

// ---------------------------------------------------------------------------
// 1. Environment. `Env` is evaluated at import time and `getEnv` throws on a
//    missing variable without a default, and `BASE_PATH` is read while the
//    @Controller decorators are being applied — so this must run first.
// ---------------------------------------------------------------------------
export const JWT_SECRET = "test-jwt-secret";

const TEST_ENV: Record<string, string> = {
  NODE_ENV: "test",
  PORT: "0",
  BASE_PATH: "/api",
  MONGO_URI: "mongodb://127.0.0.1:27017/unused-in-tests",
  JWT_SECRET,
  OPENAI_API_KEY: "test-openai-key",
  UPLIFT_AI_API_KEY: "test-uplift-key",
  GEMINI_API_KEY: "test-gemini-key",
  CLOUDINARY_CLOUD_NAME: "test-cloud",
  CLOUDINARY_API_KEY: "test-cloud-key",
  CLOUDINARY_API_SECRET: "test-cloud-secret",
  RESEND_API_KEY: "test-resend-key",
  FRONTEND_ORIGIN: "http://localhost:5173",
  GOOGLE_CLIENT_ID: "test-google-client-id",
};

for (const [key, value] of Object.entries(TEST_ENV)) {
  process.env[key] = value;
}

// Many tests deliberately drive failure paths, and `errorHandler` logs every
// error while `performanceLogger` logs every request. Left unmuted that buries
// real failures in CI output. Set TEST_VERBOSE=1 to see it all.
if (!process.env.TEST_VERBOSE) {
  const drop = () => {};
  console.log = drop;
  console.warn = drop;
  console.error = drop;
  console.info = drop;
}

// `src/index.ts` and `src/main.ts` both import "dotenv/config"; neutralise it so
// a developer's real .env can never leak into a test run.
stubPackage("dotenv/config", {});

// ---------------------------------------------------------------------------
// 2. I/O leaves. Everything else is the real implementation.
// ---------------------------------------------------------------------------
// Counts how many times the per-request connect middleware ran. Passport's own
// invocation count is observed through `fakes.callsTo("findByIdUserService")`,
// which the real JwtStrategy drives.
export const dbConnect = recorder("ensureDatabaseConnection");

stubModule("config/database.config", {
  connctDatabase: async () => {},
  ensureDatabaseConnection: (
    _req: unknown,
    _res: unknown,
    next: () => void,
  ) => {
    dbConnect.calls += 1;
    next();
  },
});

// Replace only the Cloudinary storage engine, so `src/config/cloudinary.config.ts`
// itself stays real — its `fileFilter` (the #164 hang fix) and its 2MB/1-file
// limits are genuinely exercised, with uploaded bytes landing in memory instead
// of going to Cloudinary.
const multerForStorage = require("multer");
stubPackage("multer-storage-cloudinary", {
  CloudinaryStorage: class {
    private readonly delegate = multerForStorage.memoryStorage();
    _handleFile(req: unknown, file: unknown, cb: unknown) {
      return this.delegate._handleFile(req, file, cb);
    }
    _removeFile(req: unknown, file: unknown, cb: unknown) {
      return this.delegate._removeFile(req, file, cb);
    }
  },
});

stubModule("services/user.service", fakes.userServiceStub);
stubModule("services/auth.service", fakes.authServiceStub);
stubModule("services/google-auth.service", fakes.googleAuthServiceStub);
stubModule("services/transaction.service", fakes.transactionServiceStub);
stubModule("services/category.service", fakes.categoryServiceStub);
stubModule("services/budget.service", fakes.budgetServiceStub);
stubModule("services/report.service", fakes.reportServiceStub);
stubModule("services/analytics.service", fakes.analyticsServiceStub);
stubModule("services/exchange-rate.service", fakes.exchangeRateStub);
stubModule("services/uplift.service", fakes.upliftStub);
stubModule("services/gemini.service", fakes.geminiStub);
stubModule("cron/index", fakes.cronStub);

// ---------------------------------------------------------------------------
// 3. Boot. Required (not imported) so the stubs above are already in place.
// ---------------------------------------------------------------------------
const { createNestApp } = require("../../src/main") as typeof import("../../src/main");

export interface TestApp {
  server: Express;
  httpServer: Server;
  port: number;
  close: () => Promise<void>;
}

let started: Promise<TestApp> | null = null;

export const startApp = (): Promise<TestApp> => {
  if (!started) {
    started = (async () => {
      const { app, server } = await createNestApp();
      const httpServer = server.listen(0);
      await new Promise<void>((resolve) =>
        httpServer.once("listening", () => resolve()),
      );
      const port = (httpServer.address() as { port: number }).port;
      return {
        server,
        httpServer,
        port,
        close: async () => {
          await new Promise<void>((resolve) => httpServer.close(() => resolve()));
          await app.close();
        },
      };
    })();
  }
  return started;
};

// ---------------------------------------------------------------------------
// 4. Request helper.
// ---------------------------------------------------------------------------
export interface Res {
  status: number;
  headers: http.IncomingHttpHeaders;
  text: string;
  json: any;
}

export interface ReqOpts {
  body?: string | Buffer;
  contentType?: string;
  token?: string;
  origin?: string;
  headers?: Record<string, string>;
  /**
   * Client IP presented via X-Forwarded-For. The app sets `trust proxy: 1`, so
   * this becomes `req.ip` and therefore the per-IP rate-limit bucket key.
   * Defaults to a unique address per request so tests cannot exhaust each
   * other's budget — `otpLimiter` allows only 6 requests per IP per 10 minutes
   * across all four OTP routes combined. Pass a fixed value to share a bucket
   * on purpose.
   */
  clientIp?: string;
}

let ipCounter = 0;

/** A fresh, deterministic client address in the documentation-only range. */
export const uniqueIp = (): string => {
  ipCounter += 1;
  return `203.0.113.${ipCounter % 254}`;
};

export const request = async (
  method: string,
  path: string,
  opts: ReqOpts = {},
): Promise<Res> => {
  const { port } = await startApp();
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.contentType) headers["content-type"] = opts.contentType;
  if (opts.body !== undefined) {
    headers["content-length"] = String(Buffer.byteLength(opts.body));
  }
  if (opts.token) headers["authorization"] = `Bearer ${opts.token}`;
  if (opts.origin) headers["origin"] = opts.origin;
  if (!("x-forwarded-for" in headers)) {
    headers["x-forwarded-for"] = opts.clientIp ?? uniqueIp();
  }

  return new Promise<Res>((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method,
        path,
        headers,
        // No connection pooling. A pooled socket can outlive the server's
        // 5s keepAliveTimeout during a long-running test and surface as a
        // spurious ECONNRESET on the next request.
        agent: false,
      },
      (res) => {
        let text = "";
        res.on("data", (chunk) => (text += chunk));
        res.on("end", () => {
          let parsed: any = undefined;
          try {
            parsed = text ? JSON.parse(text) : undefined;
          } catch {
            parsed = undefined;
          }
          resolve({ status: res.statusCode!, headers: res.headers, text, json: parsed });
        });
      },
    );
    req.on("error", reject);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
};

/** JSON request shorthand. */
export const json = (
  method: string,
  path: string,
  body: unknown,
  opts: ReqOpts = {},
): Promise<Res> =>
  request(method, path, {
    ...opts,
    body: JSON.stringify(body),
    contentType: "application/json",
  });

/** Builds a multipart body with a single file part. */
export const multipart = (
  field: string,
  filename: string,
  mimeType: string,
  content: Buffer | string,
): { body: Buffer; contentType: string } => {
  const boundary = "----voiceybilltestboundary";
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${field}"; filename="${filename}"\r\n` +
      `Content-Type: ${mimeType}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    body: Buffer.concat([head, Buffer.from(content), tail]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
};

/** A token the real JwtStrategy accepts, for the user the fake lookup knows. */
export const validToken = (userId: string = fakes.TEST_USER._id): string =>
  jwt.sign({ userId }, JWT_SECRET, { audience: "user", algorithm: "HS256" });

/** A structurally valid token whose subject the fake lookup does not know. */
export const unknownUserToken = (): string => validToken("000000000000000000000000");

/** A token signed with the wrong secret. */
export const badSignatureToken = (): string =>
  jwt.sign({ userId: fakes.TEST_USER._id }, "wrong-secret", {
    audience: "user",
    algorithm: "HS256",
  });

/** A token that verifies but carries no `userId` claim. */
export const noUserIdToken = (): string =>
  jwt.sign({ foo: "bar" }, JWT_SECRET, { audience: "user", algorithm: "HS256" });

export { fakes };
