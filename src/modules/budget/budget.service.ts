import { Injectable } from "@nestjs/common";

import * as budgetService from "../../services/budget.service";

/** Injectable seam over the existing `services/budget.service` functions. */
@Injectable()
export class BudgetService {
  createOrUpdate(
    userId: Parameters<typeof budgetService.createOrUpdateBudget>[0],
    data: Parameters<typeof budgetService.createOrUpdateBudget>[1],
  ) {
    return budgetService.createOrUpdateBudget(userId, data);
  }

  getSummary(
    userId: Parameters<typeof budgetService.getBudgetSummary>[0],
    params: Parameters<typeof budgetService.getBudgetSummary>[1],
  ) {
    return budgetService.getBudgetSummary(userId, params);
  }

  delete(
    userId: Parameters<typeof budgetService.deleteBudget>[0],
    params: Parameters<typeof budgetService.deleteBudget>[1],
  ) {
    return budgetService.deleteBudget(userId, params);
  }

  getUserBudgets(userId: Parameters<typeof budgetService.getUserBudgets>[0]) {
    return budgetService.getUserBudgets(userId);
  }

  getCurrentMonth(
    userId: Parameters<typeof budgetService.getCurrentMonthBudget>[0],
  ) {
    return budgetService.getCurrentMonthBudget(userId);
  }
}
