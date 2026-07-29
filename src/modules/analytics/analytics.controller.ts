import { Controller, Get, HttpCode, Inject, Query } from "@nestjs/common";

import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Env } from "../../config/env.config";
import { HTTPSTATUS } from "../../config/http.config";
import { type DateRangePreset } from "../../enums/date-range.enum";

import { AnalyticsService } from "./analytics.service";

/** Shape of the `?preset=&from=&to=` filter every analytics route accepts. */
interface AnalyticsRangeQuery {
  preset?: string;
  from?: string;
  to?: string;
}

const toDateRange = (query: AnalyticsRangeQuery) => ({
  dateRangePreset: query.preset as DateRangePreset,
  customFrom: query.from ? new Date(query.from) : undefined,
  customTo: query.to ? new Date(query.to) : undefined,
});

@Controller(`${Env.BASE_PATH}/analytics`)
export class AnalyticsController {
  constructor(
    @Inject(AnalyticsService)
    private readonly analyticsService: AnalyticsService,
  ) {}

  @Get("summary")
  @HttpCode(HTTPSTATUS.OK)
  async summary(
    @Query() query: AnalyticsRangeQuery,
    @CurrentUser() currentUser: Express.User | undefined,
  ) {
    const userId = currentUser?._id;
    const filter = toDateRange(query);

    const stats = await this.analyticsService.summary(
      userId,
      filter.dateRangePreset,
      filter.customFrom,
      filter.customTo,
    );

    return {
      message: "Summary fetched successfully",
      data: stats,
    };
  }

  @Get("chart")
  @HttpCode(HTTPSTATUS.OK)
  async chart(
    @Query() query: AnalyticsRangeQuery,
    @CurrentUser() currentUser: Express.User | undefined,
  ) {
    const userId = currentUser?._id;
    const filter = toDateRange(query);

    const chartData = await this.analyticsService.chart(
      userId,
      filter.dateRangePreset,
      filter.customFrom,
      filter.customTo,
    );

    return {
      message: "Chart fetched successfully",
      data: chartData,
    };
  }

  @Get("expense-breakdown")
  @HttpCode(HTTPSTATUS.OK)
  async expenseBreakdown(
    @Query() query: AnalyticsRangeQuery,
    @CurrentUser() currentUser: Express.User | undefined,
  ) {
    const userId = currentUser?._id;
    const filter = toDateRange(query);

    const pieChartData = await this.analyticsService.expenseBreakdown(
      userId,
      filter.dateRangePreset,
      filter.customFrom,
      filter.customTo,
    );

    return {
      message: "Expense breakdown fetched successfully",
      data: pieChartData,
    };
  }

  @Get("dashboard")
  @HttpCode(HTTPSTATUS.OK)
  async dashboard(
    @Query() query: AnalyticsRangeQuery,
    @CurrentUser() currentUser: Express.User | undefined,
  ) {
    const userId = currentUser?._id;
    const filter = toDateRange(query);

    const data = await this.analyticsService.dashboard(
      userId,
      filter.dateRangePreset,
      filter.customFrom,
      filter.customTo,
    );

    return {
      message: "Dashboard analytics fetched successfully",
      data,
    };
  }
}
