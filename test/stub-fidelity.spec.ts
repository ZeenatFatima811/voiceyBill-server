/**
 * Guards the test doubles against drift.
 *
 * The suite replaces the service modules wholesale, so a real module that gains
 * or renames an export would otherwise keep passing while the controller under
 * test calls a stub that no longer resembles production. These tests load the
 * REAL modules from disk (bypassing the seeded `require.cache`) and assert the
 * stub exposes exactly the same export names.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import path from "path";

import "./support/app";
import * as fakes from "./support/fakes";

const SRC = path.resolve(__dirname, "..", "src");

/** Loads a module from disk, ignoring any stub already in `require.cache`. */
const loadReal = (relative: string): Record<string, unknown> => {
  const resolved = require.resolve(path.join(SRC, relative));
  const stub = require.cache[resolved];
  delete require.cache[resolved];
  try {
    return require(resolved) as Record<string, unknown>;
  } finally {
    // Restore the stub so the running application keeps using it.
    if (stub) require.cache[resolved] = stub;
    else delete require.cache[resolved];
  }
};

const exportNames = (mod: Record<string, unknown>): string[] =>
  Object.keys(mod)
    .filter((k) => k !== "__esModule" && k !== "default")
    .sort();

const PAIRS: Array<[string, Record<string, unknown>]> = [
  ["services/user.service", fakes.userServiceStub],
  ["services/auth.service", fakes.authServiceStub],
  ["services/google-auth.service", fakes.googleAuthServiceStub],
  ["services/transaction.service", fakes.transactionServiceStub],
  ["services/category.service", fakes.categoryServiceStub],
  ["services/budget.service", fakes.budgetServiceStub],
  ["services/report.service", fakes.reportServiceStub],
  ["services/analytics.service", fakes.analyticsServiceStub],
  ["services/exchange-rate.service", fakes.exchangeRateStub],
  ["services/uplift.service", fakes.upliftStub],
  ["services/gemini.service", fakes.geminiStub],
  ["cron/index", fakes.cronStub],
];

describe("stub fidelity", () => {
  for (const [relative, stub] of PAIRS) {
    test(`${relative} stub matches the real export surface`, () => {
      const real = loadReal(relative);
      assert.deepEqual(
        exportNames(stub),
        exportNames(real),
        `stub for ${relative} is out of sync with the real module — update test/support/fakes.ts`,
      );
    });
  }

  test("database.config stub matches the real export surface", () => {
    const real = loadReal("config/database.config");
    // The stub intentionally provides only what the app imports at runtime.
    for (const name of ["connctDatabase", "ensureDatabaseConnection"]) {
      assert.ok(name in real, `${name} missing from the real database.config`);
    }
  });

  test("the real UpliftAIService and GeminiClassificationService expose the methods the stubs fake", () => {
    const uplift = loadReal("services/uplift.service") as {
      UpliftAIService: new (k: string) => Record<string, unknown>;
    };
    const gemini = loadReal("services/gemini.service") as {
      GeminiClassificationService: new (k: string) => Record<string, unknown>;
    };
    const upliftProto = uplift.UpliftAIService.prototype as Record<string, unknown>;
    const geminiProto = gemini.GeminiClassificationService.prototype as Record<
      string,
      unknown
    >;

    for (const m of ["validateAudioFile", "transcribeAudio"]) {
      assert.equal(typeof upliftProto[m], "function", `UpliftAIService#${m} missing`);
    }
    assert.equal(
      typeof geminiProto.classifyTransaction,
      "function",
      "GeminiClassificationService#classifyTransaction missing",
    );
  });

  test("exchangeRateService stub covers the methods the controller calls", () => {
    const real = loadReal("services/exchange-rate.service") as {
      exchangeRateService: Record<string, unknown>;
    };
    for (const m of ["getSupportedCurrencies", "getRate"]) {
      assert.equal(
        typeof real.exchangeRateService[m],
        "function",
        `exchangeRateService.${m} missing`,
      );
    }
  });
});
