import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Put,
  Query,
} from "@nestjs/common";

import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Env } from "../../config/env.config";
import { HTTPSTATUS } from "../../config/http.config";
import { toBudgetResponseDTO } from "../../dto/budget.dto";
import {
  createBudgetSchema,
  deleteBudgetSchema,
  getBudgetSummarySchema,
} from "../../validators/budget.validator";

import { BudgetService } from "./budget.service";

@Controller(`${Env.BASE_PATH}/budget`)
export class BudgetController {
  constructor(
    @Inject(BudgetService) private readonly budgetService: BudgetService,
  ) {}

  /** Set or update budget for a month (PUT /budget) */
  @Put()
  @HttpCode(HTTPSTATUS.OK)
  async setOrUpdateBudget(
    @Body() rawBody: unknown,
    @CurrentUser() currentUser: Express.User | undefined,
  ) {
    const userId = currentUser?._id.toString();
    const data = createBudgetSchema.parse(rawBody);

    const budget = await this.budgetService.createOrUpdate(userId, data);
    const responseData = toBudgetResponseDTO(budget);

    return {
      message: "Budget set successfully",
      data: responseData,
    };
  }

  /** Get budget summary (GET /budget/summary?month=X&year=Y) */
  @Get("summary")
  @HttpCode(HTTPSTATUS.OK)
  async getBudgetSummary(
    @Query() query: unknown,
    @CurrentUser() currentUser: Express.User | undefined,
  ) {
    const userId = currentUser?._id.toString();
    const params = getBudgetSummarySchema.parse(query);

    const summary = await this.budgetService.getSummary(userId, params);

    return {
      message: "Budget summary retrieved successfully",
      data: summary,
    };
  }

  /** Delete budget (DELETE /budget?month=X&year=Y) */
  @Delete()
  @HttpCode(HTTPSTATUS.OK)
  async deleteBudget(
    @Query() query: unknown,
    @CurrentUser() currentUser: Express.User | undefined,
  ) {
    const userId = currentUser?._id.toString();
    const params = deleteBudgetSchema.parse(query);

    const result = await this.budgetService.delete(userId, params);

    return {
      message: "Budget deleted successfully",
      data: result,
    };
  }

  /** Get all budgets for the user (GET /budget/list) */
  @Get("list")
  @HttpCode(HTTPSTATUS.OK)
  async getUserBudgets(@CurrentUser() currentUser: Express.User | undefined) {
    const userId = currentUser?._id.toString();

    const budgets = await this.budgetService.getUserBudgets(userId);
    const responseData = budgets.map((budget) => toBudgetResponseDTO(budget));

    return {
      message: "Budgets retrieved successfully",
      data: responseData,
    };
  }

  /** Get current month budget (GET /budget/current) */
  @Get("current")
  @HttpCode(HTTPSTATUS.OK)
  async getCurrentMonthBudget(
    @CurrentUser() currentUser: Express.User | undefined,
  ) {
    const userId = currentUser?._id.toString();

    const budget = await this.budgetService.getCurrentMonth(userId);
    const responseData = budget ? toBudgetResponseDTO(budget) : null;

    return {
      message: "Current month budget retrieved successfully",
      data: responseData,
    };
  }
}
