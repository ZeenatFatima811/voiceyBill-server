import { format } from "date-fns";

import { openai, openAIModel } from "../config/openai.config";
import {
  reports as reportRepo,
  transactions as transactionRepo,
  users as userRepo,
  type Executor,
} from "../db/repositories";
import { toReportEmailDTO } from "../dto/report.dto";
import { ReportFrequencyEnum, ReportStatusEnum } from "../enums/domain.enum";
import { sendReportEmail } from "../mailers/report.mailer";
import { NotFoundException } from "../utils/app-error";
import { convertToDollarUnit } from "../utils/format-currency";
import { calculateNextReportDate } from "../utils/helper";
import { reportInsightPrompt } from "../utils/prompt";
import type { UpdateReportSettingType } from "../validators/report.validator";

export const getAllReportsService = async (
  userId: string,
  pagination: {
    pageSize: number;
    pageNumber: number;
  },
) => {
  const { pageSize, pageNumber } = pagination;
  const skip = (pageNumber - 1) * pageSize;

  const [reports, totalCount] = await Promise.all([
    reportRepo.listByUser(userId, { skip, limit: pageSize }),
    reportRepo.countByUser(userId),
  ]);

  const totalPages = Math.ceil(totalCount / pageSize);

  return {
    reports,
    pagination: {
      pageSize,
      pageNumber,
      totalCount,
      totalPages,
      skip,
    },
  };
};

export const updateReportSettingService = async (
  userId: string,
  body: UpdateReportSettingType,
) => {
  const { isEnabled } = body;
  let nextReportDate: Date | null = null;

  const existingReportSetting = await reportRepo.findSettingByUser(userId);
  if (!existingReportSetting)
    throw new NotFoundException("Report setting not found");

  //   const frequency =
  //     existingReportSetting.frequency || ReportFrequencyEnum.MONTHLY;

  if (isEnabled) {
    const currentNextReportDate = existingReportSetting.nextReportDate;
    const now = new Date();
    if (!currentNextReportDate || currentNextReportDate <= now) {
      // `lastSentDate` is `Date | null` here where mongoose typed it optional.
      // `calculateNextReportDate` treats a missing value as "no previous send",
      // so null and undefined mean the same thing to it.
      nextReportDate = calculateNextReportDate(
        existingReportSetting.lastSentDate ?? undefined,
      );
    } else {
      nextReportDate = currentNextReportDate;
    }
  }

  await reportRepo.updateSetting(userId, {
    ...body,
    nextReportDate,
  });
};

