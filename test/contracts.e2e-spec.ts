/**
 * Per-route response contract and argument pass-through.
 *
 * This is the coverage the PR's manual validation could not reach: the SUCCESS
 * paths for every write route, plus the voice endpoint. Each test asserts both
 * the response envelope the clients depend on AND that the HTTP layer handed the
 * service the same arguments the old Express controller did — so a mis-bound
 * `@Body()`, `@Param()`, `@Query()`, `@UploadedFile()` or `@CurrentUser()` is
 * caught rather than silently passing `undefined` through.
 */
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import { fakes, json, multipart, request, uniqueIp, validToken } from "./support/app";

const OBJECT_ID = "652f9f9f9f9f9f9f9f9f9f9f";
const OTHER_ID = "652f9f9f9f9f9f9f9f9f9fab";
const auth = () => ({ token: validToken() });

const pngUpload = () =>
  multipart("receipt", "receipt.png", "image/png", Buffer.from("fake-png"));
const avatarUpload = () =>
  multipart("profilePicture", "me.jpg", "image/jpeg", Buffer.from("fake-jpg"));
const audioUpload = () =>
  multipart("file", "clip.webm", "audio/webm", Buffer.from("fake-audio"));

beforeEach(() => fakes.resetCalls());

describe("auth routes", () => {
  test("POST /register -> 201 and passes the parsed body", async () => {
    const body = {
      name: "Test User",
      email: "user@example.com",
      password: "Str0ng!Passw0rd",
    };
    const res = await json("POST", "/api/auth/register", body, {
      clientIp: uniqueIp(),
    });
    assert.equal(res.status, 201);
    assert.equal(res.json.message, "Verification code sent to your email");
    assert.deepEqual(res.json.data, { userId: fakes.TEST_USER._id });
    assert.deepEqual(fakes.lastCall("registerService")?.args[0], body);
  });

  test("POST /login -> 200 with the flattened token envelope", async () => {
    const res = await json(
      "POST",
      "/api/auth/login",
      { email: "user@example.com", password: "Str0ng!Passw0rd" },
      { clientIp: uniqueIp() },
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.message, "User logged in successfully");
    assert.equal(res.json.accessToken, "access-token");
    assert.equal(res.json.refreshToken, "refresh-token");
    assert.equal(res.json.expiresAt, 1893456000);
    assert.deepEqual(res.json.reportSetting, { enabled: true });
    assert.equal(res.json.user.email, fakes.TEST_USER.email);
  });

  test("POST /google -> 200 with the same envelope shape as login", async () => {
    const res = await json(
      "POST",
      "/api/auth/google",
      { idToken: "google-id-token" },
      { clientIp: uniqueIp() },
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.message, "User authenticated successfully with Google");
    assert.equal(res.json.accessToken, "g-access");
    assert.deepEqual(fakes.lastCall("googleAuthService")?.args[0], {
      idToken: "google-id-token",
    });
  });

  test("POST /refresh-token -> 200 and spreads the service result", async () => {
    const res = await json(
      "POST",
      "/api/auth/refresh-token",
      { refreshToken: "a-refresh-token" },
      { clientIp: uniqueIp() },
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.message, "Token refreshed");
    assert.equal(res.json.accessToken, "new-access-token");
    assert.equal(
      fakes.lastCall("refreshTokenService")?.args[0],
      "a-refresh-token",
      "the controller must unwrap the token from the body, not pass the whole body",
    );
  });

  test("POST /logout -> 204, empty body, no service call", async () => {
    const res = await request("POST", "/api/auth/logout", { clientIp: uniqueIp() });
    assert.equal(res.status, 204);
    assert.equal(res.text, "");
    assert.equal(fakes.calls.length, 0);
  });

  test("POST /verify-otp -> 200 with data envelope", async () => {
    const res = await json(
      "POST",
      "/api/auth/verify-otp",
      { email: "user@example.com", otp: "123456" },
      { clientIp: uniqueIp() },
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.message, "Email verified successfully");
    assert.deepEqual(res.json.data, { verified: true });
  });

  test("POST /resend-otp -> 200 and echoes the service message", async () => {
    const res = await json(
      "POST",
      "/api/auth/resend-otp",
      { email: "user@example.com" },
      { clientIp: uniqueIp() },
    );
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { message: "OTP resent" });
  });

  test("POST /forgot-password -> 200 and echoes the service message", async () => {
    const res = await json(
      "POST",
      "/api/auth/forgot-password",
      { email: "user@example.com" },
      { clientIp: uniqueIp() },
    );
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { message: "Reset link sent" });
  });

  test("POST /reset-password -> 200 and echoes the service message", async () => {
    const res = await json(
      "POST",
      "/api/auth/reset-password",
      { email: "user@example.com", otp: "123456", password: "Str0ng!Passw0rd" },
      { clientIp: uniqueIp() },
    );
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { message: "Password reset" });
  });
});

