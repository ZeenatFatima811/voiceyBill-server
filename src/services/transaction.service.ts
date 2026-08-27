import { openai, openAIModel } from "../config/openai.config";
import { voiceConfig } from "../config/voice.config";
import {
  budgets as budgetRepo,
  transactions as transactionRepo,
  users as userRepo,
  withTransaction,
  type Executor,
} from "../db/repositories";
import { TransactionTypeEnum } from "../enums/domain.enum";
import { ErrorCodeEnum } from "../enums/error-code.enum";
import { BadRequestException, NotFoundException } from "../utils/app-error";
import { calculateNextOccurrence } from "../utils/helper";
import { receiptPrompt } from "../utils/prompt";
import type {
  CreateTransactionType,
  UpdateTransactionType,
} from "../validators/transaction.validator";
import { invalidateAnalyticsCache } from "../utils/analytics-cache";

import {
  resolveCurrencyConversion,
  resolveUserCurrencyConversion,
} from "./currency-conversion.service";

/**
 * The regex-escaping helper this file used to carry is gone along with `$regex`.
 *
 * Its job — stopping a caller from supplying a PATTERN rather than a keyword,
 * including one like `(a+)+$` that triggers catastrophic backtracking and ties
 * up a connection until the query is killed — now belongs to the repository's
 * `escapeLikePattern`, which escapes the only three characters ILIKE treats
 * specially. See src/db/repositories/transaction.repository.ts.
 *
 * a keyword of `.*` must match literally, i.e. return nothing.
 */

/**
 * Force a query-string value to a primitive string.
 *
 * Express parses bracket notation (`?type[$ne]=EXPENSE`) into a nested object.
 * Assigned straight into a filter, that turns a value the caller controls into a
 * query operator; coercing first keeps it an inert string.
 */
const asQueryString = (value: unknown): string =>
  typeof value === "string" ? value : String(value);

/**
 * Sanitize and validate pagination inputs to prevent abuse and crashes
 * @param pageSize - requested page size (can be string, number, or invalid)
 * @param pageNumber - requested page number (can be string, number, or invalid)
 * @returns { pageSize: number; pageNumber: number } - safe, validated values
 */
const sanitizeAndValidatePagination = (
  pageSize: unknown,
  pageNumber: unknown,
): { pageSize: number; pageNumber: number } => {
  const MAX_PAGE_SIZE = 50000;
  const MAX_PAGE_NUMBER = 1000;

  // convert values
  const parsedPageSize = Number(pageSize);
  const parsedPageNumber = Number(pageNumber);

  // validate pageSize
  if (!Number.isFinite(parsedPageSize) || !Number.isInteger(parsedPageSize)) {
    throw new BadRequestException("pageSize must be a valid integer");
  }

  if (parsedPageSize <= 0) {
    throw new BadRequestException("pageSize must be greater than 0");
  }

  if (parsedPageSize > MAX_PAGE_SIZE) {
    throw new BadRequestException(`pageSize cannot exceed ${MAX_PAGE_SIZE}`);
  }

  // validate pageNumber
  if (
    !Number.isFinite(parsedPageNumber) ||
    !Number.isInteger(parsedPageNumber)
  ) {
    throw new BadRequestException("pageNumber must be a valid integer");
  }

  if (parsedPageNumber <= 0) {
    throw new BadRequestException("pageNumber must be greater than 0");
  }

  if (parsedPageNumber > MAX_PAGE_NUMBER) {
    throw new BadRequestException(
      `pageNumber cannot exceed ${MAX_PAGE_NUMBER}`,
    );
  }

  return {
    pageSize: parsedPageSize,
    pageNumber: parsedPageNumber,
  };
};

