import { Injectable } from "@nestjs/common";

import {
  createCategoryService,
  deleteCategoryService,
  getCategoriesService,
  getUserCategoryNames,
  updateCategoryService,
} from "../../services/category.service";

/** Injectable seam over the existing `services/category.service` functions. */
@Injectable()
export class CategoryService {
  getAll(userId: Parameters<typeof getCategoriesService>[0]) {
    return getCategoriesService(userId);
  }

  create(
    userId: Parameters<typeof createCategoryService>[0],
    body: Parameters<typeof createCategoryService>[1],
  ) {
    return createCategoryService(userId, body);
  }

  update(
    userId: Parameters<typeof updateCategoryService>[0],
    id: Parameters<typeof updateCategoryService>[1],
    body: Parameters<typeof updateCategoryService>[2],
  ) {
    return updateCategoryService(userId, id, body);
  }

  delete(
    userId: Parameters<typeof deleteCategoryService>[0],
    id: Parameters<typeof deleteCategoryService>[1],
  ) {
    return deleteCategoryService(userId, id);
  }

  getNames(userId: Parameters<typeof getUserCategoryNames>[0]) {
    return getUserCategoryNames(userId);
  }
}