describe("user routes", () => {
  test("GET /current-user -> 200 and looks up the authenticated user id", async () => {
    const res = await request("GET", "/api/user/current-user", auth());
    assert.equal(res.status, 200);
    assert.equal(res.json.message, "User fetched successfully");
    // Two lookups: one by the JWT strategy, one by the controller.
    const ids = fakes.callsTo("findByIdUserService").map((c) => String(c.args[0]));
    assert.ok(ids.includes(fakes.TEST_USER._id));
  });

  test("PUT /update -> 200 with a multipart avatar, forwarding the file", async () => {
    const { body, contentType } = avatarUpload();
    const res = await request("PUT", "/api/user/update", {
      body,
      contentType,
      ...auth(),
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.message, "User profile updated successfully");
    assert.equal(res.json.data.name, "Updated");

    const call = fakes.lastCall("updateUserService");
    assert.equal(String(call?.args[0]), fakes.TEST_USER._id, "userId not forwarded");
    const file = call?.args[2] as { originalname?: string } | undefined;
    assert.equal(
      file?.originalname,
      "me.jpg",
      "@UploadedFile() must deliver the Multer file the middleware attached",
    );
  });

  test("PUT /update -> 200 with a JSON body and no file", async () => {
    const res = await json(
      "PUT",
      "/api/user/update",
      { name: "Renamed", baseCurrency: "usd" },
      auth(),
    );
    assert.equal(res.status, 200);
    const call = fakes.lastCall("updateUserService");
    assert.deepEqual(call?.args[1], { name: "Renamed", baseCurrency: "USD" });
    assert.equal(call?.args[2], undefined, "no file should be forwarded");
  });

  test("PUT /change-password -> 200 returning the service result verbatim", async () => {
    const res = await json(
      "PUT",
      "/api/user/change-password",
      { currentPassword: "Old!Passw0rd", newPassword: "New!Passw0rd1" },
      auth(),
    );
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { message: "Password changed successfully" });
  });

  test("POST /account/otp -> 200 with the fixed message", async () => {
    const res = await request("POST", "/api/user/account/otp", auth());
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { message: "OTP sent to your registered email" });
    assert.equal(fakes.callsTo("sendDeleteAccountOtpService").length, 1);
  });

  test("DELETE /account -> 200 and parses the OTP from the request body", async () => {
    const res = await json("DELETE", "/api/user/account", { otp: "654321" }, auth());
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { message: "User account deleted successfully" });
    assert.deepEqual(fakes.lastCall("deleteUserService")?.args[1], { otp: "654321" });
  });
});