export const createTransactionService = async (
  body: CreateTransactionType,
  userId: string,
) => {
  let nextRecurringDate: Date | undefined;
  const currentDate = new Date();

  if (body.isRecurring && body.recurringInterval) {
    const calulatedDate = calculateNextOccurrence(
      body.date,
      body.recurringInterval,
    );

    nextRecurringDate =
      calulatedDate < currentDate
        ? calculateNextOccurrence(currentDate, body.recurringInterval)
        : calulatedDate;
  }

  const currencyFields = await resolveUserCurrencyConversion(
    userId,
    Number(body.amount),
    body.currency,
  );

  const transactionDoc = {
    ...body,
    userId,
    category: body.category,
    amount: currencyFields.amount,
    originalAmount: currencyFields.originalAmount,
    originalCurrency: currencyFields.originalCurrency,
    baseCurrencyAtTime: currencyFields.baseCurrencyAtTime,
    exchangeRate: currencyFields.exchangeRate,
    rateSource: currencyFields.rateSource,
    exchangeRateFetchedAt: currencyFields.exchangeRateFetchedAt,
    isRecurring: body.isRecurring || false,
    recurringInterval: body.recurringInterval || null,
    nextRecurringDate,
    lastProcessed: null,
  };

  if (body.type !== TransactionTypeEnum.EXPENSE) {
    const transaction = await transactionRepo.create(transactionDoc as never);

    await invalidateAnalyticsCache(userId);

    return transaction;
  }

  // Expense: validate against the budget and insert atomically. Without a
  // transaction, two concurrent expense writes can both read the same spend
  // total, both pass validation, and jointly exceed the budget (check-then-act
  // race). Snapshot reads + the insert now commit together; a validation
  // failure aborts the transaction. Requires a replica set (all Atlas tiers).
  const transaction = await withTransaction(async (tx) => {
    await validateExpenseAgainstBudget(
      userId,
      new Date(body.date),
      currencyFields.amount,
      body.category,
      tx,
      undefined,
    );

    return transactionRepo.create(transactionDoc as never, tx);
  });

  await invalidateAnalyticsCache(userId);

  return transaction;
};

/**
 * Throws BUDGET_INVALID_AMOUNT when adding `amount` would exceed the monthly
 * budget or the matching category limit. `excludeTransactionId` omits the
 * transaction being updated from the current-spend calculation. All reads run
 * inside the caller's session so validation and write commit atomically.
 */
const validateExpenseAgainstBudget = async (
  userId: string,
  transactionDate: Date,
  amount: number,
  category: string | undefined,
  exec: Executor,
  excludeTransactionId?: string,
) => {
  const month = transactionDate.getMonth() + 1;
  const year = transactionDate.getFullYear();

  const budget = await budgetRepo.findByMonth(userId, month, year, exec);

  if (!budget) return;

  // Calculate current total spent for this month/year
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0, 23, 59, 59, 999);
  // Reads run on the CALLER's transaction. The check-then-act race this guards
  // is only closed if the validation and the write see the same snapshot.
  const transactions = await transactionRepo.list(
    {
      userId,
      excludeId: excludeTransactionId,
      type: TransactionTypeEnum.EXPENSE,
      startDate,
      endDate,
    },
    {},
    exec,
  );

  const totalSpent = transactions.reduce((sum, t) => sum + (typeof t.amount === 'number' ? t.amount : parseFloat(String(t.amount || 0))), 0);

  if (totalSpent + amount > budget.totalBudget) {
    const remaining = budget.totalBudget - totalSpent;
    const remainingStr = remaining < 0 ? `-$${Math.abs(remaining).toFixed(2)}` : `$${remaining.toFixed(2)}`;
    throw new BadRequestException(
      `Transaction exceeds monthly budget of $${budget.totalBudget}. Remaining: ${remainingStr}`,
      ErrorCodeEnum.BUDGET_INVALID_AMOUNT
    );
  }

  // Check category limit
  if (category) {
    const normalizedCategory = category.trim().toLowerCase().replace(/\s+/g, "_");
    const categoryLimit = budget.categoryLimits.find(
      (c) => c.category.trim().toLowerCase().replace(/\s+/g, "_") === normalizedCategory
    );
    if (categoryLimit) {
      const categorySpent = transactions
        .filter((t) => t.category.trim().toLowerCase().replace(/\s+/g, "_") === normalizedCategory)
        .reduce((sum, t) => sum + (typeof t.amount === 'number' ? t.amount : parseFloat(String(t.amount || 0))), 0);

      if (categorySpent + amount > categoryLimit.limit) {
        const remaining = categoryLimit.limit - categorySpent;
        const remainingStr = remaining < 0 ? `-$${Math.abs(remaining).toFixed(2)}` : `$${remaining.toFixed(2)}`;
        throw new BadRequestException(
          `Transaction exceeds category limit for ${category}. Remaining: ${remainingStr}`,
          ErrorCodeEnum.BUDGET_INVALID_AMOUNT
        );
      }
    }
  }
};

