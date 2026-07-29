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
} from "@nestjs/common";

import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Env } from "../../config/env.config";
import { HTTPSTATUS } from "../../config/http.config";
import {
  createCategorySchema,
  updateCategorySchema,
} from "../../validators/category.validator";

import { CategoryService } from "./category.service";

@Controller(`${Env.BASE_PATH}/category`)
export class CategoryController {
  constructor(
    @Inject(CategoryService)
    private readonly categoryService: CategoryService,
  ) {}

  @Get()
  @HttpCode(HTTPSTATUS.OK)
  async getCategories(@CurrentUser() currentUser: Express.User | undefined) {
    const userId = currentUser?._id;
    const categories = await this.categoryService.getAll(userId);
    return {
      message: "Categories fetched successfully",
      data: categories,
    };
  }

  @Post()
  @HttpCode(HTTPSTATUS.CREATED)
  async createCategory(
    @Body() rawBody: unknown,
    @CurrentUser() currentUser: Express.User | undefined,
  ) {
    const userId = currentUser?._id;
    const body = createCategorySchema.parse(rawBody);
    const category = await this.categoryService.create(userId, body);
    return {
      message: "Category created successfully",
      data: category,
    };
  }

  @Put(":id")
  @HttpCode(HTTPSTATUS.OK)
  async updateCategory(
    @Param("id") id: string,
    @Body() rawBody: unknown,
    @CurrentUser() currentUser: Express.User | undefined,
  ) {
    const userId = currentUser?._id;
    const body = updateCategorySchema.parse(rawBody);
    const category = await this.categoryService.update(userId, id, body);
    return {
      message: "Category updated successfully",
      data: category,
    };
  }

  @Delete(":id")
  @HttpCode(HTTPSTATUS.OK)
  async deleteCategory(
    @Param("id") id: string,
    @CurrentUser() currentUser: Express.User | undefined,
  ) {
    const userId = currentUser?._id;
    return this.categoryService.delete(userId, id);
  }
}
