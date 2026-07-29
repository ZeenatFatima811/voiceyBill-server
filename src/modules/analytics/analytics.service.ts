import { Injectable } from "@nestjs/common";

import { type DateRangePreset } from "../../enums/date-range.enum";
import {
  chartAnalyticsService,
  expensePieChartBreakdownService,
  summaryAnalyticsService,
} from "../../services/analytics.service";

@Injectable()
export class AnalyticsService {
  summary(userId: string, preset?: DateRangePreset, from?: Date, to?: Date) {
    return summaryAnalyticsService(userId, preset, from, to);
  }

  chart(userId: string, preset?: DateRangePreset, from?: Date, to?: Date) {
    return chartAnalyticsService(userId, preset, from, to);
  }

  expenseBreakdown(
    userId: string,
    preset?: DateRangePreset,
    from?: Date,
    to?: Date,
  ) {
    return expensePieChartBreakdownService(userId, preset, from, to);
  }

  /**
   * Combined dashboard payload: summary + chart + expense breakdown in one
   * request. The mobile dashboard previously made three separate calls (three
   * serverless invocations, three cold-start exposures); here the three
   * aggregations run concurrently on one warm connection. The individual
   * endpoints remain unchanged for existing clients.
   */
  async dashboard(
    userId: string,
    preset?: DateRangePreset,
    from?: Date,
    to?: Date,
  ) {
    const [summary, chart, expenseBreakdown] = await Promise.all([
      summaryAnalyticsService(userId, preset, from, to),
      chartAnalyticsService(userId, preset, from, to),
      expensePieChartBreakdownService(userId, preset, from, to),
    ]);

    return { summary, chart, expenseBreakdown };
  }
}