export const getAllTransactionService = async (
  userId: string,
  filters: {
    keyword?: string;
    type?: keyof typeof TransactionTypeEnum;
    recurringStatus?: "RECURRING" | "NON_RECURRING";
    startDate?: string;
    endDate?: string;
  },
  pagination: {
    pageSize: unknown;
    pageNumber: unknown;
  },
) => {
  const { keyword, type, recurringStatus, startDate, endDate } = filters;

  let start: Date | undefined;
  let end: Date | undefined;

  if (startDate) start = new Date(asQueryString(startDate));
  if (endDate) {
    end = new Date(asQueryString(endDate));
    // End of the given day in the SERVER's local zone. Preserved verbatim from
    // the Mongo implementation rather than switched to UTC, which would move
    // the boundary for every existing deployment.
    end.setHours(23, 59, 59, 999);
  }

  const filterConditions = {
    userId,
    // Coerced to a primitive string first: Express parses bracket notation
    // (`?type[$ne]=EXPENSE`) into an object, which under Mongo turned a
    // caller-supplied value into a query operator.
    ...(keyword && { keyword: asQueryString(keyword) }),
    ...(type && { type: asQueryString(type) }),
    ...(recurringStatus && { recurringStatus }),
    ...(start && { startDate: start }),
    ...(end && { endDate: end }),
    // The list endpoint matches a row whose `date` OR whose `createdAt` falls
    // in the window - see the note on `dateField` in the repository.
    dateField: "dateOrCreatedAt" as const,
  };


  // Sanitize pagination inputs to prevent abuse and invalid queries
  const { pageSize, pageNumber } = sanitizeAndValidatePagination(
    pagination.pageSize,
    pagination.pageNumber,
  );

  // SAFE skip (now guaranteed valid)
  const skip = (pageNumber - 1) * pageSize;

  const [transactions, totalCount] = await Promise.all([
    transactionRepo.list(filterConditions, { skip, limit: pageSize }),
    transactionRepo.countAll(filterConditions),
  ]);

  const totalPages = Math.ceil(totalCount / pageSize);

  return {
    transactions,
    pagination: {
      pageSize,
      pageNumber,
      totalCount,
      totalPages,
      skip,
    },
  };
};

export const getTransactionByIdService = async (
  userId: string,
  transactionId: string,
) => {
  const transaction = await transactionRepo.findById(transactionId, userId);

  if (!transaction) {
    throw new NotFoundException("Transaction not found");
  }

  return transaction;
};

export const duplicateTransactionService = async (
  userId: string,
  transactionId: string,
) => {
  const transaction = await transactionRepo.findById(transactionId, userId);

  if (!transaction) {
    throw new NotFoundException("Transaction not found");
  }

  /**
   * Identity and timestamps are stripped so the copy gets its own.
   *
   * Mongoose set them to `undefined` on a spread of `toObject()`; destructuring
   * them away is the same intent without relying on undefined being dropped.
   * Amounts round-trip in DOLLARS - `findById` converted out of cents and
   * `create` converts back.
   */
  const {
    _id: _ignoredId,
    id: _ignoredVirtualId,
    createdAt: _ignoredCreatedAt,
    updatedAt: _ignoredUpdatedAt,
    ...copyable
  } = transaction;

  return transactionRepo.create({
    ...copyable,
    title: `Duplicate - ${transaction.title}`,
    description: transaction.description
      ? `${transaction.description} (Duplicate)`
      : "Duplicated transaction",
    isRecurring: false,
    recurringInterval: null,
    nextRecurringDate: null,
  });
};

