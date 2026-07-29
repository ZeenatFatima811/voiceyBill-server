/**
 * Deterministic stand-ins for the I/O leaves.
 *
 * Every fake records the arguments the HTTP layer handed it, so tests can assert
 * that routing, validation and the `@Body()`/`@Param()`/`@Query()`/
 * `@UploadedFile()`/`@CurrentUser()` bindings deliver exactly what the old
 * Express controllers delivered to the same functions.
 */

export interface Call {
  fn: string;
  args: unknown[];
}

export const calls: Call[] = [];

export const resetCalls = (): void => {
  calls.length = 0;
};

export const callsTo = (fn: string): Call[] => calls.filter((c) => c.fn === fn);

export const lastCall = (fn: string): Call | undefined =>
  callsTo(fn)[callsTo(fn).length - 1];

/** Wraps a fixed return value in an async function that records its arguments. */
const rec =
  <T>(fn: string, result: T) =>
  async (...args: unknown[]): Promise<T> => {
    calls.push({ fn, args });
    return result;
  };

/** The user `findByIdUserService` resolves for a valid token. */
export const TEST_USER = {
  _id: "652f9f9f9f9f9f9f9f9f9f9f",
  email: "user@example.com",
  name: "Test User",
  baseCurrency: "PKR",
  toString() {
    return this._id;
  },
};

/** Ids the fake user lookup recognises. Anything else resolves to null. */
export const KNOWN_USER_IDS = new Set([TEST_USER._id]);

export const userServiceStub = {
  findByIdUserService: async (userId: unknown) => {
    calls.push({ fn: "findByIdUserService", args: [userId] });
    return KNOWN_USER_IDS.has(String(userId)) ? TEST_USER : null;
  },
  updateUserService: rec("updateUserService", { ...TEST_USER, name: "Updated" }),
  changePasswordService: rec("changePasswordService", {
    message: "Password changed successfully",
  }),
  sendDeleteAccountOtpService: rec("sendDeleteAccountOtpService", undefined),
  deleteUserService: rec("deleteUserService", undefined),
};

export const authServiceStub = {
  registerService: rec("registerService", { userId: TEST_USER._id }),
  loginService: rec("loginService", {
    user: TEST_USER,
    accessToken: "access-token",
    refreshToken: "refresh-token",
    expiresAt: 1893456000,
    reportSetting: { enabled: true },
  }),
  verifyOtpService: rec("verifyOtpService", { verified: true }),
  resendOtpService: rec("resendOtpService", { message: "OTP resent" }),
  forgotPasswordService: rec("forgotPasswordService", { message: "Reset link sent" }),
  resetPasswordService: rec("resetPasswordService", { message: "Password reset" }),
  refreshTokenService: rec("refreshTokenService", {
    accessToken: "new-access-token",
    expiresAt: 1893456000,
  }),
};

export const googleAuthServiceStub = {
  googleAuthService: rec("googleAuthService", {
    user: TEST_USER,
    accessToken: "g-access",
    refreshToken: "g-refresh",
    expiresAt: 1893456000,
    reportSetting: { enabled: false },
  }),
};

export const transactionServiceStub = {
  createTransactionService: rec("createTransactionService", { _id: "t1" }),
  getAllTransactionService: rec("getAllTransactionService", {
    transactions: [],
    pagination: { pageSize: 20, pageNumber: 1, totalCount: 0, totalPages: 0 },
  }),
  getTransactionByIdService: rec("getTransactionByIdService", { _id: "t1" }),
  duplicateTransactionService: rec("duplicateTransactionService", { _id: "t2" }),
  updateTransactionService: rec("updateTransactionService", undefined),
  deleteTransactionService: rec("deleteTransactionService", undefined),
  bulkDeleteTransactionService: rec("bulkDeleteTransactionService", {
    deletedCount: 2,
  }),
  bulkTransactionService: rec("bulkTransactionService", { insertedCount: 2 }),
  scanReceiptService: rec("scanReceiptService", {
    title: "Groceries",
    amount: 1200,
    category: "Food",
  }),
};

