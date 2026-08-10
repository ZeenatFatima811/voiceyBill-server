/**
 * Analytics service — ported from mongoose to the Postgres repository layer.
 *
 * The three `$facet`/`$group` pipelines are now SQL aggregates in the
 * transaction repository. Everything the pipelines computed with `$project`
 * expressions — savings percentage, expense ratio, the top-three/others split,
 * percentage change against the previous period — is done here in TypeScript,
 * because it is arithmetic over a handful of numbers rather than work the
 * database should be doing.
 *
 * Amounts arrive in CENTS from the repository, exactly as the pipelines emitted
 * them, and `convertToDollarUnit` is applied at the same points as before.
 */
import { differenceInDays, subDays, subYears } from "date-fns";

import { transactions as transactionRepo } from "../db/repositories";
import { DateRangeEnum, type DateRangePreset } from "../enums/date-range.enum";
import { getDateRange } from "../utils/date";
import { convertToDollarUnit } from "../utils/format-currency";

export const summaryAnalyticsService = async (
  userId: string,
  dateRangePreset?: DateRangePreset,
  customFrom?: Date,
  customTo?: Date,
) => {
  const range = getDateRange(dateRangePreset, customFrom, customTo);

  const { from, to, value: rangeValue } = range;

  // PERF: the previous-period query depends only on the requested range (not on
  // the current-period result), so both run concurrently.
  const needsPrevious = !!(from && to && rangeValue !== DateRangeEnum.ALL_TIME);

  let prevPeriodFrom: Date | null = null;
  let prevPeriodTo: Date | null = null;

  if (needsPrevious && from && to) {
    const period = differenceInDays(to, from) + 1;
    const isYearly = [DateRangeEnum.LAST_YEAR, DateRangeEnum.THIS_YEAR].includes(
      rangeValue as DateRangeEnum,
    );

    prevPeriodFrom = isYearly ? subYears(from, 1) : subDays(from, period);
    prevPeriodTo = isYearly ? subYears(to, 1) : subDays(to, period);
  }

  const [current, previous] = await Promise.all([
    transactionRepo.summaryAggregate(userId, from, to),
    prevPeriodFrom && prevPeriodTo
      ? transactionRepo.summaryAggregate(userId, prevPeriodFrom, prevPeriodTo)
      : Promise.resolve(null),
  ]);

  const totalIncome = current?.totalIncome ?? 0;
  const totalExpenses = current?.totalExpenses ?? 0;
  const transactionCount = current?.transactionCount ?? 0;
  const availableBalance = current ? totalIncome - totalExpenses : 0;

  /**
   * The `$let` block from the original `$project`, verbatim in arithmetic:
   * both ratios are defined as 0 when income is not positive, which is what
   * kept a user with only expenses from producing -Infinity.
   */
  const savingData = current
    ? {
        savingsPercentage:
          totalIncome <= 0 ? 0 : ((totalIncome - totalExpenses) / totalIncome) * 100,
        expenseRatio: totalIncome <= 0 ? 0 : (totalExpenses / totalIncome) * 100,
      }
    : { savingsPercentage: 0, expenseRatio: 0 };

  let percentageChange: any = {
    income: 0,
    expenses: 0,
    balance: 0,
    prevPeriodFrom: null,
    prevPeriodTo: null,
    previousValues: {
      incomeAmount: 0,
      expenseAmount: 0,
      balanceAmount: 0,
    },
  };

  if (needsPrevious && previous) {
    const prevIncome = previous.totalIncome || 0;
    const prevExpenses = previous.totalExpenses || 0;
    const prevBalance = prevIncome - prevExpenses;

    percentageChange = {
      income: calaulatePercentageChange(prevIncome, totalIncome),
      expenses: calaulatePercentageChange(prevExpenses, totalExpenses),
      balance: calaulatePercentageChange(prevBalance, availableBalance),
      prevPeriodFrom,
      prevPeriodTo,
      previousValues: {
        incomeAmount: prevIncome,
        expenseAmount: prevExpenses,
        balanceAmount: prevBalance,
      },
    };
  }

  return {
    availableBalance: convertToDollarUnit(availableBalance),
    totalIncome: convertToDollarUnit(totalIncome),
    totalExpenses: convertToDollarUnit(totalExpenses),
    savingRate: {
      percentage: parseFloat(savingData.savingsPercentage.toFixed(2)),
      expenseRatio: parseFloat(savingData.expenseRatio.toFixed(2)),
    },
    transactionCount,
    percentageChange: {
      ...percentageChange,
      previousValues: {
        incomeAmount: convertToDollarUnit(percentageChange.previousValues.incomeAmount),
        expenseAmount: convertToDollarUnit(percentageChange.previousValues.expenseAmount),
        balanceAmount: convertToDollarUnit(percentageChange.previousValues.balanceAmount),
      },
    },
    preset: {
      ...range,
      value: rangeValue || DateRangeEnum.ALL_TIME,
      label: range?.label || "All Time",
    },
  };
};

