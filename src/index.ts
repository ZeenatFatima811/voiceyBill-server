// Must stay first: `Env` is evaluated at import time and throws on a missing
// DATABASE_URL, so the .env file has to be loaded before any other module here.
import "dotenv/config";

import express, { type Express, type Request, type Response } from "express";

import { Env } from "./config/env.config";
import { createNestApp } from "./main";

const BASE_PATH = Env.BASE_PATH;

// The Express instance is created up front so the serverless handler below has
// something to delegate to synchronously, while Nest initialises asynchronously.
const server: Express = express();

let bootstrapPromise: Promise<Express> | null = null;

/**
 * Initialises Nest once per process and reuses it for every later invocation.
 *
 * On Vercel this runs during the cold start of a function instance; warm
 * invocations resolve the already-settled promise and skip straight to the
 * request.
 */
const ready = (): Promise<Express> => {
  if (!bootstrapPromise) {
    bootstrapPromise = createNestApp(server)
      .then(async ({ app }) => {
        if (Env.NODE_ENV === "development") {
          const port = parseInt(Env.PORT);
          await app.listen(port);
          console.log(`🚀 Server is running on http://localhost:${port}`);
          console.log(`📋 API Base Path: ${BASE_PATH}`);
          console.log(`🌍 Environment: ${Env.NODE_ENV}`);
        }

        return server;
      })
      .catch((error) => {
        // Reset so a failed cold start can be retried by the next invocation
        // instead of caching the rejection forever.
        bootstrapPromise = null;
        throw error;
      });
  }

  return bootstrapPromise;
};

// In development this file is the process entry point, so start listening
// immediately rather than waiting for a first request.
if (Env.NODE_ENV === "development") {
  void ready().catch((error) => {
    console.error("Failed to start the server:", error);
  });
}

/**
 * Vercel serverless entry point. Kept as the default export from `src/index.ts`
 * so `vercel.json` needs no change.
 */
export default async function handler(
  req: Request,
  res: Response,
): Promise<void> {
  const app = await ready();
  app(req, res);
}
