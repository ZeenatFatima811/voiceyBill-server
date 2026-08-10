/**
 * Integration checks for the mapper + repository layer.
 *
 * Requires a live Postgres — `docker compose up -d postgres` plus
 * `npm run db:migrate`. Kept OUT of `npm test` for that reason: the main suite
 * stubs the database entirely and must stay runnable without one.
 *
 *   npm run db:check
 *
 * These assert the things typechecking cannot: that the cents conversion
 * survives a real round trip, that `_id`/`id` match the mongoose shapes exactly,
 * that the OTP fields stay out of a default read, that a partial update does
 * not null the fields it omitted, and that a transaction actually rolls back.
 *
 * Every check runs against ids in a reserved prefix and cleans up after itself,
 * so it can be run repeatedly against a dev database.
 */
// MUST be first: sets TZ and the variables `Env` validates at import time.
import "./setup";

import assert from "assert";

import { closeDb, getDb } from "../../src/db/client";
import { newObjectId } from "../../src/db/object-id";
import {
  budgets,
  categories,
  currency,
  reports,
  transactions,
  users,
  withTransaction,
} from "../../src/db/repositories";

const failures: string[] = [];
let checks = 0;

const check = async (name: string, fn: () => Promise<void>): Promise<void> => {
  checks += 1;
  try {
    await fn();
    process.stdout.write(`  ok    ${name}\n`);
  } catch (error) {
    failures.push(name);
    process.stdout.write(`  FAIL  ${name}\n`);
    process.stdout.write(
      `        ${error instanceof Error ? error.message.split("\n")[0] : String(error)}\n`,
    );
  }
};

/** Ids created by this run, torn down at the end. */
const createdUsers: string[] = [];

const makeUser = async (overrides: Partial<{ email: string; baseCurrency: string }> = {}) => {
  const user = await users.create({
    name: "  Repo Check  ",
    email: overrides.email ?? `repo-check-${newObjectId()}@parity.test`,
    password: "Password123!",
    baseCurrency: overrides.baseCurrency ?? "usd",
  });
  createdUsers.push(user._id);
  return user;
};

