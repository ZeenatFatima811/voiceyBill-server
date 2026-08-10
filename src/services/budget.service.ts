import type { BudgetApi } from "../db/mappers/budget.mapper";
import { budgets as budgetRepo, users as userRepo } from "../db/repositories";
import { toBudgetSummaryDTO, type BudgetSummaryDTO } from "../dto/budget.dto";
import { ErrorCodeEnum } from "../enums/error-code.enum";
import { sendBudgetAlertEmail } from "../mailers/budget-alert.mailer";
import { sendBudgetIncreaseEmail } from "../mailers/budget-increase.mailer";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "../utils/app-error";
import {
  type CreateBudgetType,
  UpdateBudgetType,
  type GetBudgetSummaryType,
  type DeleteBudgetType,
} from "../validators/budget.validator";

import { getUserCategoryNames } from "./category.service";

/**
 * Validate that the month/year is not too far in the future
 */
function validateMonthYear(month: number, year: number): void {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  // Allow up to 6 months in the future
  const maxFutureMonths = 6;
  const maxFutureDate = new Date(now);
  maxFutureDate.setMonth(maxFutureDate.getMonth() + maxFutureMonths);
  const maxYear = maxFutureDate.getFullYear();
  const maxMonth = maxFutureDate.getMonth() + 1;

  if (year > maxYear || (year === maxYear && month > maxMonth)) {
    throw new BadRequestException(
      "Cannot create budgets more than 6 months in the future",
      ErrorCodeEnum.VALIDATION_ERROR
    );
  }
}

/**
 * Validate that sum of category limits doesn't exceed total budget
 */
function validateCategorySum(totalBudget: number, categoryLimits: Array<{ category: string; limit: number }>): void {
  const categorySum = categoryLimits.reduce((sum, c) => sum + c.limit, 0);
  if (categorySum > totalBudget) {
    throw new BadRequestException(
      `Sum of category limits ($${categorySum.toFixed(2)}) cannot exceed total budget ($${totalBudget.toFixed(2)})`,
      ErrorCodeEnum.BUDGET_INVALID_AMOUNT
    );
  }
}

/**
 * Set or create a budget for a specific month/year
 */
export async function createOrUpdateBudget(
  userId: string,
  data: CreateBudgetType
): Promise<BudgetApi> {
  const { month, year, totalBudget, categoryLimits } = data;

  // Validate month/year
  validateMonthYear(month, year);

  // Validate categories against the user's real categories (default + custom
  // from the Category collection — the single source of truth). Matching is
  // case-insensitive so budget categories line up with transaction categories.
  const allowedNames = await getUserCategoryNames(userId);
  const allowedNormalized = new Set(
    allowedNames.map((name) => name.trim().toLowerCase())
  );
  for (const limit of categoryLimits) {
    if (!allowedNormalized.has(String(limit.category).trim().toLowerCase())) {
      throw new BadRequestException(
        `Invalid category: ${limit.category}. Add it in Account → Categories first.`,
        ErrorCodeEnum.VALIDATION_ERROR
      );
    }
  }

  // Validate category sum doesn't exceed total
  validateCategorySum(totalBudget, categoryLimits);

  // Check if budget already exists for this month/year
  const existingBudget = await budgetRepo.findByMonth(userId, month, year);

  if (existingBudget) {
    // Detect budget increases for email notification
    const budgetIncreases: Array<{
      type: "overall" | "category";
      category?: string;
      previousAmount: number;
      newAmount: number;
    }> = [];

    // Check overall budget increase
    if (totalBudget > existingBudget.totalBudget) {
      budgetIncreases.push({
        type: "overall",
        previousAmount: existingBudget.totalBudget,
        newAmount: totalBudget,
      });
    }

    // Check category budget increases
    categoryLimits.forEach((newCategory) => {
      const oldCategory = existingBudget.categoryLimits.find(
        (c) => c.category === newCategory.category
      );
      if (oldCategory && newCategory.limit > oldCategory.limit) {
        budgetIncreases.push({
          type: "category",
          category: newCategory.category,
          previousAmount: oldCategory.limit,
          newAmount: newCategory.limit,
        });
      }
    });

    // Send budget increase email if there are increases
    if (budgetIncreases.length > 0) {
      try {
        const user = await userRepo.findById(userId);
        if (user && user.email) {
          await sendBudgetIncreaseEmail({
            email: user.email,
            username: user.name,
            month,
            year,
            previousBudget: existingBudget.totalBudget,
            newBudget: totalBudget,
            increases: budgetIncreases,
          });
        }
      } catch (error) {
        // Log error but don't fail the request if email fails
        console.error("Failed to send budget increase email:", error);
      }
    }

  }

  /**
   * One upsert for both branches.
   *
   * The Mongo version read, then either mutated-and-saved or created. Two
   * concurrent saves for the same month could both find nothing and both
   * insert, and only the unique index stopped the second — as an error, not a
   * merge. `ON CONFLICT (user_id, month, year)` makes it a single atomic
   * statement.
   *
   * The read above is still needed, but only to compute the increase
   * notification, never to decide insert-vs-update.
   */
  return budgetRepo.upsert({ userId, month, year, totalBudget, categoryLimits });
}

/**
 * Get budget summary with spending breakdown for a specific month/year
 */
export async function getBudgetSummary(
  userId: string,
  params: GetBudgetSummaryType
): Promise<BudgetSummaryDTO> {
  const { month, year } = params;

  // Validate month and year are reasonable
  const now = new Date();
  const isCurrentOrPastMonth =
    year < now.getFullYear() ||
    (year === now.getFullYear() && month <= now.getMonth() + 1);

  if (!isCurrentOrPastMonth && year - now.getFullYear() > 1) {
    throw new BadRequestException(
      "Cannot view budgets more than 1 year in the future",
      ErrorCodeEnum.VALIDATION_ERROR
    );
  }

  const budget = await budgetRepo.findByMonth(userId, month, year);

  // Get the summary (returns empty summary if no budget exists)
  const summary = await toBudgetSummaryDTO(budget, month, year, userId);

  // Send budget alert email every time the budget summary is opened/refetched.
  if (summary.hasBudget && summary.alerts.length > 0) {
    try {
      const user = await userRepo.findById(userId);
      if (user && user.email) {
        await sendBudgetAlertEmail({
          email: user.email,
          username: user.name,
          alerts: summary.alerts,
          month,
          year,
          totalBudget: summary.totalBudget,
          spent: summary.spent,
        });
      }
    } catch (error) {
      // Log error but don't fail the request if email fails
      console.error("Failed to send budget alert email:", error);
    }
  }

  return summary;
}

/**
 * Delete a budget for a specific month/year
 */
export async function deleteBudget(
  userId: string,
  params: DeleteBudgetType
): Promise<{ success: boolean }> {
  const { month, year } = params;

  const budget = await budgetRepo.remove(userId, month, year);

  if (!budget) {
    throw new NotFoundException(
      "Budget not found",
      ErrorCodeEnum.RESOURCE_NOT_FOUND
    );
  }

  return { success: true };
}

/**
 * Get all budgets for a user (for history/overview)
 */
export async function getUserBudgets(userId: string): Promise<BudgetApi[]> {
  // `year desc, month desc` — newest first, as the mongoose sort did. The
  // repository lists ascending, so the order is reversed here rather than
  // adding a second query shape.
  const userBudgets = await budgetRepo.listByUser(userId);
  return [...userBudgets].reverse();
}

/**
 * Get budget for current month
 */
export async function getCurrentMonthBudget(
  userId: string
): Promise<BudgetApi | null> {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  return budgetRepo.findByMonth(userId, month, year);
}
