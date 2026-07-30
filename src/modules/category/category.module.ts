import { Module } from "@nestjs/common";

import { CategoryController } from "./category.controller";
import { CategoryService } from "./category.service";

@Module({
  controllers: [CategoryController],
  providers: [CategoryService],
  // Transaction (receipt scan) and Voice both classify against the caller's
  // category names.
  exports: [CategoryService],
})
export class CategoryModule {}
