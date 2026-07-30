import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
} from "@nestjs/common";

import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Env } from "../../config/env.config";
import { HTTPSTATUS } from "../../config/http.config";
import { updateReportSettingSchema } from "../../validators/report.validator";

import { ReportService } from "./report.service";

@Controller(`${Env.BASE_PATH}/report`)
export class ReportController {
  constructor(
    @Inject(ReportService) private readonly reportService: ReportService,
  ) {}

  @Get("all")
  @HttpCode(HTTPSTATUS.OK)
  async getAllReports(
    @Query() query: Record<string, unknown>,
    @CurrentUser() currentUser: Express.User | undefined,
  ) {
    const userId = currentUser?._id;

    const pagination = {
      pageSize: parseInt(query.pageSize as string) || 20,
      pageNumber: parseInt(query.pageNumber as string) || 1,
    };

    const result = await this.reportService.getAll(userId, pagination);

    return {
      message: "Reports history fetched successfully",
      ...result,
    };
  }

  @Get("generate")
  @HttpCode(HTTPSTATUS.OK)
  async generateReport(
    @Query() query: Record<string, unknown>,
    @CurrentUser() currentUser: Express.User | undefined,
  ) {
    const userId = currentUser?._id;
    const { from, to } = query;
    const fromDate = new Date(from as string);
    const toDate = new Date(to as string);
    const baseCurrency = currentUser?.baseCurrency || "USD";

    const result = await this.reportService.generate(
      userId,
      fromDate,
      toDate,
      baseCurrency,
    );

    return {
      message: "Report generated successfully",
      ...result,
    };
  }

  @Put("update-setting")
  @HttpCode(HTTPSTATUS.OK)
  async updateReportSetting(
    @Body() rawBody: unknown,
    @CurrentUser() currentUser: Express.User | undefined,
  ) {
    const userId = currentUser?._id;
    const body = updateReportSettingSchema.parse(rawBody);

    await this.reportService.updateSetting(userId, body);

    return {
      message: "Reports setting updated successfully",
    };
  }

  @Post("resend/:id")
  @HttpCode(HTTPSTATUS.OK)
  async resendReport(
    @Param("id") id: string,
    @CurrentUser() currentUser: Express.User | undefined,
  ) {
    const userId = currentUser?._id;

    await this.reportService.resend(userId, id);

    return {
      message: "Report resend successfully",
    };
  }
}