describe("transaction routes", () => {
  const validTransaction = {
    title: "Coffee",
    type: "EXPENSE",
    amount: 4.5,
    category: "Food",
    date: "2026-07-30T10:00:00.000Z",
    paymentMethod: "CASH",
  };

  test("POST /create -> 201 and forwards (body, userId) in that order", async () => {
    const res = await json("POST", "/api/transaction/create", validTransaction, auth());
    assert.equal(res.status, 201);
    assert.equal(res.json.message, "Transaction created successfully");
    assert.deepEqual(res.json.transaction, { _id: "t1" });

    const call = fakes.lastCall("createTransactionService");
    const parsed = call?.args[0] as Record<string, unknown>;
    assert.equal(parsed.title, "Coffee");
    assert.equal(parsed.amount, 4.5);
    assert.ok(parsed.date instanceof Date, "the Zod transform to Date must survive");
    assert.equal(parsed.isRecurring, false, "Zod defaults must be applied");
    assert.equal(String(call?.args[1]), fakes.TEST_USER._id);
  });

  test("POST /scan-receipt -> 200, forwarding the file and the user's categories", async () => {
    const { body, contentType } = pngUpload();
    const res = await request("POST", "/api/transaction/scan-receipt", {
      body,
      contentType,
      ...auth(),
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.message, "Receipt scanned successfully");
    assert.equal(res.json.data.title, "Groceries");

    assert.equal(fakes.callsTo("getUserCategoryNames").length, 1);
    const call = fakes.lastCall("scanReceiptService");
    const file = call?.args[0] as { originalname?: string } | undefined;
    assert.equal(file?.originalname, "receipt.png");
    assert.deepEqual(call?.args[1], ["Food", "Transport"]);
  });

  test("POST /bulk-transaction -> 200 and unwraps `transactions`", async () => {
    const res = await json(
      "POST",
      "/api/transaction/bulk-transaction",
      { transactions: [validTransaction, { ...validTransaction, title: "Tea" }] },
      auth(),
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.message, "Bulk transaction inserted successfully");
    assert.equal(res.json.insertedCount, 2, "the service result must be spread");

    const call = fakes.lastCall("bulkTransactionService");
    assert.equal(String(call?.args[0]), fakes.TEST_USER._id);
    assert.equal((call?.args[1] as unknown[]).length, 2);
  });

  test("PUT /duplicate/:id -> 200 and forwards the path parameter", async () => {
    const res = await request("PUT", `/api/transaction/duplicate/${OBJECT_ID}`, auth());
    assert.equal(res.status, 200);
    assert.equal(res.json.message, "Transaction duplicated successfully");
    assert.deepEqual(res.json.data, { _id: "t2" });
    assert.equal(fakes.lastCall("duplicateTransactionService")?.args[1], OBJECT_ID);
  });

  test("PUT /update/:id -> 200 forwarding (userId, id, partial body)", async () => {
    const res = await json(
      "PUT",
      `/api/transaction/update/${OBJECT_ID}`,
      { title: "Renamed" },
      auth(),
    );
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { message: "Transaction updated successfully" });

    const call = fakes.lastCall("updateTransactionService");
    assert.equal(String(call?.args[0]), fakes.TEST_USER._id);
    assert.equal(call?.args[1], OBJECT_ID);
    assert.deepEqual(call?.args[2], { title: "Renamed" });
  });

  test("GET /all -> 200 forwarding filters and pagination from the query string", async () => {
    const res = await request(
      "GET",
      "/api/transaction/all?keyword=coffee&type=EXPENSE&recurringStatus=RECURRING" +
        "&startDate=2026-07-01&endDate=2026-07-31&pageSize=2&pageNumber=3",
      auth(),
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.message, "Transaction fetched successfully");
    assert.ok("pagination" in res.json, "the service result must be spread");

    const call = fakes.lastCall("getAllTransactionService");
    assert.deepEqual(call?.args[1], {
      keyword: "coffee",
      type: "EXPENSE",
      recurringStatus: "RECURRING",
      startDate: "2026-07-01",
      endDate: "2026-07-31",
    });
    assert.deepEqual(
      call?.args[2],
      { pageSize: "2", pageNumber: "3" },
      "pagination values stay raw strings, as req.query produced before",
    );
  });

  test("GET /all with no query -> all filters undefined", async () => {
    await request("GET", "/api/transaction/all", auth());
    const call = fakes.lastCall("getAllTransactionService");
    assert.deepEqual(call?.args[1], {
      keyword: undefined,
      type: undefined,
      recurringStatus: undefined,
      startDate: undefined,
      endDate: undefined,
    });
  });

  test("GET /:id -> 200 forwarding the id", async () => {
    const res = await request("GET", `/api/transaction/${OBJECT_ID}`, auth());
    assert.equal(res.status, 200);
    assert.equal(res.json.message, "Transaction fetched successfully");
    assert.equal(fakes.lastCall("getTransactionByIdService")?.args[1], OBJECT_ID);
  });

  test("DELETE /delete/:id -> 200 forwarding the id", async () => {
    const res = await request("DELETE", `/api/transaction/delete/${OBJECT_ID}`, auth());
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { message: "Transaction deleted successfully" });
    assert.equal(fakes.lastCall("deleteTransactionService")?.args[1], OBJECT_ID);
  });

  test("DELETE /bulk-delete -> 200 unwrapping `transactionIds` and spreading the result", async () => {
    const res = await json(
      "DELETE",
      "/api/transaction/bulk-delete",
      { transactionIds: [OBJECT_ID, OTHER_ID] },
      auth(),
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.message, "Transaction deleted successfully");
    assert.equal(res.json.deletedCount, 2);
    assert.deepEqual(fakes.lastCall("bulkDeleteTransactionService")?.args[1], [
      OBJECT_ID,
      OTHER_ID,
    ]);
  });
});

