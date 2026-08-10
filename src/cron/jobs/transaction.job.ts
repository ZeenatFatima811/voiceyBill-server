/**
 * Recurring-transaction cron — ported to the Postgres repository layer.
 *
 * The mongoose cursor becomes a plain list. `findDueRecurring` hits the partial
 * index on `next_recurring_date WHERE is_recurring = true`, so the scan is over
 * the few recurring rows rather than the whole table — the same intent the
 * partial index carried under Mongo.
 */
import { transactions as transactionRepo, withTransaction } from "../../db/repositories";
import { calculateNextOccurrence } from "../../utils/helper";

export const processRecurringTransactions = async () => {
  const now = new Date();
  let processedCount = 0;
  let failedCount = 0;

  try {
    const due = await transactionRepo.findDueRecurring(now);

    console.log("Starting recurring proccess");

    for (const tx of due) {
      const nextDate = calculateNextOccurrence(
        tx.nextRecurringDate!,
        tx.recurringInterval as "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY",
      );

      try {
        /**
         * One transaction per row, as before: the generated occurrence and the
         * advance of the source row's schedule must commit together, or a
         * failure between them either duplicates the occurrence on the next run
         * or loses it entirely.
         */
        await withTransaction(async (dbTx) => {
          const {
            _id: _ignoredId,
            id: _ignoredVirtualId,
            createdAt: _ignoredCreatedAt,
            updatedAt: _ignoredUpdatedAt,
            ...copyable
          } = tx;

          // Amounts round-trip in DOLLARS — the repository converts both ways.
          await transactionRepo.create(
            {
              ...copyable,
              title: `Recurring - ${tx.title}`,
              date: tx.nextRecurringDate!,
              isRecurring: false,
              nextRecurringDate: null,
              recurringInterval: null,
              lastProcessed: null,
            },
            dbTx,
          );

          await transactionRepo.update(
            tx._id,
            { nextRecurringDate: nextDate, lastProcessed: now },
            undefined,
            dbTx,
          );
        });

        processedCount++;
      } catch (error: any) {
        failedCount++;
        console.log(`Failed reccurring tx: ${tx._id}`, error);
      }
    }

    console.log(`✅Processed: ${processedCount} transaction`);
    console.log(`❌ Failed: ${failedCount} transaction`);

    return {
      success: true,
      processedCount,
      failedCount,
    };
  } catch (error: any) {
    console.error("Error occur processing transaction", error);

    return {
      success: false,
      error: error?.message,
    };
  }
};