export const categoryServiceStub = {
  getCategoriesService: rec("getCategoriesService", [{ _id: "c1", name: "Food" }]),
  getUserCategoryNames: rec("getUserCategoryNames", ["Food", "Transport"]),
  createCategoryService: rec("createCategoryService", { _id: "c2", name: "Bills" }),
  updateCategoryService: rec("updateCategoryService", { _id: "c1", name: "Dining" }),
  deleteCategoryService: rec("deleteCategoryService", {
    message: "Category deleted successfully",
  }),
};

/**
 * Shaped to satisfy the real `toBudgetResponseDTO`, which is NOT stubbed — the
 * controller runs it for real, so the response body is the genuine DTO.
 */
export const FAKE_BUDGET = {
  _id: "b1",
  month: 7,
  year: 2026,
  totalBudget: 50000,
  categoryLimits: [{ category: "Food", limit: 20000 }],
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-15T00:00:00.000Z",
};

export const budgetServiceStub = {
  createOrUpdateBudget: rec("createOrUpdateBudget", FAKE_BUDGET),
  getBudgetSummary: rec("getBudgetSummary", {
    hasBudget: true,
    month: 7,
    year: 2026,
    totalBudget: 50000,
    spent: 12000,
    remaining: 38000,
    usagePercentage: 24,
    exceeded: false,
    categories: [],
    alerts: [],
  }),
  deleteBudget: rec("deleteBudget", { deleted: true }),
  getUserBudgets: rec("getUserBudgets", [FAKE_BUDGET]),
  getCurrentMonthBudget: rec("getCurrentMonthBudget", null),
};

export const reportServiceStub = {
  getAllReportsService: rec("getAllReportsService", {
    reports: [],
    pagination: { pageSize: 20, pageNumber: 1, totalCount: 0 },
  }),
  updateReportSettingService: rec("updateReportSettingService", undefined),
  generateReportService: rec("generateReportService", { report: { total: 0 } }),
  resendReportService: rec("resendReportService", undefined),
};

export const analyticsServiceStub = {
  summaryAnalyticsService: rec("summaryAnalyticsService", { income: 1, expense: 2 }),
  chartAnalyticsService: rec("chartAnalyticsService", [{ date: "2026-07-01" }]),
  expensePieChartBreakdownService: rec("expensePieChartBreakdownService", {
    breakdown: [],
  }),
};

export const exchangeRateStub = {
  ExchangeRateService: class {},
  exchangeRateService: {
    getSupportedCurrencies: async () => {
      calls.push({ fn: "getSupportedCurrencies", args: [] });
      return { USD: "US Dollar", PKR: "Pakistani Rupee" };
    },
    getRate: async (from: string, to: string) => {
      calls.push({ fn: "getRate", args: [from, to] });
      return { rate: 278.5, source: "cache", rateDate: "2026-07-30" };
    },
  },
};

/** Text the fake transcriber returns; a test flips this to "" to hit the no-speech branch. */
export const voiceState = { transcription: "spent 500 on lunch", failWith: null as Error | null };

export const upliftStub = {
  UpliftAIService: class {
    constructor(public key: string) {}
    validateAudioFile(filePath: string) {
      calls.push({ fn: "validateAudioFile", args: [filePath] });
      return true;
    }
    async transcribeAudio(filePath: string) {
      calls.push({ fn: "transcribeAudio", args: [filePath] });
      if (voiceState.failWith) throw voiceState.failWith;
      return { text: voiceState.transcription };
    }
  },
};

export const geminiStub = {
  OpenAIClassificationService: class {},
  GeminiClassificationService: class {
    constructor(public key: string) {}
    async classifyTransaction(text: string, categories: string[]) {
      calls.push({ fn: "classifyTransaction", args: [text, categories] });
      return {
        title: "Lunch",
        amount: 500,
        date: "2026-07-30",
        description: "Lunch",
        category: "Food",
        paymentMethod: "CASH",
        type: "EXPENSE",
        currency: "PKR",
        confidence: 0.92,
      };
    }
  },
};

export const cronStub = {
  initializeCrons: async () => {
    calls.push({ fn: "initializeCrons", args: [] });
  },
};
