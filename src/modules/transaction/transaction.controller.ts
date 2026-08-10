import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
} from "@nestjs/common";

import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Env } from "../../config/env.config";
import { HTTPSTATUS } from "../../config/http.config";
import { type TransactionTypeEnum } from "../../enums/domain.enum";
import {
  bulkDeleteTransactionSchema,
  bulkTransactionSchema,
  createTransactionSchema,
  transactionIdSchema,
  updateTransactionSchema,
} from "../../validators/transaction.validator";
import { CategoryService } from "../category/category.service";

import { TransactionService } from "./transaction.service";

/**
 * Handler order is load-bearing: `GET /all` must be declared before `GET /:id`,
 * exactly as the Express router declared them, or the parameterised route would
 * swallow `/all`.
 */
@Controller(`${Env.BASE_PATH}/transaction`)
export class TransactionController {
  constructor(
    @Inject(TransactionService)
    private readonly transactionService: TransactionService,
    @Inject(CategoryService)
    private readonly categoryService: CategoryService,
  ) {}

  @Post("create")
  @HttpCode(HTTPSTATUS.CREATED)
  async createTransaction(
    @Body() rawBody: unknown,
    @CurrentUser() currentUser: Express.User | undefined,
  ) {
    const body = createTransactionSchema.parse(rawBody);
    const userId = currentUser?._id;

    const transaction = await this.transactionService.create(body, userId);

    return {
      message: "Transaction created successfully",
      transaction,
    };
  }

  /**
   * `receipt` is populated by the Cloudinary-backed Multer middleware bound to
   * this route in `AppModule.configure()`.
   */
  @Post("scan-receipt")
  @HttpCode(HTTPSTATUS.OK)
  async scanReceipt(
    @CurrentUser() currentUser: Express.User | undefined,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    const userId = currentUser?._id;

    // Load the user's categories (default + custom) so the receipt scan maps to
    // one of them instead of a hardcoded list.
    let categories: string[] = [];
    try {
      if (userId) categories = await this.categoryService.getNames(userId);
    } catch (err) {
      console.warn("Failed to load user categories for receipt scan:", err);
    }

    const result = await this.transactionService.scanReceipt(file, categories);

    return {
      message: "Receipt scanned successfully",
      data: result,
    };
  }

  @Post("bulk-transaction")
  @HttpCode(HTTPSTATUS.OK)
  async bulkTransaction(
    @Body() rawBody: unknown,
    @CurrentUser() currentUser: Express.User | undefined,
  ) {
    const userId = currentUser?._id;
    const { transactions } = bulkTransactionSchema.parse(rawBody);

    const result = await this.transactionService.bulkCreate(
      userId,
      transactions,
    );

    return {
      message: "Bulk transaction inserted successfully",
      ...result,
    };
  }

  @Put("duplicate/:id")
  @HttpCode(HTTPSTATUS.OK)
  async duplicateTransaction(
    @Param("id") id: string,
    @CurrentUser() currentUser: Express.User | undefined,
  ) {
    const userId = currentUser?._id;
    const transactionId = transactionIdSchema.parse(id);

    const transaction = await this.transactionService.duplicate(
      userId,
      transactionId,
    );

    return {
      message: "Transaction duplicated successfully",
      data: transaction,
    };
  }

  @Put("update/:id")
  @HttpCode(HTTPSTATUS.OK)
  async updateTransaction(
    @Param("id") id: string,
    @Body() rawBody: unknown,
    @CurrentUser() currentUser: Express.User | undefined,
  ) {
    const userId = currentUser?._id;
    const transactionId = transactionIdSchema.parse(id);
    const body = updateTransactionSchema.parse(rawBody);

    await this.transactionService.update(userId, transactionId, body);

    return {
      message: "Transaction updated successfully",
    };
  }

  @Get("all")
  @HttpCode(HTTPSTATUS.OK)
  async getAllTransaction(
    @Query() query: Record<string, unknown>,
    @CurrentUser() currentUser: Express.User | undefined,
  ) {
    const userId = currentUser?._id;

    const filters = {
      keyword: query.keyword as string | undefined,
      type: query.type as keyof typeof TransactionTypeEnum | undefined,
      recurringStatus: query.recurringStatus as
        | "RECURRING"
        | "NON_RECURRING"
        | undefined,
      startDate: query.startDate as string | undefined,
      endDate: query.endDate as string | undefined,
    };

    const pagination = {
      pageSize: query.pageSize,
      pageNumber: query.pageNumber,
    };

    const result = await this.transactionService.getAll(
      userId,
      filters,
      pagination,
    );

    return {
      message: "Transaction fetched successfully",
      ...result,
    };
  }

  @Get(":id")
  @HttpCode(HTTPSTATUS.OK)
  async getTransactionById(
    @Param("id") id: string,
    @CurrentUser() currentUser: Express.User | undefined,
  ) {
    const userId = currentUser?._id;
    const transactionId = transactionIdSchema.parse(id);

    const transaction = await this.transactionService.getById(
      userId,
      transactionId,
    );

    return {
      message: "Transaction fetched successfully",
      transaction,
    };
  }

  @Delete("delete/:id")
  @HttpCode(HTTPSTATUS.OK)
  async deleteTransaction(
    @Param("id") id: string,
    @CurrentUser() currentUser: Express.User | undefined,
  ) {
    const userId = currentUser?._id;
    const transactionId = transactionIdSchema.parse(id);

    await this.transactionService.delete(userId, transactionId);

    return {
      message: "Transaction deleted successfully",
    };
  }

  @Delete("bulk-delete")
  @HttpCode(HTTPSTATUS.OK)
  async bulkDeleteTransaction(
    @Body() rawBody: unknown,
    @CurrentUser() currentUser: Express.User | undefined,
  ) {
    const userId = currentUser?._id;
    const { transactionIds } = bulkDeleteTransactionSchema.parse(rawBody);

    const result = await this.transactionService.bulkDelete(
      userId,
      transactionIds,
    );

    return {
      message: "Transaction deleted successfully",
      ...result,
    };
  }
}
