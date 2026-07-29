/**
 * Test entry point.
 *
 * All specs run in one process so the application boots once. `node:test`
 * executes the registered tests when this file is run directly, and the process
 * exit code reflects failures — no external test runner is needed, which keeps
 * the dependency tree unchanged.
 */
import { after } from "node:test";

import { startApp } from "./support/app";

require("./smoke.spec");
require("./stub-fidelity.spec");
require("./routing.e2e-spec");
require("./auth.e2e-spec");
require("./error-contract.e2e-spec");
require("./middleware.e2e-spec");
require("./contracts.e2e-spec");
require("./serverless.e2e-spec");

after(async () => {
  const app = await startApp();
  await app.close();
});
