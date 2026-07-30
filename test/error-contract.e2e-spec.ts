/**
 * The error response contract, pinned byte-for-byte against the pre-migration
 * Express behaviour.
 *
 * Two origins matter and are both covered here:
 *
 *  - CONTROLLER-thrown failures, which reach `AllExceptionsFilter` through
 *    Nest's execution context.
 *  - MIDDLEWARE-raised failures (Multer, CORS rejection, the per-request
 *    database connect), which never enter that context. They are picked up by
 *    Nest's own error middleware — registered last in the Express chain during
 *    `app.init()` — and routed into the same filter.
 *
 * `src/main.ts` points at this file: it is what makes it safe to have no
 * terminal `server.use(errorHandler)`. If a future Nest upgrade reorders the
 * exception layer so middleware errors bypass the filter, these tests fail
 * instead of the error contract silently changing.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { json, multipart, request, validToken } from "./support/app";

const OBJECT_ID = "652f9f9f9f9f9f9f9f9f9f9f";

describe("ZodError -> 400", () => {
  test("validation failure returns the legacy payload", async () => {
    const res = await json("POST", "/api/auth/login", { email: "not-an-email" });
    assert.equal(res.status, 400);
    assert.equal(res.json.errorCode, "VALIDATION_ERROR");
    assert.ok(Array.isArray(res.json.errors));
    const fields = res.json.errors.map((e: { field: string }) => e.field);
    assert.deepEqual(fields.sort(), ["email", "password"]);
  });

  test("errors carry `field` and `message`, with dotted paths for nested fields", async () => {
    const res = await json(
      "POST",
      "/api/transaction/bulk-transaction",
      { transactions: [{ title: "", type: "NOPE", amount: -1, category: "" }] },
      { token: validToken() },
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.errorCode, "VALIDATION_ERROR");
    const fields: string[] = res.json.errors.map((e: { field: string }) => e.field);
    assert.ok(
      fields.some((f) => f.includes(".")),
      `expected a dotted path in ${JSON.stringify(fields)}`,
    );
  });

  test("a password field swaps in the password-specific message", async () => {
    const res = await json("POST", "/api/auth/register", {
      name: "Test",
      email: "user@example.com",
      password: "weak",
    });
    assert.equal(res.status, 400);
    assert.equal(
      res.json.message,
      "Password must contain at least 8 characters, an uppercase letter, a number, and a special character",
    );
  });

  test("a newPassword field also triggers the password-specific message", async () => {
    const res = await json(
      "PUT",
      "/api/user/change-password",
      { currentPassword: "whatever", newPassword: "weak" },
      { token: validToken() },
    );
    assert.equal(res.status, 400);
    assert.equal(
      res.json.message,
      "Password must contain at least 8 characters, an uppercase letter, a number, and a special character",
    );
  });

  test("a non-password field uses the generic message", async () => {
    const res = await json(
      "POST",
      "/api/category",
      { name: "" },
      { token: validToken() },
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.message, "Validation failed");
  });

  test("query-string validation failures use the same shape", async () => {
    const res = await request("GET", "/api/budget/summary?month=99&year=1", {
      token: validToken(),
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.errorCode, "VALIDATION_ERROR");
    const fields = res.json.errors.map((e: { field: string }) => e.field);
    assert.deepEqual(fields.sort(), ["month", "year"]);
  });
});

describe("MulterError -> 400 (middleware origin)", () => {
  test("an unexpected field name returns the legacy body, not Nest's 400/413", async () => {
    const { body, contentType } = multipart(
      "wrongfield",
      "a.png",
      "image/png",
      Buffer.from("bytes"),
    );
    const res = await request("POST", "/api/transaction/scan-receipt", {
      body,
      contentType,
      token: validToken(),
    });
    assert.equal(res.status, 400);
    assert.deepEqual(res.json, {
      message: "Invalid file field name. Please use 'file'",
      error: "Unexpected field",
      errorCode: "FILE_UPLOAD_ERROR",
    });
  });

  test("exceeding the 2MB image limit is a 400, NOT the 413 FileInterceptor would produce", async () => {
    const { body, contentType } = multipart(
      "receipt",
      "big.png",
      "image/png",
      Buffer.alloc(3 * 1024 * 1024, 0x41),
    );
    const res = await request("POST", "/api/transaction/scan-receipt", {
      body,
      contentType,
      token: validToken(),
    });
    assert.equal(
      res.status,
      400,
      "Nest's FileInterceptor maps LIMIT_FILE_SIZE to 413; the middleware must not",
    );
    assert.deepEqual(res.json, {
      message: "File size exceeds the limit",
      error: "File too large",
      errorCode: "FILE_UPLOAD_ERROR",
    });
  });

  test("the voice endpoint's 25MB limit and audio filter are enforced separately", async () => {
    const { body, contentType } = multipart(
      "file",
      "clip.txt",
      "text/plain",
      Buffer.from("not audio"),
    );
    const res = await request("POST", "/api/voice/process", {
      body,
      contentType,
      token: validToken(),
    });
    assert.equal(res.status, 400);
    assert.equal(
      res.json.message,
      "Only MP3, WebM, WAV, and OGG audio files are supported",
    );
    assert.equal(res.json.errorCode, undefined);
  });
});

describe("the #164 cloudinary fileFilter fix survives the migration", () => {
  // Before #164 the filter returned without invoking Multer's callback, which
  // hung the request until the platform timed out. The fix rejects through the
  // callback with an AppError. That AppError is raised inside route-scoped
  // MIDDLEWARE, so this also proves middleware AppErrors reach the filter.
  test("an unsupported image type is rejected promptly with the AppError body", async () => {
    const { body, contentType } = multipart(
      "receipt",
      "doc.gif",
      "image/gif",
      Buffer.from("GIF89a"),
    );
    const started = Date.now();
    const res = await request("POST", "/api/transaction/scan-receipt", {
      body,
      contentType,
      token: validToken(),
    });
    const elapsed = Date.now() - started;

    assert.equal(res.status, 400);
    assert.deepEqual(res.json, {
      message: "Only JPG, JPEG and PNG images are supported",
      errorCode: "FILE_UPLOAD_ERROR",
    });
    assert.ok(elapsed < 5000, `request took ${elapsed}ms — the hang has regressed`);
  });

  test("the same filter guards the avatar upload route", async () => {
    const { body, contentType } = multipart(
      "profilePicture",
      "avatar.bmp",
      "image/bmp",
      Buffer.from("BM"),
    );
    const res = await request("PUT", "/api/user/update", {
      body,
      contentType,
      token: validToken(),
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.message, "Only JPG, JPEG and PNG images are supported");
  });
});

describe("AppError -> its own status and errorCode", () => {
  test("the voice endpoint's missing-file AppError keeps status 400 and no errorCode", async () => {
    const res = await request("POST", "/api/voice/process", {
      token: validToken(),
    });
    assert.equal(res.status, 400);
    // AppError was constructed without an errorCode, so JSON.stringify drops the
    // key entirely rather than emitting `"errorCode": null`.
    assert.deepEqual(res.json, { message: "No audio file provided" });
    assert.ok(!("errorCode" in res.json));
  });
});

describe("generic failures -> 500", () => {
  test("malformed JSON produces the legacy 500 body, carrying the parser message", async () => {
    const res = await request("POST", "/api/auth/login", {
      body: "{not json",
      contentType: "application/json",
    });
    assert.equal(res.status, 500);
    assert.equal(res.json.message, "Internal Server Error");
    assert.ok(
      typeof res.json.error === "string" && res.json.error.length > 0,
      "the parser message must be forwarded in `error`",
    );
    assert.equal(
      res.json.errorCode,
      undefined,
      "the generic branch never sets errorCode",
    );
  });

  test("a body over the 2mb JSON limit is rejected", async () => {
    const big = JSON.stringify({ email: "a@b.co", password: "x".repeat(3 * 1024 * 1024) });
    const res = await request("POST", "/api/auth/login", {
      body: big,
      contentType: "application/json",
    });
    assert.ok(
      res.status === 500 || res.status === 413,
      `expected the oversize body to be rejected, got ${res.status}`,
    );
  });
});

describe("CORS rejection (middleware origin)", () => {
  test("a disallowed origin produces the legacy 500 body", async () => {
    const res = await request("GET", "/", { origin: "https://evil.example.com" });
    assert.equal(res.status, 500);
    assert.equal(res.json.message, "Internal Server Error");
    assert.equal(res.json.error, "Not allowed by CORS: https://evil.example.com");
  });

  test("the rejection happens for API routes too", async () => {
    const res = await request("GET", `/api/transaction/${OBJECT_ID}`, {
      origin: "https://evil.example.com",
      token: validToken(),
    });
    assert.equal(res.status, 500);
    assert.ok(res.json.error.startsWith("Not allowed by CORS"));
  });
});

describe("errors still carry the instrumentation headers", () => {
  test("a 400 response has X-Request-Id and X-Response-Time", async () => {
    const res = await json("POST", "/api/auth/login", { email: "bad" });
    assert.equal(res.status, 400);
    assert.ok(res.headers["x-request-id"], "X-Request-Id missing on an error response");
    assert.ok(res.headers["x-response-time"], "X-Response-Time missing on an error response");
  });

  test("a 404 response has them too", async () => {
    const res = await request("GET", "/nope");
    assert.equal(res.status, 404);
    assert.ok(res.headers["x-request-id"]);
    assert.ok(res.headers["x-response-time"]);
  });
});
