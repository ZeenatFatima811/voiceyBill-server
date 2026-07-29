/**
 * Route table parity with the pre-migration Express routers.
 *
 * ROUTES below is transcribed from the deleted `src/routes/*.route.ts` files plus
 * the three root handlers that lived in the old `src/index.ts`. Every entry must
 * resolve to a real handler, and the set must be exhaustive in both directions:
 * a route that disappears fails, and a route that appears without being recorded
 * here fails too.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { fakes, json, multipart, request, startApp, validToken } from "./support/app";

interface RouteSpec {
  method: string;
  path: string;
  /** A request that reaches the handler, for the exhaustiveness check. */
  probe?: () => Promise<unknown>;
}

/** 3 unauthenticated root routes + 43 routes under BASE_PATH = 46 total. */
export const ROUTES: RouteSpec[] = [
  { method: "GET", path: "/" },
  { method: "GET", path: "/health" },
  { method: "GET", path: "/test" },

  { method: "POST", path: "/api/auth/register" },
  { method: "POST", path: "/api/auth/login" },
  { method: "POST", path: "/api/auth/google" },
  { method: "POST", path: "/api/auth/refresh-token" },
  { method: "POST", path: "/api/auth/logout" },
  { method: "POST", path: "/api/auth/verify-otp" },
  { method: "POST", path: "/api/auth/resend-otp" },
  { method: "POST", path: "/api/auth/forgot-password" },
  { method: "POST", path: "/api/auth/reset-password" },

  { method: "GET", path: "/api/user/current-user" },
  { method: "PUT", path: "/api/user/update" },
  { method: "PUT", path: "/api/user/change-password" },
  { method: "POST", path: "/api/user/account/otp" },
  { method: "DELETE", path: "/api/user/account" },

  { method: "POST", path: "/api/transaction/create" },
  { method: "POST", path: "/api/transaction/scan-receipt" },
  { method: "POST", path: "/api/transaction/bulk-transaction" },
  { method: "PUT", path: "/api/transaction/duplicate/:id" },
  { method: "PUT", path: "/api/transaction/update/:id" },
  { method: "GET", path: "/api/transaction/all" },
  { method: "GET", path: "/api/transaction/:id" },
  { method: "DELETE", path: "/api/transaction/delete/:id" },
  { method: "DELETE", path: "/api/transaction/bulk-delete" },

  { method: "GET", path: "/api/report/all" },
  { method: "GET", path: "/api/report/generate" },
  { method: "PUT", path: "/api/report/update-setting" },
  { method: "POST", path: "/api/report/resend/:id" },

  { method: "GET", path: "/api/analytics/summary" },
  { method: "GET", path: "/api/analytics/chart" },
  { method: "GET", path: "/api/analytics/expense-breakdown" },
  { method: "GET", path: "/api/analytics/dashboard" },

  { method: "POST", path: "/api/voice/process" },

  { method: "GET", path: "/api/category" },
  { method: "POST", path: "/api/category" },
  { method: "PUT", path: "/api/category/:id" },
  { method: "DELETE", path: "/api/category/:id" },

  { method: "PUT", path: "/api/budget" },
  { method: "GET", path: "/api/budget/summary" },
  { method: "DELETE", path: "/api/budget" },
  { method: "GET", path: "/api/budget/list" },
  { method: "GET", path: "/api/budget/current" },

  { method: "GET", path: "/api/currency/supported" },
  { method: "GET", path: "/api/currency/rate" },
];

const OBJECT_ID = "652f9f9f9f9f9f9f9f9f9f9f";

/** Fills `:id` so the path can actually be requested. */
const concrete = (path: string) => path.replace(":id", OBJECT_ID);

/**
 * Reads the route table straight off the controller decorators, which is the
 * authoritative record of what the app exposes. Walking Express's layer stack
 * would also surface the middleware mounts, which are not routes.
 */
const declaredRoutes = (): string[] => {
  const { PATH_METADATA, METHOD_METADATA } = require("@nestjs/common/constants");
  const { RequestMethod } = require("@nestjs/common");

  const controllers: Array<new (...a: never[]) => object> = [
    require("../src/app.controller").AppController,
    require("../src/modules/auth/auth.controller").AuthController,
    require("../src/modules/user/user.controller").UserController,
    require("../src/modules/transaction/transaction.controller").TransactionController,
    require("../src/modules/report/report.controller").ReportController,
    require("../src/modules/analytics/analytics.controller").AnalyticsController,
    require("../src/modules/voice/voice.controller").VoiceController,
    require("../src/modules/category/category.controller").CategoryController,
    require("../src/modules/budget/budget.controller").BudgetController,
    require("../src/modules/currency/currency.controller").CurrencyController,
  ];

  const join = (prefix: string, sub: string) => {
    const left = prefix === "/" ? "" : prefix.replace(/\/$/, "");
    const right = sub === "/" || sub === "" ? "" : `/${sub.replace(/^\//, "")}`;
    return `${left}${right}` || "/";
  };

  const out: string[] = [];
  for (const controller of controllers) {
    const prefix: string = Reflect.getMetadata(PATH_METADATA, controller) ?? "/";
    const proto = controller.prototype as Record<string, unknown>;
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === "constructor") continue;
      const handler = proto[name];
      if (typeof handler !== "function") continue;
      const sub = Reflect.getMetadata(PATH_METADATA, handler);
      if (sub === undefined) continue;
      const methodIndex = Reflect.getMetadata(METHOD_METADATA, handler);
      out.push(`${RequestMethod[methodIndex]} ${join(prefix, sub)}`);
    }
  }
  return out.sort();
};

