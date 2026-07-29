/**
 * The Vercel entry point in `src/index.ts`.
 *
 * `vercel.json` is unchanged by the migration, so `src/index.ts` must still
 * default-export a `(req, res)` handler, must NOT listen outside development,
 * and must initialise Nest exactly once per process even when several requests
 * arrive together during a cold start.
 */
import assert from "node:assert/strict";
import http from "http";
import { describe, test } from "node:test";

import type { Express } from "express";

import { fakes, validToken } from "./support/app";

// Patch the bootstrap before `src/index.ts` is loaded so we can count how many
// times it actually builds a Nest application. `src/index.ts` calls this through
// the module object, so replacing the export is observed.
const mainModule = require("../src/main") as {
  createNestApp: (server?: Express) => Promise<unknown>;
};
const realCreateNestApp = mainModule.createNestApp;
let bootstrapCount = 0;
mainModule.createNestApp = (server?: Express) => {
  bootstrapCount += 1;
  return realCreateNestApp(server);
};

const indexModule = require("../src/index") as {
  default: (req: unknown, res: unknown) => Promise<void>;
};
const handler = indexModule.default;

/** Fronts the serverless handler with a real socket so responses are observable. */
const serverlessServer = http.createServer((req, res) => {
  void handler(req, res);
});

const call = (
  method: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; text: string }> =>
  new Promise((resolve, reject) => {
    const { port } = serverlessServer.address() as { port: number };
    const req = http.request(
      { host: "127.0.0.1", port, method, path, headers, agent: false },
      (res) => {
        let text = "";
        res.on("data", (c) => (text += c));
        res.on("end", () => resolve({ status: res.statusCode!, text }));
      },
    );
    req.on("error", reject);
    req.end();
  });

describe("serverless entry point", () => {
  test("exports a request handler as the default export", () => {
    assert.equal(typeof handler, "function");
    assert.equal(handler.length, 2, "the handler must accept (req, res)");
  });

  test("does not bootstrap Nest at import time outside development", () => {
    assert.equal(
      bootstrapCount,
      0,
      "importing src/index.ts must not initialise Nest unless NODE_ENV=development",
    );
  });

  test("does not bind a port at import time outside development", () => {
    // If the module had called app.listen, PORT=0 would have bound something and
    // the dev banner would have run. The only listener in this test is the one
    // created below, so a clean handler-only import is what we assert.
    assert.equal(bootstrapCount, 0);
  });

  test("five concurrent cold-start requests share a single bootstrap", async () => {
    await new Promise<void>((resolve) => {
      serverlessServer.listen(0, () => resolve());
    });

    const responses = await Promise.all([
      call("GET", "/health"),
      call("GET", "/health"),
      call("GET", "/health"),
      call("GET", "/health"),
      call("GET", "/health"),
    ]);

    for (const res of responses) {
      assert.equal(res.status, 200, `cold-start request failed: ${res.text}`);
    }
    assert.equal(
      bootstrapCount,
      1,
      `Nest initialised ${bootstrapCount} times; the bootstrap promise must be shared`,
    );
  });

  test("warm invocations reuse the same instance", async () => {
    await call("GET", "/health");
    await call("GET", "/test");
    assert.equal(bootstrapCount, 1);
  });

  test("the full middleware stack is present on the serverless path", async () => {
    const res = await call("GET", "/nope");
    assert.equal(res.status, 404);
    assert.deepEqual(JSON.parse(res.text), {
      success: false,
      message: "Route /nope not found",
      status: 404,
    });
  });

  test("authentication applies on the serverless path too", async () => {
    const unauth = await call("GET", "/api/user/current-user");
    assert.equal(unauth.status, 401);
    assert.equal(unauth.text, "Unauthorized");

    const authed = await call("GET", "/api/user/current-user", {
      authorization: `Bearer ${validToken()}`,
    });
    assert.equal(authed.status, 200);
  });

  test("cleanup: the serverless listener closes", async () => {
    await new Promise<void>((resolve) => serverlessServer.close(() => resolve()));
    assert.equal(serverlessServer.listening, false);
  });
});

describe("cron scheduling", () => {
  test("crons are NOT scheduled outside development", () => {
    assert.equal(
      fakes.callsTo("initializeCrons").length,
      0,
      "CronModule must stay inert unless NODE_ENV=development",
    );
  });
});