describe("category routes", () => {
  test("GET / -> 200 with the data envelope", async () => {
    const res = await request("GET", "/api/category", auth());
    assert.equal(res.status, 200);
    assert.equal(res.json.message, "Categories fetched successfully");
    assert.deepEqual(res.json.data, [{ _id: "c1", name: "Food" }]);
  });

  test("POST / -> 201 applying the Zod colour default", async () => {
    const res = await json("POST", "/api/category", { name: "Bills" }, auth());
    assert.equal(res.status, 201);
    assert.equal(res.json.message, "Category created successfully");
    assert.deepEqual(fakes.lastCall("createCategoryService")?.args[1], {
      name: "Bills",
      color: "#6B7280",
    });
  });

  test("PUT /:id -> 200 forwarding (userId, id, body)", async () => {
    const res = await json(
      "PUT",
      `/api/category/${OBJECT_ID}`,
      { name: "Dining", color: "#AABBCC" },
      auth(),
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.message, "Category updated successfully");
    const call = fakes.lastCall("updateCategoryService");
    assert.equal(call?.args[1], OBJECT_ID);
    assert.deepEqual(call?.args[2], { name: "Dining", color: "#AABBCC" });
  });

  test("DELETE /:id -> 200 returning the service result verbatim", async () => {
    const res = await request("DELETE", `/api/category/${OBJECT_ID}`, auth());
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { message: "Category deleted successfully" });
    assert.equal(fakes.lastCall("deleteCategoryService")?.args[1], OBJECT_ID);
  });

  test("a reserved category name is rejected by the real validator", async () => {
    const res = await json("POST", "/api/category", { name: "undefined" }, auth());
    assert.equal(res.status, 400);
    assert.equal(
      res.json.errors[0].message,
      "That category name is reserved. Please choose another.",
    );
  });
});