describe("route table", () => {
  test("exactly 46 routes are declared (3 root + 43 under BASE_PATH)", () => {
    assert.equal(ROUTES.length, 46);
    assert.equal(ROUTES.filter((r) => r.path.startsWith("/api/")).length, 43);
  });

  test("every declared route resolves to a handler, never to the catch-all 404", async () => {
    const token = validToken();
    const missing: string[] = [];

    for (const route of ROUTES) {
      const res = await request(route.method, concrete(route.path), { token });
      // A resolved route may legitimately answer 400 (validation) or 200/201/204.
      // What it must never do is produce the catch-all body, which is the only
      // signal that no handler matched.
      const isCatchAll =
        res.status === 404 && res.json?.message?.startsWith("Route ");
      if (isCatchAll) missing.push(`${route.method} ${route.path}`);
    }

    assert.deepEqual(missing, [], "routes lost in the migration");
  });

  test("the declared route table matches ROUTES exactly, in both directions", async () => {
    await startApp();
    const actual = declaredRoutes();
    const expected = ROUTES.map((r) => `${r.method} ${r.path}`).sort();

    assert.deepEqual(
      actual,
      expected,
      "the app's route table drifted from ROUTES — a route was added, removed or renamed",
    );
  });
});

describe("route resolution order", () => {
  test("GET /all resolves before GET /:id", async () => {
    fakes.resetCalls();
    const res = await request("GET", "/api/transaction/all", { token: validToken() });
    assert.equal(res.status, 200);
    assert.equal(fakes.callsTo("getAllTransactionService").length, 1);
    assert.equal(fakes.callsTo("getTransactionByIdService").length, 0);
  });

  test("GET /:id still reaches the by-id handler", async () => {
    fakes.resetCalls();
    const res = await request("GET", `/api/transaction/${OBJECT_ID}`, {
      token: validToken(),
    });
    assert.equal(res.status, 200);
    assert.equal(fakes.callsTo("getTransactionByIdService").length, 1);
    assert.equal(fakes.callsTo("getAllTransactionService").length, 0);
  });

  test("DELETE /bulk-delete is not swallowed by DELETE /delete/:id", async () => {
    fakes.resetCalls();
    const res = await json(
      "DELETE",
      "/api/transaction/bulk-delete",
      { transactionIds: [OBJECT_ID] },
      { token: validToken() },
    );
    assert.equal(res.status, 200);
    assert.equal(fakes.callsTo("bulkDeleteTransactionService").length, 1);
    assert.equal(fakes.callsTo("deleteTransactionService").length, 0);
  });

  test("POST /scan-receipt is not swallowed by POST /create", async () => {
    fakes.resetCalls();
    const { body, contentType } = multipart(
      "receipt",
      "r.png",
      "image/png",
      Buffer.from("fake-png-bytes"),
    );
    const res = await request("POST", "/api/transaction/scan-receipt", {
      body,
      contentType,
      token: validToken(),
    });
    assert.equal(res.status, 200);
    assert.equal(fakes.callsTo("scanReceiptService").length, 1);
    assert.equal(fakes.callsTo("createTransactionService").length, 0);
  });
});

describe("root liveness routes", () => {
  test("GET / returns the original body verbatim", async () => {
    const res = await request("GET", "/");
    assert.equal(res.status, 200);
    assert.equal(res.json.message, "VoiceyBill API is running successfully!");
    assert.equal(res.json.status, "active");
    assert.equal(res.json.version, "1.0.0");
    assert.ok(typeof res.json.timestamp === "string");
  });

  test("GET /health reports database state", async () => {
    const res = await request("GET", "/health");
    assert.equal(res.status, 200);
    assert.equal(res.json.status, "healthy");
    assert.ok(["connected", "disconnected"].includes(res.json.database));
    assert.equal(typeof res.json.uptime, "number");
  });

  test("GET /test reports the environment", async () => {
    const res = await request("GET", "/test");
    assert.equal(res.status, 200);
    assert.equal(res.json.message, "Serverless function is working!");
    assert.equal(res.json.environment, "test");
  });

  test("root routes are NOT behind the per-request database connect", async () => {
    const { dbConnect } = await import("./support/app");
    const before = dbConnect.calls;
    await request("GET", "/");
    await request("GET", "/health");
    await request("GET", "/test");
    assert.equal(dbConnect.calls, before, "a root route triggered a DB connect");
  });
});

describe("catch-all 404", () => {
  test("unknown top-level path returns the legacy body", async () => {
    const res = await request("GET", "/nope");
    assert.equal(res.status, 404);
    assert.deepEqual(res.json, {
      success: false,
      message: "Route /nope not found",
      status: 404,
    });
  });

  test("the 404 body echoes the full original URL including the query string", async () => {
    const res = await request("GET", "/nope?a=1&b=2");
    assert.equal(res.status, 404);
    assert.equal(res.json.message, "Route /nope?a=1&b=2 not found");
  });

  test("a sibling of a mounted prefix does not match that prefix", async () => {
    // /api/budgets must not be captured by the /api/budget mount.
    const res = await request("GET", "/api/budgets");
    assert.equal(res.status, 404);
    assert.equal(res.json.message, "Route /api/budgets not found");
  });

  test("wrong method on an existing path is a 404, not a 405", async () => {
    const res = await request("PATCH", "/", {});
    assert.equal(res.status, 404);
    assert.equal(res.json.message, "Route / not found");
  });
});