export const chartAnalyticsService = async (
  userId: string,
  dateRangePreset?: DateRangePreset,
  customFrom?: Date,
  customTo?: Date,
) => {
  const range = getDateRange(dateRangePreset, customFrom, customTo);
  const { from, to, value: rangeValue } = range;

  const points = await transactionRepo.chartAggregate(userId, from, to);

  const transaformedData = points.map((item) => ({
    date: item.date,
    income: convertToDollarUnit(item.income),
    expenses: convertToDollarUnit(item.expenses),
  }));

  /**
   * `undefined`, not 0, when nothing matched.
   *
   * The final `$group: { _id: null }` emitted no document for an empty range,
   * so `resultData` was `{}` and both counts came back undefined. The clients
   * receive that as a missing key; defaulting to 0 here would change the
   * payload.
   */
  const totals = points.length
    ? points.reduce(
        (acc, item) => ({
          totalIncomeCount: acc.totalIncomeCount + item.incomeCount,
          totalExpenseCount: acc.totalExpenseCount + item.expenseCount,
        }),
        { totalIncomeCount: 0, totalExpenseCount: 0 },
      )
    : { totalIncomeCount: undefined, totalExpenseCount: undefined };

  return {
    chartData: transaformedData,
    totalIncomeCount: totals.totalIncomeCount,
    totalExpenseCount: totals.totalExpenseCount,
    preset: {
      ...range,
      value: rangeValue || DateRangeEnum.ALL_TIME,
      label: range?.label || "All Time",
    },
  };
};

export const expensePieChartBreakdownService = async (
  userId: string,
  dateRangePreset?: DateRangePreset,
  customFrom?: Date,
  customTo?: Date,
) => {
  const range = getDateRange(dateRangePreset, customFrom, customTo);
  const { from, to, value: rangeValue } = range;

  const categories = await transactionRepo.expenseByCategory(userId, from, to);

  /**
   * The `$facet` top-three / "others" split, in JS.
   *
   * The "others" row appears ONLY when there are more than three categories.
   * In the pipeline that branch was `[{ $skip: 3 }, { $group: … }]`, and a
   * `$group` over zero documents emits no document at all — so three or fewer
   * categories produced no "others" entry, and zero categories produced an
   * empty breakdown rather than a single zero row. Appending it
   * unconditionally is the obvious mistake here, and
   * `analytics.pie.zero-total` is the case that catches it.
   */
  const topThree = categories.slice(0, 3);
  const rest = categories.slice(3);
  const breakdownSource = [
    ...topThree,
    ...(rest.length
      ? [{ name: "others", value: rest.reduce((sum, entry) => sum + entry.value, 0) }]
      : []),
  ];

  const totalSpent = breakdownSource.reduce((sum, entry) => sum + entry.value, 0);

  const breakdown = breakdownSource.map((entry) => ({
    name: entry.name,
    value: entry.value,
    // `$round` to 2dp, and 0 when there is nothing to divide by.
    percentage:
      totalSpent === 0 ? 0 : Math.round((entry.value / totalSpent) * 100 * 100) / 100,
  }));

  const transformedData = {
    totalSpent: convertToDollarUnit(totalSpent),
    breakdown: breakdown.map((item: any) => ({
      ...item,
      name: item.name
        ? item.name
            .split(" ")
            .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
            .join(" ")
        : "",
      value: convertToDollarUnit(item.value),
    })),
  };

  return {
    ...transformedData,
    preset: {
      ...range,
      value: rangeValue || DateRangeEnum.ALL_TIME,
      label: range?.label || "All Time",
    },
  };
};

function calaulatePercentageChange(previous: number, current: number) {
  if (previous === 0) return current === 0 ? 0 : 100;
  const changes = ((current - previous) / Math.abs(previous)) * 100;
  const cappedChange = Math.min(Math.max(changes, -100), 100);
  return parseFloat(cappedChange.toFixed(2));
}
