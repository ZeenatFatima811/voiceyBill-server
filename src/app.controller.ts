import { Controller, Get } from "@nestjs/common";
import mongoose from "mongoose";

import { Env } from "./config/env.config";

/**
 * Unauthenticated liveness endpoints. These sit at the server root rather than
 * under `BASE_PATH`, and are the only routes not gated behind the per-request
 * database connection.
 */
@Controller()
export class AppController {
  @Get("/")
  getRoot() {
    return {
      message: "VoiceyBill API is running successfully!",
      status: "active",
      timestamp: new Date().toISOString(),
      version: "1.0.0",
    };
  }

  @Get("/health")
  getHealth() {
    return {
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database:
        mongoose.connection.readyState === 1 ? "connected" : "disconnected",
    };
  }

  @Get("/test")
  getTest() {
    return {
      message: "Serverless function is working!",
      timestamp: new Date().toISOString(),
      environment: Env.NODE_ENV,
    };
  }
}