export const updateTransactionService = async (
  userId: string,
  transactionId: string,
  body: UpdateTransactionType,
) => {
  const existingTransaction = await transactionRepo.findById(transactionId, userId);

  if (!existingTransaction) {
    throw new NotFoundException("Transaction not found");
  }

  const now = new Date();
  const isRecurring = body.isRecurring ?? existingTransaction.isRecurring;

  const date =
    body.date !== undefined ? new Date(body.date) : existingTransaction.date;

  /**
   * The stored value is typed `string | null`, because the Drizzle column takes
   * its allowed values from `RecurringIntervalEnum` at runtime and widens to
   * `string` at the type level. The CHECK constraint in
   * drizzle/0001_constraints_and_triggers.sql is what actually guarantees the
   * value is one of the four, so narrowing here is safe.
   */
  let recurringInterval:
    | "DAILY"
    | "WEEKLY"
    | "MONTHLY"
    | "YEARLY"
    | null
    | undefined =
    body.recurringInterval ??
    (existingTransaction.recurringInterval as
      | "DAILY"
      | "WEEKLY"
      | "MONTHLY"
      | "YEARLY"
      | null);

  let nextRecurringDate: Date | undefined | null = null;

  if (isRecurring === false) {
    recurringInterval = null;
    nextRecurringDate = null;
  } else if (isRecurring && recurringInterval) {
    const calulatedDate = calculateNextOccurrence(date, recurringInterval);

    nextRecurringDate =
      calulatedDate < now
        ? calculateNextOccurrence(now, recurringInterval)
        : calulatedDate;
  }

  let currencyUpdate: Record<string, any> = {};
  if (body.amount !== undefined || body.currency !== undefined) {
    const inputAmount =
      body.amount !== undefined
        ? Number(body.amount)
        : (existingTransaction.originalAmount ?? existingTransaction.amount);
    const inputCurrency =
      body.currency ||
      existingTransaction.originalCurrency ||
      existingTransaction.baseCurrencyAtTime ||
      undefined;
    const currencyFields = await resolveUserCurrencyConversion(
      userId,
      inputAmount,
      inputCurrency,
    );

    currencyUpdate = {
      amount: currencyFields.amount,
      originalAmount: currencyFields.originalAmount,
      originalCurrency: currencyFields.originalCurrency,
      baseCurrencyAtTime: currencyFields.baseCurrencyAtTime,
      exchangeRate: currencyFields.exchangeRate,
      rateSource: currencyFields.rateSource,
      exchangeRateFetchedAt: currencyFields.exchangeRateFetchedAt,
    };
  }

  const targetType = body.type || existingTransaction.type;

  const patch = {
    ...(body.title && { title: body.title }),
    ...(body.description && { description: body.description }),
    ...(body.category && { category: body.category }),
    ...(body.type && { type: body.type }),
    ...(body.paymentMethod && { paymentMethod: body.paymentMethod }),
    ...currencyUpdate,
    date,
    isRecurring,
    recurringInterval,
    nextRecurringDate,
  };

  const applyUpdate = (exec?: Executor) =>
    transactionRepo.update(transactionId, patch, userId, exec);

  if (targetType !== TransactionTypeEnum.EXPENSE) {
    await applyUpdate();

    await invalidateAnalyticsCache(userId);

    return;
  }

  // Same check-then-act protection as create: validate + save atomically.
  const targetAmount =
    currencyUpdate.amount !== undefined
      ? currencyUpdate.amount
      : existingTransaction.amount;

  await withTransaction(async (tx) => {
    await validateExpenseAgainstBudget(
      userId,
      new Date(date),
      targetAmount,
      body.category || existingTransaction.category,
      tx,
      transactionId,
    );
    await applyUpdate(tx);
  });

  await invalidateAnalyticsCache(userId);

  return;
};

export const deleteTransactionService = async (
  userId: string,
  transactionId: string,
) => {
  const deleted = await transactionRepo.remove(transactionId, userId);

  if (!deleted) {
    throw new NotFoundException("Transaction not found");
  }

  await invalidateAnalyticsCache(userId);

  return;
};

