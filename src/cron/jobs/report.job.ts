/**
 * Monthly report cron — ported to the Postgres repository layer.
 *
 * The `.populate("userId")` join becomes an explicit read per due setting.
 * There is no populate equivalent, and a real join would change what happens
 * when the user row is missing: `populate` yielded null and the loop skipped
 * that setting, which is behaviour the `continue` below preserves.
 */
import { endOfMonth, format, startOfMonth, subMonths } from "date-fns";

import { reports as reportRepo, users as userRepo, withTransaction } from "../../db/repositories";
import { ReportStatusEnum } from "../../enums/domain.enum";
import { sendReportEmail } from "../../mailers/report.mailer";
import { generateReportService } from "../../services/report.service";
import { calculateNextReportDate } from "../../utils/helper";

export const processReportJob = async () => {
  const now = new Date();

  let processedCount = 0;
  let failedCount = 0;

  //Today july 1, then run report for -> june 1 - 30
  //Get Last Month because this will run on the first of the month
  const from = startOfMonth(subMonths(now, 1));
  const to = endOfMonth(subMonths(now, 1));

  try {
    // Hits the partial index on `next_report_date WHERE is_enabled = true`.
    const dueSettings = await reportRepo.findDueSettings(now);

    console.log("Running report ");

    for (const setting of dueSettings) {
      const user = await userRepo.findById(setting.userId);
      if (!user) {
        console.log(`User not found for setting: ${setting._id}`);
        continue;
      }

      try {
        /**
         * One transaction per user, as before — a failure for one account must
         * not abandon the rest of the run.
         *
         * The email is sent INSIDE it, exactly as the Mongo version did, because
         * whether it succeeded decides which rows get written (SENT vs FAILED).
         * Splitting it out would change that outcome.
         */
        await withTransaction(async (tx) => {
          const report = await generateReportService(
            user._id,
            from,
            to,
            user.baseCurrency || "USD",
            tx,
          );

          let emailSent = false;
          if (report) {
            try {
              await sendReportEmail({
                email: user.email,
                username: user.name,
                report: {
                  period: report.period,
                  baseCurrency: report.baseCurrency,
                  totalIncome: report.summary.income,
                  totalExpenses: report.summary.expenses,
                  availableBalance: report.summary.balance,
                  savingsRate: report.summary.savingsRate,
                  topSpendingCategories: report.summary.topCategories,
                  insights: report.insights,
                  currencySummary: report.currencySummary,
                },
                frequency: setting.frequency,
              });
              emailSent = true;
            } catch (error) {
              console.log(`Email failed for ${user._id}`);
            }
          }

          if (report && emailSent) {
            await reportRepo.create(
              {
                userId: user._id,
                sentDate: now,
                period: report.period,
                startDate: from,
                endDate: to,
                status: ReportStatusEnum.SENT,
                createdAt: now,
                updatedAt: now,
              },
              tx,
            );

            // By setting id, not by user: `updateOne({ _id: setting._id })` is
            // what this replaces, and `report_settings.user_id` is not unique.
            await reportRepo.updateSettingById(
              setting._id,
              {
                lastSentDate: now,
                nextReportDate: calculateNextReportDate(now),
                updatedAt: now,
              },
              tx,
            );
          } else {
            await reportRepo.create(
              {
                userId: user._id,
                sentDate: now,
                period:
                  report?.period ||
                  `${format(from, "MMMM d")}–${format(to, "d, yyyy")}`,
                startDate: from,
                endDate: to,
                status: report ? ReportStatusEnum.FAILED : ReportStatusEnum.NO_ACTIVITY,
                createdAt: now,
                updatedAt: now,
              },
              tx,
            );

            await reportRepo.updateSettingById(
              setting._id,
              {
                lastSentDate: null,
                nextReportDate: calculateNextReportDate(now),
                updatedAt: now,
              },
              tx,
            );
          }
        });

        processedCount++;
      } catch (error) {
        console.log(`Failed to process report`, error);
        failedCount++;
      }
    }

    console.log(`✅Processed: ${processedCount} report`);
    console.log(`❌ Failed: ${failedCount} report`);

    return {
      success: true,
      processedCount,
      failedCount,
    };
  } catch (error) {
    console.error("Error processing reports", error);
    return {
      success: false,
      error: "Report process failed",
    };
  }
};