describe("budget routes", () => {
  const validBudget = {
    totalBudget: 50000,
    categoryLimits: [{ category: "Food", limit: 20000 }],
    month: 7,
    year: 2026,
  };

  test("PUT / -> 200 running the real toBudgetResponseDTO", async () => {
    const res = await json("PUT", "/api/budget", validBudget, auth());
    assert.equal(res.status, 200);
    assert.equal(res.json.message, "Budget set successfully");
    assert.deepEqual(res.json.data, {
      id: "b1",
      month: 7,
      year: 2026,
      totalBudget: 50000,
      categoryLimits: [{ category: "Food", limit: 20000 }],
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-15T00:00:00.000Z",
    });
    assert.deepEqual(fakes.lastCall("createOrUpdateBudget")?.args[1], validBudget);
  });

  test("PUT / rejects category limits exceeding the total", async () => {
    const res = await json(
      "PUT",
      "/api/budget",
      { ...validBudget, categoryLimits: [{ category: "Food", limit: 99999 }] },
      auth(),
    );
    assert.equal(res.status, 400);
    assert.equal(
      res.json.errors[0].message,
      "Sum of category limits cannot exceed total budget",
    );
  });

  test("GET /summary -> 200 coercing month/year from the query string", async () => {
    const res = await request("GET", "/api/budget/summary?month=7&year=2026", auth());
    assert.equal(res.status, 200);
    assert.equal(res.json.message, "Budget summary retrieved successfully");
    assert.deepEqual(
      fakes.lastCall("getBudgetSummary")?.args[1],
      { month: 7, year: 2026 },
      "z.coerce must turn the query strings into numbers",
    );
  });

  test("DELETE / -> 200 coercing month/year from the query string", async () => {
    const res = await request("DELETE", "/api/budget?month=7&year=2026", auth());
    assert.equal(res.status, 200);
    assert.equal(res.json.message, "Budget deleted successfully");
    assert.deepEqual(fakes.lastCall("deleteBudget")?.args[1], { month: 7, year: 2026 });
  });

  test("GET /list -> 200 mapping every budget through the DTO", async () => {
    const res = await request("GET", "/api/budget/list", auth());
    assert.equal(res.status, 200);
    assert.equal(res.json.message, "Budgets retrieved successfully");
    assert.equal(res.json.data.length, 1);
    assert.equal(res.json.data[0].id, "b1");
  });

  test("GET /current -> 200 with null data when there is no budget", async () => {
    const res = await request("GET", "/api/budget/current", auth());
    assert.equal(res.status, 200);
    assert.equal(res.json.message, "Current month budget retrieved successfully");
    assert.equal(res.json.data, null, "a missing budget must serialise as null");
  });
});

describe("analytics routes", () => {
  for (const [path, message, fn] of [
    ["summary", "Summary fetched successfully", "summaryAnalyticsService"],
    ["chart", "Chart fetched successfully", "chartAnalyticsService"],
    [
      "expense-breakdown",
      "Expense breakdown fetched successfully",
      "expensePieChartBreakdownService",
    ],
  ] as const) {
    test(`GET /${path} -> 200 forwarding preset and custom range`, async () => {
      const res = await request(
        "GET",
        `/api/analytics/${path}?preset=LAST_30_DAYS&from=2026-07-01&to=2026-07-31`,
        auth(),
      );
      assert.equal(res.status, 200);
      assert.equal(res.json.message, message);

      const call = fakes.lastCall(fn);
      assert.equal(call?.args[1], "LAST_30_DAYS");
      assert.ok(call?.args[2] instanceof Date, "`from` must become a Date");
      assert.ok(call?.args[3] instanceof Date, "`to` must become a Date");
    });
  }

  test("GET /summary with no range -> undefined custom dates", async () => {
    await request("GET", "/api/analytics/summary", auth());
    const call = fakes.lastCall("summaryAnalyticsService");
    assert.equal(call?.args[2], undefined);
    assert.equal(call?.args[3], undefined);
  });

  test("GET /dashboard -> 200 combining all three aggregations concurrently", async () => {
    const res = await request("GET", "/api/analytics/dashboard", auth());
    assert.equal(res.status, 200);
    assert.equal(res.json.message, "Dashboard analytics fetched successfully");
    assert.deepEqual(Object.keys(res.json.data).sort(), [
      "chart",
      "expenseBreakdown",
      "summary",
    ]);
    assert.equal(fakes.callsTo("summaryAnalyticsService").length, 1);
    assert.equal(fakes.callsTo("chartAnalyticsService").length, 1);
    assert.equal(fakes.callsTo("expensePieChartBreakdownService").length, 1);
  });

  test("GET /dashboard returns the same payloads as the individual endpoints", async () => {
    const dashboard = await request("GET", "/api/analytics/dashboard", auth());
    const summary = await request("GET", "/api/analytics/summary", auth());
    assert.deepEqual(dashboard.json.data.summary, summary.json.data);
  });
});