export const bulkDeleteTransactionService = async (
  userId: string,
  transactionIds: string[],
) => {
  const deletedCount = await transactionRepo.removeMany({
    ids: transactionIds,
    userId,
  });

  if (deletedCount === 0) {
    throw new NotFoundException("No transations found");
  }

  await invalidateAnalyticsCache(userId);

  return {
    sucess: true,
    deletedCount,
  };
};

export const bulkTransactionService = async (
  userId: string,
  transactions: CreateTransactionType[],
) => {
  try {
    const user = await userRepo.findById(userId);
    const baseCurrency = user?.baseCurrency || "USD";

    const rows = await Promise.all(
      transactions.map(async (tx) => {
        const currencyFields = await resolveCurrencyConversion(
          baseCurrency,
          Number(tx.amount),
          tx.currency,
        );

        return {
          ...tx,
          userId,
          date: new Date(tx.date),
          amount: currencyFields.amount,
          originalAmount: currencyFields.originalAmount,
          originalCurrency: currencyFields.originalCurrency,
          baseCurrencyAtTime: currencyFields.baseCurrencyAtTime,
          exchangeRate: currencyFields.exchangeRate,
          rateSource: currencyFields.rateSource,
          exchangeRateFetchedAt: currencyFields.exchangeRateFetchedAt,
          isRecurring: false,
          nextRecurringDate: null,
          recurringInterval: null,
        };
      }),
    );

    /**
     * `bulkWrite(..., { ordered: true })` becomes one multi-row INSERT, which
     * is atomic: an invalid row aborts the whole statement. Ordered bulkWrite
     * stopped at the first failure but KEPT everything already inserted, so a
     * half-applied import was possible. All-or-nothing is the safer reading of
     * "ordered" and is what an import needs.
     *
     * `lastProcesses: null` is dropped - it was a typo for `lastProcessed`, so
     * mongoose discarded it as an unknown path and it never reached a document.
     */
    const created = await transactionRepo.createMany(rows as never);

    await invalidateAnalyticsCache(userId);

    return {
      insertedCount: created.length,
      success: true,
    };
  } catch (error) {
    throw error;
  }
};

export const scanReceiptService = async (
  file: Express.Multer.File | undefined,
  categories: string[] = [],
) => {
  if (!file) {
    throw new BadRequestException("No file uploaded");
  }

  try {
    if (!file.path) {
      throw new BadRequestException("Failed to upload file");
    }
    const result = await openai.chat.completions.create({
      model: openAIModel,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: receiptPrompt(categories) },
            { type: "image_url", image_url: { url: file.path } },
          ],
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
      max_tokens: 500,
    });

    const content = result.choices[0]?.message?.content;
    if (!content) {
      throw new BadRequestException("Could not read receipt content");
    }

    const data = JSON.parse(content);

    if (!data.amount || !data.date) {
      throw new BadRequestException("Receipt missing required information");
    }

    const currency =
      typeof data.currency === "string" &&
        data.currency.trim().toUpperCase() !== "DEFAULT" &&
        data.currency.trim().length === 3
        ? data.currency.trim().toUpperCase()
        : undefined;

    // Map the AI's category onto one of the user's real categories (default +
    // custom), preserving the canonical name/casing. Falls back to "Other".
    const rawCategory =
      typeof data.category === "string" ? data.category.trim() : "";
    const allowedCategories = categories.length
      ? categories
      : voiceConfig.categories;
    const matchedCategory = allowedCategories.find(
      (c) => c.toLowerCase() === rawCategory.toLowerCase(),
    );
    const category =
      matchedCategory ??
      allowedCategories.find((c) => c.toLowerCase() === "other") ??
      "Other";

    return {
      title: data.title || "Receipt",
      amount: data.amount,
      date: data.date,
      description: data.description,
      category,
      paymentMethod: data.paymentMethod,
      type: data.type,
      currency,
      receiptUrl: file.path,
    };
  } catch (error) {
    if (error instanceof BadRequestException) {
      throw error;
    }
    console.error("Receipt Scan Error:", error);
    throw new BadRequestException("Receipt scanning service unavailable");
  }
};
