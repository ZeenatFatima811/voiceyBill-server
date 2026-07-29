import assert from "node:assert/strict";
import { test } from "node:test";

import { request } from "./support/app";

test("smoke: the real app boots and the root route answers", async () => {
  const res = await request("GET", "/");
  assert.equal(res.status, 200);
  assert.equal(res.json.message, "VoiceyBill API is running successfully!");
});