export const generateReportService = async (
  userId: string,
  fromDate: Date,
  toDate: Date,
  baseCurrency: string = "USD",
  exec?: Executor,
) => {
  /**
   * The `$facet` pipeline is now one CTE query in the repository — see
   * `reportAggregate`. Totals come back in CENTS, exactly as the pipeline
   * produced them, and are converted below.
   */
  const aggregate = await transactionRepo.reportAggregate(
    userId,
    fromDate,
    toDate,
    exec,
  );

  const results = [
    {
      totalIncome: aggregate.totalIncome,
      totalExpenses: aggregate.totalExpenses,
      categories: aggregate.categories,
      currencySummary: aggregate.currencySummary,
    },
  ];

  if (
    !results?.length ||
    (results[0]?.totalIncome === 0 && results[0]?.totalExpenses === 0)
  )
    return null;

  const {
    totalIncome = 0,
    totalExpenses = 0,
    categories = [],
    currencySummary = [],
  } = results[0] || {};

  const byCategory = categories.reduce(
    (acc: any, { _id, total }: any) => {
      const name = _id ? _id.split(" ").map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ") : "";
      acc[name] = {
        amount: convertToDollarUnit(total),
        percentage:
          totalExpenses > 0 ? Number(((total / totalExpenses) * 100).toFixed(1)) : 0,
      };
      return acc;
    },
    {} as Record<string, { amount: number; percentage: number }>,
  );

  const availableBalance = totalIncome - totalExpenses;
  const savingsRate = calculateSavingRate(totalIncome, totalExpenses);

  const periodLabel = `${format(fromDate, "MMMM d")} - ${format(toDate, "d, yyyy")}`;

  const insights = await generateInsightsAI({
    totalIncome,
    totalExpenses,
    availableBalance,
    savingsRate,
    categories: byCategory,
    periodLabel,
    baseCurrency,
  });

  const formattedCurrencySummary = currencySummary
    .filter((cs: any) => cs._id !== null)
    .map((cs: any) => ({
      currency: cs._id,
      transactionCount: cs.count,
    }));

  await reportRepo.upsertForPeriod(
    {
      userId,
      period: periodLabel,
      sentDate: new Date(),
      startDate: fromDate,
      endDate: toDate,
      status: ReportStatusEnum.SENT,
      baseCurrency,
      currencySummary: formattedCurrencySummary,
    },
    exec,
  );

  return {
    period: periodLabel,
    startDate: fromDate,
    endDate: toDate,
    baseCurrency,
    summary: {
      income: convertToDollarUnit(totalIncome),
      expenses: convertToDollarUnit(totalExpenses),
      balance: convertToDollarUnit(availableBalance),
      savingsRate: Number(savingsRate.toFixed(1)),
      topCategories: Object.entries(byCategory)?.map(([name, cat]: any) => ({
        name,
        amount: cat.amount,
        percent: cat.percentage,
      })),
    },
    insights,
    currencySummary:
      formattedCurrencySummary.length > 0 ? formattedCurrencySummary : undefined,
  };
};

async function generateInsightsAI({
  totalIncome,
  totalExpenses,
  availableBalance,
  savingsRate,
  categories,
  periodLabel,
  baseCurrency,
}: {
  totalIncome: number;
  totalExpenses: number;
  availableBalance: number;
  savingsRate: number;
  categories: Record<string, { amount: number; percentage: number }>;
  periodLabel: string;
  baseCurrency: string;
}) {
  try {
    const prompt = reportInsightPrompt({
      totalIncome: convertToDollarUnit(totalIncome),
      totalExpenses: convertToDollarUnit(totalExpenses),
      availableBalance: convertToDollarUnit(availableBalance),
      savingsRate: Number(savingsRate.toFixed(1)),
      categories,
      periodLabel,
      baseCurrency,
    });

    const result = await openai.chat.completions.create({
      model: openAIModel,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 300,
    });

    const content = result.choices[0]?.message?.content;
    if (!content) return [];

    const cleanedText = content.replace(/```(?:json)?\n?/g, "").trim();
    const data = JSON.parse(cleanedText);
    return data;
  } catch (error) {
    return [];
  }
}

function calculateSavingRate(totalIncome: number, totalExpenses: number) {
  if (totalIncome <= 0) return 0;
  const savingRate = ((totalIncome - totalExpenses) / totalIncome) * 100;
  return parseFloat(savingRate.toFixed(2));
}

export const resendReportService = async (userId: string, reportId: string) => {
  const savedReport = await reportRepo.findById(reportId, userId);
  if (!savedReport) throw new NotFoundException("Report not found");

  const user = await userRepo.findById(userId);
  if (!user) throw new NotFoundException("User not found");

  const generatedReport = await generateReportService(
    userId, 
    savedReport.startDate,
    savedReport.endDate,
    user.baseCurrency || "USD",
  );


  if (!generatedReport) {
    throw new NotFoundException("No report data available for this period");
  }
 
  return sendReportEmail({
    email: user.email,
    username: user.name,
    report: toReportEmailDTO(
      generatedReport.summary,
      generatedReport.period,
      generatedReport.baseCurrency,
      generatedReport.currencySummary,
    ),
    frequency:ReportFrequencyEnum.MONTHLY,
  });
};

