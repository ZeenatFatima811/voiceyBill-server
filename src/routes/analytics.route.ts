import { Router } from "express";
import {
  chartAnalyticsController,
  dashboardAnalyticsController,
  expensePieChartBreakdownController,
  summaryAnalyticsController,
} from "../controllers/analytics.controller";

const analyticsRoutes = Router();

analyticsRoutes.get("/summary", summaryAnalyticsController);
analyticsRoutes.get("/chart", chartAnalyticsController);
analyticsRoutes.get("/expense-breakdown", expensePieChartBreakdownController);
analyticsRoutes.get("/dashboard", dashboardAnalyticsController);

export default analyticsRoutes;
