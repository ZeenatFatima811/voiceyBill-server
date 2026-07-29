/**
 * Authentication behaviour.
 *
 * The migration deliberately kept Passport as route-scoped middleware rather
 * than converting it to a Nest guard, because Express ran it across the whole
 * `${BASE_PATH}/<feature>` prefix BEFORE route matching. A guard runs after
 * routing, which would turn "401 for an unknown sub-path under a protected
 * prefix" into a 404. These tests pin that ordering, plus the exact 401 wire
 * format Passport produces (plain text, no JSON, no content-type).
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  badSignatureToken,
  dbConnect,
  fakes,
  json,
  noUserIdToken,
  request,
  unknownUserToken,
  validToken,
} from "./support/app";

const PROTECTED_PREFIXES = [
  "/api/user",
  "/api/transaction",
  "/api/report",
  "/api/analytics",
  "/api/voice",
  "/api/category",
  "/api/budget",
  "/api/currency",
];

describe("unauthenticated requests to protected prefixes", () => {
  for (const prefix of PROTECTED_PREFIXES) {
    test(`${prefix} without a token returns Passport's plain-text 401`, async () => {
      const res = await request("GET", `${prefix}/anything`);
      assert.equal(res.status, 401);
      assert.equal(res.text, "Unauthorized");
      assert.equal(
        res.headers["content-type"],
        undefined,
        "the 401 must not be JSON — Passport writes a bare body",
      );
    });
  }

  test("an unknown sub-path under a protected prefix is 401, NOT 404", async () => {
    const res = await request("GET", "/api/user/some-unknown-subpath");
    assert.equal(
      res.status,
      401,
      "auth must run before routing; a guard would produce 404 here",
    );
    assert.equal(res.text, "Unauthorized");
  });

  test("an unknown sub-path WITH a valid token falls through to the catch-all 404", async () => {
    const res = await request("GET", "/api/user/some-unknown-subpath", {
      token: validToken(),
    });
    assert.equal(res.status, 404);
    assert.equal(res.json.message, "Route /api/user/some-unknown-subpath not found");
  });
});

describe("token validation branches", () => {
  test("a token signed with the wrong secret is rejected without a user lookup", async () => {
    fakes.resetCalls();
    const res = await request("GET", "/api/user/current-user", {
      token: badSignatureToken(),
    });
    assert.equal(res.status, 401);
    assert.equal(
      fakes.callsTo("findByIdUserService").length,
      0,
      "signature must be verified before the database is touched",
    );
  });

  test("a token with no userId claim is rejected without a user lookup", async () => {
    fakes.resetCalls();
    const res = await request("GET", "/api/user/current-user", {
      token: noUserIdToken(),
    });
    assert.equal(res.status, 401);
    assert.equal(res.text, "Unauthorized");
    assert.equal(fakes.callsTo("findByIdUserService").length, 0);
  });

  test("a well-formed token for an unknown user is rejected after the lookup", async () => {
    fakes.resetCalls();
    const res = await request("GET", "/api/user/current-user", {
      token: unknownUserToken(),
    });
    assert.equal(res.status, 401);
    assert.equal(res.text, "Unauthorized");
    assert.equal(fakes.callsTo("findByIdUserService").length, 1);
  });

  test("a token in the wrong scheme is rejected", async () => {
    const res = await request("GET", "/api/user/current-user", {
      headers: { authorization: `Basic ${validToken()}` },
    });
    assert.equal(res.status, 401);
  });

  test("a valid token authenticates and attaches the user to the request", async () => {
    fakes.resetCalls();
    const res = await request("GET", "/api/user/current-user", {
      token: validToken(),
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.message, "User fetched successfully");
    assert.equal(res.json.user.email, fakes.TEST_USER.email);
  });

  test("authentication runs exactly once per request", async () => {
    fakes.resetCalls();
    await request("GET", "/api/transaction/all", { token: validToken() });
    // The route prefix is mounted as both `/api/transaction` and
    // `/api/transaction/*`; Nest must collapse those into a single middleware
    // pass, otherwise every authenticated request costs two user lookups.
    assert.equal(fakes.callsTo("findByIdUserService").length, 1);
  });
});

describe("the /auth prefix is not behind authentication", () => {
  test("POST /api/auth/login needs no token", async () => {
    const res = await json("POST", "/api/auth/login", {
      email: "user@example.com",
      password: "Str0ng!Passw0rd",
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.message, "User logged in successfully");
  });

  test("POST /api/auth/logout needs no token and returns an empty 204", async () => {
    const res = await request("POST", "/api/auth/logout");
    assert.equal(res.status, 204);
    assert.equal(res.text, "");
  });

  test("an unknown sub-path under /api/auth is a 404, not a 401", async () => {
    const res = await request("GET", "/api/auth/not-a-route");
    assert.equal(res.status, 404);
    assert.equal(res.json.message, "Route /api/auth/not-a-route not found");
  });
});

describe("per-request database connect", () => {
  test("runs exactly once for an authenticated API request", async () => {
    const before = dbConnect.calls;
    await request("GET", "/api/category", { token: validToken() });
    assert.equal(dbConnect.calls - before, 1);
  });

  test("runs on the /auth prefix too, before authentication would apply", async () => {
    const before = dbConnect.calls;
    await request("POST", "/api/auth/logout");
    assert.equal(dbConnect.calls - before, 1);
  });

  test("runs even when the request is about to be rejected with 401", async () => {
    const before = dbConnect.calls;
    await request("GET", "/api/user/current-user");
    assert.equal(
      dbConnect.calls - before,
      1,
      "connect was ordered before auth in the Express app and must stay there",
    );
  });
});
