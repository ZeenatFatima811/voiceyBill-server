/**
 * Development seed — ported to the Postgres repository layer.
 *
 *   npm run seed          create or refresh the seed account and its data
 *   npm run seed:wipe     delete the seed account first
 *
 * `--wipe` now removes only the SEED ACCOUNT, not every user and transaction in
 * the database. The mongoose version issued `deleteMany({})` against both
 * collections, so running it against a database holding real data destroyed all
 * of it. Deleting the seed user is enough: the foreign keys cascade to its
 * transactions, categories, budgets and reports.
 */
import "dotenv/config";

import { closeDb } from "../db/client";
import { transactions as transactionRepo, users as userRepo } from "../db/repositories";
import { PaymentMethodEnum, RecurringIntervalEnum } from "../enums/domain.enum";

const shouldWipe = process.argv.includes("--wipe") || process.argv.includes("--reset");

const SEED_EMAIL = "seed@example.com";
const SEED_NAME = "Seed User";
const SEED_PASSWORD = "Password123!";

async function seed() {
  try {
    console.log("Seeding database...");

    const existing = await userRepo.findByEmailWithSecrets(SEED_EMAIL);

    if (shouldWipe && existing) {
      console.log("Removing the existing seed account (cascades to its data)...");
      await userRepo.remove(existing._id);
    }

    let user = shouldWipe ? null : existing;

    if (!user) {
      user = await userRepo.create({
        name: SEED_NAME,
        email: SEED_EMAIL,
        password: SEED_PASSWORD,
        isVerified: true,
      });
    } else {
      await userRepo.update(user._id, { name: SEED_NAME, isVerified: true });
      await userRepo.setPassword(user._id, SEED_PASSWORD);
    }

    // Amounts are DOLLARS here, as every service caller passes them; the
    // repository converts to the cents actually stored.
    const samples = [
      {
        title: "Salary",
        type: "INCOME",
        amount: 2500.5,
        category: "Salary",
        isRecurring: true,
        recurringInterval: RecurringIntervalEnum.MONTHLY,
        paymentMethod: PaymentMethodEnum.BANK_TRANSFER,
      },
      {
        title: "Groceries",
        type: "EXPENSE",
        amount: 120.75,
        category: "Food",
        isRecurring: false,
        paymentMethod: PaymentMethodEnum.CARD,
      },
    ];

    for (const sample of samples) {
      // Upsert by title, matching the original's `updateOne(..., { upsert: true })`,
      // so re-running the seed does not accumulate duplicates.
      const [found] = await transactionRepo.list({
        userId: user._id,
        keyword: sample.title,
      });

      if (found && found.title === sample.title) {
        await transactionRepo.update(found._id, sample, user._id);
      } else {
        await transactionRepo.create({ ...sample, userId: user._id, date: new Date() });
      }
    }

    console.log("Seeding completed.");
    await closeDb();
    process.exit(0);
  } catch (err) {
    console.error("Seeding failed:", err);
    await closeDb().catch(() => {});
    process.exit(1);
  }
}

seed();