describe("report routes", () => {
  test("GET /all -> 200 with defaulted pagination", async () => {
    const res = await request("GET", "/api/report/all", auth());
    assert.equal(res.status, 200);
    assert.equal(res.json.message, "Reports history fetched successfully");
    assert.deepEqual(
      fakes.lastCall("getAllReportsService")?.args[1],
      { pageSize: 20, pageNumber: 1 },
      "the parseInt-with-fallback defaults must be preserved",
    );
  });

  test("GET /all -> 200 honouring explicit pagination", async () => {
    await request("GET", "/api/report/all?pageSize=5&pageNumber=2", auth());
    assert.deepEqual(fakes.lastCall("getAllReportsService")?.args[1], {
      pageSize: 5,
      pageNumber: 2,
    });
  });

  test("GET /all falls back to defaults for non-numeric pagination", async () => {
    await request("GET", "/api/report/all?pageSize=abc&pageNumber=xyz", auth());
    assert.deepEqual(fakes.lastCall("getAllReportsService")?.args[1], {
      pageSize: 20,
      pageNumber: 1,
    });
  });

  test("GET /generate -> 200 forwarding dates and the user's baseCurrency", async () => {
    const res = await request(
      "GET",
      "/api/report/generate?from=2026-07-01&to=2026-07-31",
      auth(),
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.message, "Report generated successfully");
    assert.ok("report" in res.json, "the service result must be spread");

    const call = fakes.lastCall("generateReportService");
    assert.ok(call?.args[1] instanceof Date);
    assert.ok(call?.args[2] instanceof Date);
    assert.equal(
      call?.args[3],
      "PKR",
      "baseCurrency must come from the authenticated user, not a hardcoded USD",
    );
  });

  test("PUT /update-setting -> 200 with the partial schema", async () => {
    const res = await json("PUT", "/api/report/update-setting", { isEnabled: false }, auth());
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { message: "Reports setting updated successfully" });
    assert.deepEqual(fakes.lastCall("updateReportSettingService")?.args[1], {
      isEnabled: false,
    });
  });

  test("POST /resend/:id -> 200 forwarding the report id", async () => {
    const res = await request("POST", `/api/report/resend/${OBJECT_ID}`, auth());
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { message: "Report resend successfully" });
    assert.equal(fakes.lastCall("resendReportService")?.args[1], OBJECT_ID);
  });
});

describe("currency routes", () => {
  test("GET /supported -> 200 enriching each code with a symbol", async () => {
    const res = await request("GET", "/api/currency/supported", auth());
    assert.equal(res.status, 200);
    assert.equal(res.json.message, "Supported currencies fetched successfully");
    const usd = res.json.currencies.find((c: { code: string }) => c.code === "USD");
    assert.deepEqual(usd, { code: "USD", name: "US Dollar", symbol: "$" });
  });

  test("GET /rate -> 200 with the default USD->EUR pair", async () => {
    const res = await request("GET", "/api/currency/rate", auth());
    assert.equal(res.status, 200);
    assert.equal(res.json.message, "Exchange rate fetched successfully");
    assert.equal(res.json.data.from, "USD");
    assert.equal(res.json.data.to, "EUR");
    assert.equal(res.json.data.rate, 278.5);
    assert.equal(res.json.data.source, "cache");
  });

  test("GET /rate upper-cases the supplied codes", async () => {
    const res = await request("GET", "/api/currency/rate?from=pkr&to=usd", auth());
    assert.equal(res.status, 200);
    assert.equal(res.json.data.from, "PKR");
    assert.deepEqual(fakes.lastCall("getRate")?.args, ["PKR", "USD"]);
  });

  test("GET /rate with an invalid code -> 400 and NO errorCode field", async () => {
    // The handler sets the status through `@Res({ passthrough: true })` rather
    // than throwing BadRequestException, precisely so the body stays free of the
    // errorCode field the old response did not have.
    const res = await request("GET", "/api/currency/rate?from=NOPE", auth());
    assert.equal(res.status, 400);
    assert.deepEqual(res.json, {
      message:
        "Invalid currency code. Please provide a supported ISO 4217 currency code.",
    });
    assert.ok(!("errorCode" in res.json));
    assert.equal(fakes.callsTo("getRate").length, 0, "no rate lookup on a bad code");
  });

  test("GET /rate with an invalid target code -> 400", async () => {
    const res = await request("GET", "/api/currency/rate?from=USD&to=ZZZ", auth());
    assert.equal(res.status, 400);
  });
});

