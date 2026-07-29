/**
 * The platform-level middleware stack.
 *
 * Order in `main.ts` is load-bearing and mirrors the old `src/index.ts` exactly:
 * performanceLogger -> json/urlencoded -> passport.initialize -> manual CORS
 * headers -> cors() -> OPTIONS catch-all -> [Nest router]. These tests observe
 * that ordering through its externally visible effects.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { dbConnect, request, uniqueIp, validToken } from "./support/app";

const ALLOWED_ORIGIN = "https://voiceybill.com";
const ALLOWED_PREVIEW = "https://voiceybill.vercel.app";

describe("instrumentation headers", () => {
  test("every response carries X-Request-Id and X-Response-Time", async () => {
    for (const path of ["/", "/health", "/test", "/nope"]) {
      const res = await request("GET", path);
      assert.ok(res.headers["x-request-id"], `X-Request-Id missing on ${path}`);
      assert.ok(
        res.headers["x-response-time"],
        `X-Response-Time missing on ${path}`,
      );
      assert.match(String(res.headers["x-response-time"]), /^\d+\.\d{2}ms$/);
    }
  });

  test("X-Request-Id is unique per request", async () => {
    const a = await request("GET", "/health");
    const b = await request("GET", "/health");
    assert.notEqual(a.headers["x-request-id"], b.headers["x-request-id"]);
  });
});

describe("CORS", () => {
  test("an allowed origin is echoed with credentials and Vary", async () => {
    const res = await request("GET", "/health", { origin: ALLOWED_ORIGIN });
    assert.equal(res.status, 200);
    assert.equal(res.headers["access-control-allow-origin"], ALLOWED_ORIGIN);
    assert.equal(res.headers["access-control-allow-credentials"], "true");
    assert.match(String(res.headers["vary"]), /Origin/);
    assert.equal(
      res.headers["access-control-allow-methods"],
      "GET, POST, PUT, DELETE, OPTIONS, PATCH",
    );
    assert.equal(
      res.headers["access-control-allow-headers"],
      "Content-Type, Authorization, Accept, Origin, X-Requested-With",
    );
  });

  test("the configured FRONTEND_ORIGIN is allowed", async () => {
    const res = await request("GET", "/health", {
      origin: "http://localhost:5173",
    });
    assert.equal(res.status, 200);
    assert.equal(
      res.headers["access-control-allow-origin"],
      "http://localhost:5173",
    );
  });

  test("the vercel preview origin is allowed", async () => {
    const res = await request("GET", "/health", { origin: ALLOWED_PREVIEW });
    assert.equal(res.status, 200);
    assert.equal(res.headers["access-control-allow-origin"], ALLOWED_PREVIEW);
  });

  test("a request with no Origin header is allowed and gets no CORS headers", async () => {
    const res = await request("GET", "/health");
    assert.equal(res.status, 200);
    assert.equal(res.headers["access-control-allow-origin"], undefined);
  });

  test("OPTIONS preflight answers 204 for an allowed origin", async () => {
    const res = await request("OPTIONS", "/api/transaction/all", {
      origin: ALLOWED_ORIGIN,
    });
    assert.equal(res.status, 204);
    assert.equal(res.headers["access-control-allow-origin"], ALLOWED_ORIGIN);
    assert.equal(res.headers["access-control-allow-credentials"], "true");
  });

  test("OPTIONS preflight answers 204 even for an unknown path", async () => {
    // The OPTIONS catch-all is registered before the router, so it wins over
    // both the not-found handler and the voice router's own 200 handler.
    const res = await request("OPTIONS", "/anything/at/all", {
      origin: ALLOWED_ORIGIN,
    });
    assert.equal(res.status, 204);
  });

  test("OPTIONS on the voice route is 204, not the 200 its old router declared", async () => {
    const res = await request("OPTIONS", "/api/voice/process", {
      origin: ALLOWED_ORIGIN,
    });
    assert.equal(
      res.status,
      204,
      "the global OPTIONS handler must still shadow the voice-specific one",
    );
  });

  test("preflight does not require authentication", async () => {
    const res = await request("OPTIONS", "/api/user/current-user", {
      origin: ALLOWED_ORIGIN,
    });
    assert.equal(res.status, 204);
  });
});

describe("voice-specific CORS", () => {
  const PREVIEW_ORIGIN = "https://voiceybill-git-feature-branch.vercel.app";

  // PRE-EXISTING QUIRK, deliberately preserved. `voiceCors` accepts any
  // *voiceybill*.vercel.app preview origin, but it is route-scoped and therefore
  // runs AFTER the global `cors(corsOptions)` in the pre-router stack — which
  // rejects that origin first. The old Express app had the identical ordering
  // (global cors at index.ts:92, voice router mounted below it), so the wider
  // policy was already unreachable for origins the global policy refuses.
  //
  // These tests pin the behaviour as it actually is. Widening it is a real
  // behaviour change and belongs in its own PR, not a framework migration.
  test("a preview origin is rejected on the voice route, as the global policy dictates", async () => {
    const res = await request("POST", "/api/voice/process", {
      origin: PREVIEW_ORIGIN,
      token: validToken(),
    });
    assert.equal(res.status, 500);
    assert.equal(res.json.error, `Not allowed by CORS: ${PREVIEW_ORIGIN}`);
  });

  test("a preview origin is rejected identically on a non-voice route", async () => {
    const res = await request("GET", "/api/category", {
      origin: PREVIEW_ORIGIN,
      token: validToken(),
    });
    assert.equal(res.status, 500);
    assert.equal(res.json.error, `Not allowed by CORS: ${PREVIEW_ORIGIN}`);
  });

  test("voiceCors does not widen the accepted origin set", async () => {
    // If someone later moves voiceCors ahead of the global policy, or removes
    // the global one, these two must be updated together and consciously.
    const voice = await request("POST", "/api/voice/process", {
      origin: PREVIEW_ORIGIN,
      token: validToken(),
    });
    const other = await request("GET", "/api/category", {
      origin: PREVIEW_ORIGIN,
      token: validToken(),
    });
    assert.equal(voice.status, other.status);
  });
});

describe("rate limiting", () => {
  test("RateLimit headers are present on the credential routes", async () => {
    const res = await request("POST", "/api/auth/login", {
      body: JSON.stringify({}),
      contentType: "application/json",
      clientIp: uniqueIp(),
    });
    assert.ok(
      res.headers["ratelimit-limit"] || res.headers["ratelimit-policy"],
      "expected standard RateLimit headers on /auth/login",
    );
  });

  test("RateLimit headers are ABSENT on /auth/logout, which was never limited", async () => {
    const res = await request("POST", "/api/auth/logout", {
      clientIp: uniqueIp(),
    });
    assert.equal(res.status, 204);
    assert.equal(res.headers["ratelimit-limit"], undefined);
    assert.equal(res.headers["ratelimit-policy"], undefined);
  });

  test("RateLimit headers are absent on protected feature routes", async () => {
    const res = await request("GET", "/api/category", { token: validToken() });
    assert.equal(res.status, 200);
    assert.equal(res.headers["ratelimit-limit"], undefined);
  });

  test("the OTP limiter allows 6 requests per IP then answers 429", async () => {
    const ip = uniqueIp();
    const send = () =>
      request("POST", "/api/auth/resend-otp", {
        body: JSON.stringify({ email: "user@example.com" }),
        contentType: "application/json",
        clientIp: ip,
      });

    for (let i = 1; i <= 6; i += 1) {
      const res = await send();
      assert.notEqual(res.status, 429, `request ${i} should not be limited yet`);
    }
    const limited = await send();
    assert.equal(limited.status, 429);
    assert.equal(
      limited.json.message,
      "Too many requests, please try again later.",
    );
  });

  test("the OTP limiter budget is shared across all four OTP routes", async () => {
    const ip = uniqueIp();
    const paths = [
      "/api/auth/verify-otp",
      "/api/auth/resend-otp",
      "/api/auth/forgot-password",
      "/api/auth/reset-password",
    ];
    // Six requests spread over the four routes exhausts the single shared bucket.
    for (let i = 0; i < 6; i += 1) {
      await request("POST", paths[i % paths.length], {
        body: JSON.stringify({ email: "user@example.com" }),
        contentType: "application/json",
        clientIp: ip,
      });
    }
    const res = await request("POST", "/api/auth/forgot-password", {
      body: JSON.stringify({ email: "user@example.com" }),
      contentType: "application/json",
      clientIp: ip,
    });
    assert.equal(res.status, 429);
  });

  test("the auth limiter is a separate bucket from the OTP limiter", async () => {
    const ip = uniqueIp();
    for (let i = 0; i < 6; i += 1) {
      await request("POST", "/api/auth/resend-otp", {
        body: JSON.stringify({ email: "user@example.com" }),
        contentType: "application/json",
        clientIp: ip,
      });
    }
    // The OTP bucket is now exhausted for this IP; /auth/login must be unaffected.
    const res = await request("POST", "/api/auth/login", {
      body: JSON.stringify({ email: "user@example.com", password: "Str0ng!Passw0rd" }),
      contentType: "application/json",
      clientIp: ip,
    });
    assert.equal(res.status, 200);
  });

  test("limits are per-IP, so a different client is unaffected", async () => {
    const exhausted = uniqueIp();
    for (let i = 0; i < 7; i += 1) {
      await request("POST", "/api/auth/resend-otp", {
        body: JSON.stringify({ email: "user@example.com" }),
        contentType: "application/json",
        clientIp: exhausted,
      });
    }
    const other = await request("POST", "/api/auth/resend-otp", {
      body: JSON.stringify({ email: "user@example.com" }),
      contentType: "application/json",
      clientIp: uniqueIp(),
    });
    assert.notEqual(
      other.status,
      429,
      "trust proxy must be honoured so X-Forwarded-For keys the bucket",
    );
  });

  test("the rate limiter runs before routing, so it does not depend on a matched route", async () => {
    // Mirrors the Express behaviour where the limiter sat inside the auth router.
    const res = await request("POST", "/api/auth/login", {
      body: JSON.stringify({}),
      contentType: "application/json",
      clientIp: uniqueIp(),
    });
    assert.equal(res.status, 400, "still reaches the handler and validates");
  });
});

describe("body parsing", () => {
  test("JSON bodies are parsed for the controller", async () => {
    const res = await request("POST", "/api/auth/login", {
      body: JSON.stringify({ email: "user@example.com", password: "Str0ng!Passw0rd" }),
      contentType: "application/json",
    });
    assert.equal(res.status, 200);
  });

  test("urlencoded bodies are parsed too", async () => {
    const res = await request("POST", "/api/auth/login", {
      body: "email=user%40example.com&password=Str0ng%21Passw0rd",
      contentType: "application/x-www-form-urlencoded",
    });
    assert.equal(res.status, 200);
  });

  test("a request with no body reaches the handler and fails validation", async () => {
    const res = await request("POST", "/api/auth/login");
    assert.equal(res.status, 400);
    assert.equal(res.json.errorCode, "VALIDATION_ERROR");
  });
});

describe("middleware executes exactly once per request", () => {
  test("the two route entries per prefix do not double-run the DB connect", async () => {
    // Each prefix is mounted as both `/api/x` and `/api/x/*`. If Nest registered
    // those as two Express layers the middleware would run twice, doubling the
    // per-request connect check and every authenticated user lookup.
    for (const path of [
      "/api/category",
      "/api/budget/list",
      "/api/transaction/all",
      "/api/analytics/summary",
    ]) {
      const before = dbConnect.calls;
      await request("GET", path, { token: validToken() });
      assert.equal(
        dbConnect.calls - before,
        1,
        `${path} ran the connect middleware ${dbConnect.calls - before} times`,
      );
    }
  });

  test("the bare prefix itself is covered by the middleware", async () => {
    const before = dbConnect.calls;
    await request("GET", "/api/category", { token: validToken() });
    assert.equal(dbConnect.calls - before, 1);
  });

  test("a non-API path never touches the connect middleware", async () => {
    const before = dbConnect.calls;
    await request("GET", "/nope");
    assert.equal(dbConnect.calls, before);
  });
});