const main = async (): Promise<void> => {
  process.stdout.write("db:check — mapper + repository integration\n\n");

  // -------------------------------------------------------------------------
  // Identifiers
  // -------------------------------------------------------------------------
  await check("primary keys are ObjectId-format and exposed as _id", async () => {
    const user = await makeUser();
    assert.match(user._id, /^[0-9a-f]{24}$/, "user._id is not ObjectId-shaped");
    assert.ok(!("id" in user), "user must NOT carry the `id` virtual");
  });

  await check("transactions expose BOTH _id and id, matching the schema", async () => {
    const user = await makeUser();
    const tx = await transactions.create({
      userId: user._id,
      title: "Shape check",
      type: "EXPENSE",
      amount: 10,
      category: "Food",
      date: new Date("2026-06-10T09:00:00.000Z"),
    });
    assert.strictEqual(tx._id, tx.id, "transaction _id and id must agree");
    assert.match(tx._id, /^[0-9a-f]{24}$/);
  });

  await check("categories expose _id only — no id virtual", async () => {
    const user = await makeUser();
    const category = await categories.create({ userId: user._id, name: "Travel" });
    assert.ok(!("id" in category), "category must NOT carry the `id` virtual");
  });

  // -------------------------------------------------------------------------
  // Money. The single most dangerous conversion in the migration.
  // -------------------------------------------------------------------------
  await check("transaction amount round-trips dollars through cents", async () => {
    const user = await makeUser();
    const tx = await transactions.create({
      userId: user._id,
      title: "Cents check",
      type: "EXPENSE",
      amount: 42.42,
      originalAmount: 250,
      originalCurrency: "eur",
      category: "Food",
      date: new Date("2026-06-10T09:00:00.000Z"),
    });

    assert.strictEqual(tx.amount, 42.42, "amount must read back in dollars");
    assert.strictEqual(tx.originalAmount, 250);
    assert.strictEqual(tx.originalCurrency, "EUR", "currency must be uppercased");

    // The raw column must hold integer cents.
    const [raw] = await getDb().execute(
      `select amount from transactions where id = '${tx._id}'`,
    );
    assert.strictEqual(Number((raw as { amount: unknown }).amount), 4242);
  });

  await check("budget converts categoryLimits[].limit, not just totalBudget", async () => {
    const user = await makeUser();
    const budget = await budgets.upsert({
      userId: user._id,
      month: 7,
      year: 2026,
      totalBudget: 2500.5,
      categoryLimits: [
        { category: "Food", limit: 500.25 },
        { category: "Housing", limit: 1200 },
      ],
    });

    assert.strictEqual(budget.totalBudget, 2500.5);
    assert.strictEqual(budget.categoryLimits[0].limit, 500.25, "nested limit must be dollars");
    assert.strictEqual(budget.categoryLimits[1].limit, 1200);

    const [raw] = await getDb().execute(
      `select total_budget, category_limits from budgets where id = '${budget._id}'`,
    );
    const row = raw as { total_budget: unknown; category_limits: unknown };
    assert.strictEqual(Number(row.total_budget), 250050);
    const limits = row.category_limits as { limit: number }[];
    assert.strictEqual(limits[0].limit, 50025, "nested limit must be stored as cents");
  });

  await check("null originalAmount stays null rather than becoming 0", async () => {
    const user = await makeUser();
    const tx = await transactions.create({
      userId: user._id,
      title: "No original",
      type: "EXPENSE",
      amount: 5,
      category: "Food",
      date: new Date("2026-06-10T09:00:00.000Z"),
    });
    assert.strictEqual(tx.originalAmount, null);
  });

  await check("zero amount survives as 0, not null", async () => {
    const user = await makeUser();
    const tx = await transactions.create({
      userId: user._id,
      title: "Refunded fee",
      type: "EXPENSE",
      amount: 0,
      category: "Fees",
      date: new Date("2026-06-10T09:00:00.000Z"),
    });
    assert.strictEqual(tx.amount, 0);
  });

  // -------------------------------------------------------------------------
  // The select:false projection.
  // -------------------------------------------------------------------------
  await check("default user read omits password, tokenVersion and OTP fields", async () => {
    const user = await makeUser();
    const read = await users.findById(user._id);
    assert.ok(read, "user should be found");

    for (const forbidden of [
      "password",
      "tokenVersion",
      "emailVerificationOtpHash",
      "emailVerificationOtpExpiresAt",
      "passwordResetOtpHash",
      "passwordResetOtpExpiresAt",
      "lastOtpResentAt",
    ]) {
      assert.ok(!(forbidden in read!), `${forbidden} leaked into a default read`);
    }
  });

  await check("withSecrets read exposes the hash, and it is real bcrypt", async () => {
    const user = await makeUser();
    const secret = await users.findByIdWithSecrets(user._id);
    assert.ok(secret?.password, "password hash should be present");
    assert.match(secret!.password!, /^\$2[aby]\$/, "password must be bcrypt-hashed");
    assert.notStrictEqual(secret!.password, "Password123!", "password stored in clear");
  });

  // -------------------------------------------------------------------------
  // Path normalisation.
  // -------------------------------------------------------------------------
  await check("email lowercased and trimmed, name trimmed, currency uppercased", async () => {
    const address = `  MiXeD-${newObjectId()}@Parity.TEST  `;
    const user = await users.create({
      name: "  Spaced Name  ",
      email: address,
      password: "Password123!",
      baseCurrency: " eur ",
    });
    createdUsers.push(user._id);

    assert.strictEqual(user.email, address.trim().toLowerCase());
    assert.strictEqual(user.name, "Spaced Name");
    assert.strictEqual(user.baseCurrency, "EUR");
  });

  await check("email lookup normalises the argument too", async () => {
    const address = `Lookup-${newObjectId()}@Parity.TEST`;
    const user = await users.create({
      name: "Lookup",
      email: address,
      password: "Password123!",
    });
    createdUsers.push(user._id);

    const found = await users.findByEmailWithSecrets(address.toUpperCase());
    assert.strictEqual(found?._id, user._id, "mixed-case lookup must find the row");
  });

  // -------------------------------------------------------------------------
  // Partial updates.
  // -------------------------------------------------------------------------
  await check("partial update leaves omitted fields untouched", async () => {
    const user = await makeUser();
    const before = await users.findById(user._id);

    await users.update(user._id, { name: "Renamed Only" });
    const after = await users.findById(user._id);

    assert.strictEqual(after?.name, "Renamed Only");
    assert.strictEqual(
      after?.baseCurrency,
      before?.baseCurrency,
      "baseCurrency must not be nulled by an update that omitted it",
    );
    assert.strictEqual(after?.email, before?.email, "email must survive");
  });

  await check("updating amount alone does not disturb other columns", async () => {
    const user = await makeUser();
    const tx = await transactions.create({
      userId: user._id,
      title: "Original title",
      type: "EXPENSE",
      amount: 10,
      category: "Food",
      date: new Date("2026-06-10T09:00:00.000Z"),
      paymentMethod: "CARD",
    });

    const updated = await transactions.update(tx._id, { amount: 99.99 });
    assert.strictEqual(updated?.amount, 99.99);
    assert.strictEqual(updated?.title, "Original title");
    assert.strictEqual(updated?.paymentMethod, "CARD");
  });

  // -------------------------------------------------------------------------
  // Ownership. A missing user filter is the worst class of regression.
  // -------------------------------------------------------------------------
  await check("cross-user read returns null rather than another user's row", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const tx = await transactions.create({
      userId: owner._id,
      title: "Private",
      type: "EXPENSE",
      amount: 1,
      category: "Food",
      date: new Date("2026-06-10T09:00:00.000Z"),
    });

    assert.strictEqual(await transactions.findById(tx._id, stranger._id), null);
    assert.ok(await transactions.findById(tx._id, owner._id));
  });

  await check("malformed id returns null instead of throwing or matching", async () => {
    assert.strictEqual(await transactions.findById("not-an-object-id"), null);
    assert.strictEqual(await users.findById("short"), null);
  });

  await check("unfiltered removeMany refuses to empty the table", async () => {
    const user = await makeUser();
    await transactions.create({
      userId: user._id,
      title: "Should survive",
      type: "EXPENSE",
      amount: 1,
      category: "Food",
      date: new Date("2026-06-10T09:00:00.000Z"),
    });

    const deleted = await transactions.removeMany({});
    assert.strictEqual(deleted, 0, "an unfiltered delete must be refused");
    assert.strictEqual((await transactions.list({ userId: user._id })).length, 1);
  });

  // -------------------------------------------------------------------------
  // Search translation.
  // -------------------------------------------------------------------------
  await check("keyword search is case-insensitive across title and category", async () => {
    const user = await makeUser();
    await transactions.create({
      userId: user._id,
      title: "Groceries run",
      type: "EXPENSE",
      amount: 1,
      category: "Food",
      date: new Date("2026-06-10T09:00:00.000Z"),
    });

    assert.strictEqual((await transactions.list({ userId: user._id, keyword: "GRO" })).length, 1);
    assert.strictEqual((await transactions.list({ userId: user._id, keyword: "foo" })).length, 1);
  });

  await check("keyword metacharacters are literals, not wildcards", async () => {
    const user = await makeUser();
    await transactions.create({
      userId: user._id,
      title: "Plain title",
      type: "EXPENSE",
      amount: 1,
      category: "Food",
      date: new Date("2026-06-10T09:00:00.000Z"),
    });

    // `%` and `_` are ILIKE wildcards; unescaped, each of these matches everything.
    assert.strictEqual((await transactions.list({ userId: user._id, keyword: "%" })).length, 0);
    assert.strictEqual((await transactions.list({ userId: user._id, keyword: "_" })).length, 0);
    assert.strictEqual((await transactions.list({ userId: user._id, keyword: ".*" })).length, 0);
  });

  await check("category rename matches whole names only, per user", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();

    for (const [userId, category, title] of [
      [owner._id, "Food", "a"],
      [owner._id, "food", "b"],
      [owner._id, "Fast Food", "c"],
      [stranger._id, "Food", "d"],
    ] as const) {
      await transactions.create({
        userId,
        title,
        type: "EXPENSE",
        amount: 1,
        category,
        date: new Date("2026-06-10T09:00:00.000Z"),
      });
    }

    const moved = await transactions.renameCategory(owner._id, "Food", "Groceries");
    assert.strictEqual(moved, 2, "both Food and food must move, but not Fast Food");

    const strangerRows = await transactions.list({ userId: stranger._id });
    assert.strictEqual(strangerRows[0].category, "Food", "other user must be untouched");
  });

  // -------------------------------------------------------------------------
  // Transactions.
  // -------------------------------------------------------------------------
  await check("withTransaction rolls back every write on throw", async () => {
    const user = await makeUser();
    const before = (await transactions.list({ userId: user._id })).length;

    await assert.rejects(
      withTransaction(async (tx) => {
        await transactions.create(
          {
            userId: user._id,
            title: "Rolled back",
            type: "EXPENSE",
            amount: 1,
            category: "Food",
            date: new Date("2026-06-10T09:00:00.000Z"),
          },
          tx,
        );
        throw new Error("deliberate failure");
      }),
    );

    const after = (await transactions.list({ userId: user._id })).length;
    assert.strictEqual(after, before, "the insert should have been rolled back");
  });

  await check("withTransaction commits when the callback returns", async () => {
    const user = await makeUser();
    await withTransaction(async (tx) => {
      await transactions.create(
        {
          userId: user._id,
          title: "Committed",
          type: "EXPENSE",
          amount: 1,
          category: "Food",
          date: new Date("2026-06-10T09:00:00.000Z"),
        },
        tx,
      );
    });
    assert.strictEqual((await transactions.list({ userId: user._id })).length, 1);
  });

  await check("tokenVersion increments atomically in SQL", async () => {
    const user = await makeUser();
    const first = await users.bumpTokenVersion(user._id);
    const second = await users.bumpTokenVersion(user._id);
    assert.strictEqual(first, 1);
    assert.strictEqual(second, 2);
  });

  // -------------------------------------------------------------------------
  // Cascade.
  // -------------------------------------------------------------------------
  await check("deleting a user cascades to its children", async () => {
    const user = await makeUser();
    await transactions.create({
      userId: user._id,
      title: "Doomed",
      type: "EXPENSE",
      amount: 1,
      category: "Food",
      date: new Date("2026-06-10T09:00:00.000Z"),
    });
    await budgets.upsert({ userId: user._id, month: 6, year: 2026, totalBudget: 100 });
    await categories.create({ userId: user._id, name: "Doomed category" });

    await users.remove(user._id);

    assert.strictEqual((await transactions.list({ userId: user._id })).length, 0);
    assert.strictEqual((await budgets.listByUser(user._id)).length, 0);
    assert.strictEqual((await categories.listByUser(user._id)).length, 0);
  });

  await check("budget upsert replaces rather than duplicating a month", async () => {
    const user = await makeUser();
    await budgets.upsert({ userId: user._id, month: 6, year: 2026, totalBudget: 100 });
    const second = await budgets.upsert({
      userId: user._id,
      month: 6,
      year: 2026,
      totalBudget: 250,
    });

    const all = await budgets.listByUser(user._id);
    assert.strictEqual(all.length, 1, "the month must hold exactly one budget");
    assert.strictEqual(all[0].totalBudget, 250);
    assert.strictEqual(all[0]._id, second._id);
  });

  await check("duplicate category name is rejected case-insensitively", async () => {
    const user = await makeUser();
    await categories.create({ userId: user._id, name: "Food" });
    const clash = await categories.findByName(user._id, "fOOd");
    assert.ok(clash, "a case-different name must be detected as a duplicate");
  });

  // -------------------------------------------------------------------------
  // Currency cache
  //
  // These cover the two rewrites the parity suite could not: its currency-cron
  // case called a function that does not exist, so the snapshot recorded a
  // TypeError and passed forever without executing either path. Asserted here
  // instead of there, because a real assertion against a real Postgres cannot be
  // satisfied by a thrown error the way a snapshot can.
  // -------------------------------------------------------------------------
  await check("multi-row rate upsert applies each row's own values", async () => {
    const pairs = [
      { fromCurrency: "USD", toCurrency: "ZWL", rate: 1.5, rateDate: "2026-06-01" },
      { fromCurrency: "USD", toCurrency: "ZMW", rate: 2.5, rateDate: "2026-06-01" },
      { fromCurrency: "USD", toCurrency: "ZAR", rate: 3.5, rateDate: "2026-06-01" },
    ];

    await currency.upsertRates(pairs.map((p) => ({ ...p, fetchedAt: new Date() })));

    // Re-run with new rates. The ON CONFLICT branch must use `excluded.*`, i.e.
    // each conflicting row's OWN proposed value. Referencing the mapped input
    // variable instead would apply the LAST row's rate to all three — which
    // still "works" for a single-row upsert and is why this needs three rows.
    await currency.upsertRates(
      pairs.map((p) => ({ ...p, rate: p.rate + 10, fetchedAt: new Date() })),
    );

    for (const pair of pairs) {
      const stored = await currency.findRate(pair.fromCurrency, pair.toCurrency);
      assert.ok(stored, `${pair.toCurrency} must be cached`);
      assert.strictEqual(
        stored.rate,
        pair.rate + 10,
        `${pair.toCurrency} took another row's rate — check the excluded.* set clause`,
      );
    }

    const all = await currency.listRates();
    for (const pair of pairs) {
      const matching = all.filter((r) => r.toCurrency === pair.toCurrency);
      assert.strictEqual(matching.length, 1, "the unique pair index must collapse duplicates");
    }
  });

  await check("replaceSupported swaps the list atomically and rolls back", async () => {
    await currency.replaceSupported([
      { code: "AAA", name: "Test Alpha" },
      { code: "BBB", name: "Test Beta" },
    ]);

    const before = await currency.listSupported();
    assert.ok(
      before.some((c) => c.code === "AAA") && before.some((c) => c.code === "BBB"),
      "both codes must be present after a replace",
    );

    // A failure anywhere after the DELETE must leave the previous list intact.
    // Without a transaction the DELETE autocommits and the cache is emptied —
    // exactly the window `replaceSupported`'s doc comment claims to close, which
    // only holds if the caller threads an executor in.
    await assert.rejects(
      withTransaction(async (tx) => {
        await currency.replaceSupported([{ code: "CCC", name: "Test Gamma" }], tx);
        throw new Error("forced rollback");
      }),
    );

    const after = await currency.listSupported();
    assert.ok(
      after.some((c) => c.code === "AAA") && after.some((c) => c.code === "BBB"),
      "a rolled-back replace must not have emptied the cache",
    );
    assert.ok(
      !after.some((c) => c.code === "CCC"),
      "a rolled-back replace must not have inserted its rows",
    );

    await currency.replaceSupported([]);
  });

  // -------------------------------------------------------------------------
  // Report settings
  //
  // `user_id` is deliberately non-unique, matching mongoose, so a by-user UPDATE
  // is not equivalent to the `updateOne({ _id })` it replaced.
  // -------------------------------------------------------------------------
  await check("a user can hold only ONE report setting", async () => {
    const user = await makeUser();

    const first = await reports.createSetting({ userId: user._id, isEnabled: false });
    const second = await reports.createSetting({ userId: user._id, isEnabled: true });

    // Second call must return the row that already exists rather than inserting
    // a duplicate or throwing a unique violation.
    assert.strictEqual(
      second._id,
      first._id,
      "createSetting inserted a second row for the same user",
    );
    // DO NOTHING, so the existing row keeps its values.
    assert.strictEqual(second.isEnabled, false, "the existing row must win, unmodified");
  });

  await check("concurrent createSetting resolves to one row, both callers served", async () => {
    const user = await makeUser();

    // The read-then-insert guard in `createDefaultReportSetting` cannot stop this
    // under READ COMMITTED — the unique index plus ON CONFLICT is what does.
    const settled = await Promise.all([
      reports.createSetting({ userId: user._id, isEnabled: true }),
      reports.createSetting({ userId: user._id, isEnabled: true }),
      reports.createSetting({ userId: user._id, isEnabled: true }),
    ]);

    const ids = new Set(settled.map((setting) => setting._id));
    assert.strictEqual(ids.size, 1, "concurrent creates produced more than one row");
    assert.ok(
      settled.every((setting) => setting && setting._id),
      "a losing caller must receive the winning row, not an error",
    );
  });

  await check("a setting update touches ONE row, not every row for the user", async () => {
    const user = await makeUser();
    const only = await reports.createSetting({ userId: user._id, isEnabled: false });

    const updated = await reports.updateSetting(user._id, { isEnabled: true });

    assert.strictEqual(updated?._id, only._id, "the update hit a different row");
    assert.strictEqual(updated?.isEnabled, true);
  });

  // -------------------------------------------------------------------------
  // Teardown.
  // -------------------------------------------------------------------------
  for (const id of createdUsers) {
    await users.remove(id).catch(() => undefined);
  }

  process.stdout.write(
    `\n${checks - failures.length}/${checks} checks passed${
      failures.length ? `, failed: ${failures.join(", ")}` : ""
    }\n`,
  );

  await closeDb();
  process.exit(failures.length ? 1 : 0);
};

main().catch(async (error) => {
  process.stdout.write(
    `\ndb:check failed to run:\n${error instanceof Error ? error.stack : String(error)}\n`,
  );
  await closeDb().catch(() => undefined);
  process.exit(1);
});