describe("voice route", () => {
  test("POST /process -> 200 with the full transaction payload", async () => {
    fakes.voiceState.transcription = "spent 500 on lunch";
    fakes.voiceState.failWith = null;

    const { body, contentType } = audioUpload();
    const res = await request("POST", "/api/voice/process", {
      body,
      contentType,
      ...auth(),
    });

    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
    assert.equal(res.json.message, "Voice processed successfully");
    assert.equal(res.json.data.title, "Lunch");
    assert.equal(res.json.data.amount, 500);
    assert.equal(res.json.data.transcription, "spent 500 on lunch");
    assert.equal(res.json.data.confidence, 0.92);
    assert.ok(res.json.data.voiceUrl, "voiceUrl (the temp path) must be present");

    // The user's categories must reach the classifier.
    assert.deepEqual(fakes.lastCall("classifyTransaction")?.args, [
      "spent 500 on lunch",
      ["Food", "Transport"],
    ]);
  });

  test("POST /process cleans up the temporary file it wrote", async () => {
    fakes.voiceState.transcription = "spent 500 on lunch";
    fakes.voiceState.failWith = null;
    const { body, contentType } = audioUpload();
    const res = await request("POST", "/api/voice/process", {
      body,
      contentType,
      ...auth(),
    });
    const tmpPath = res.json.data.voiceUrl as string;
    const fs = require("fs") as typeof import("fs");
    assert.equal(
      fs.existsSync(tmpPath),
      false,
      "the finally block must unlink the temp file",
    );
  });

  test("POST /process -> 200 success:false when nothing was transcribed", async () => {
    fakes.voiceState.transcription = "   ";
    fakes.voiceState.failWith = null;

    const { body, contentType } = audioUpload();
    const res = await request("POST", "/api/voice/process", {
      body,
      contentType,
      ...auth(),
    });

    assert.equal(res.status, 200, "transport success is decoupled from processing");
    assert.equal(res.json.success, false);
    assert.equal(res.json.message, "Voice processed successfully");
    assert.equal(res.json.data.error, "No speech detected in audio file");
    assert.equal(fakes.callsTo("classifyTransaction").length, 0);
  });

  test("POST /process -> 200 success:false when transcription throws", async () => {
    fakes.voiceState.transcription = "irrelevant";
    fakes.voiceState.failWith = new Error("upstream exploded");

    const { body, contentType } = audioUpload();
    const res = await request("POST", "/api/voice/process", {
      body,
      contentType,
      ...auth(),
    });

    assert.equal(res.status, 200);
    assert.equal(res.json.success, false);
    assert.equal(res.json.data.error, "upstream exploded");

    fakes.voiceState.failWith = null;
  });

  test("POST /process -> 200 with the timeout message when the error mentions timeout", async () => {
    fakes.voiceState.failWith = new Error("request timeout reached");

    const { body, contentType } = audioUpload();
    const res = await request("POST", "/api/voice/process", {
      body,
      contentType,
      ...auth(),
    });

    assert.equal(res.status, 200);
    assert.equal(res.json.success, false);
    assert.equal(
      res.json.data.error,
      "Processing timeout - please try with shorter audio or try again",
    );

    fakes.voiceState.failWith = null;
  });

  test("POST /process accepts every allowed audio mime type", async () => {
    fakes.voiceState.failWith = null;
    fakes.voiceState.transcription = "spent 500 on lunch";
    for (const mime of [
      "audio/mpeg",
      "audio/mp3",
      "audio/webm",
      "audio/wav",
      "audio/ogg",
    ]) {
      const { body, contentType } = multipart(
        "file",
        `clip.${mime.split("/")[1]}`,
        mime,
        Buffer.from("fake-audio"),
      );
      const res = await request("POST", "/api/voice/process", {
        body,
        contentType,
        ...auth(),
      });
      assert.equal(res.status, 200, `${mime} was rejected`);
      assert.equal(res.json.success, true, `${mime} did not process`);
    }
  });
});
